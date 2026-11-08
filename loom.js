// The loom page: a LiteGraph canvas on the left, every box one node of a blacksmith document
// (a kind of the document, or a `value` node for the numbers and lists), the part drawn on the
// right by a wasm View in the worker. The canvas is turned into the document's nodes
// (loom-doc.js) on every change and sent to the worker, which holds the document, applies
// the change as one op, evaluates it and draws the nodes to draw itself, on the view's
// canvas transferred to it (viewer-client.js, the bridge's client, carries the view's
// traffic and this page's input there); the answer paints each box's state and the caption.
// Save writes the document (`<name>.json`), Open reads one, and a link carries it as `?doc=`.
// Nothing is uploaded.
import { LiteGraph, LGraph, LGraphCanvas } from "./vendor/litegraph.js";
import { REGISTRY, isBare, startValue, useKinds, portBase, portIndex, portName } from "./loom-nodes.js";
import { graphToNodes, nodesToGraph, notDocument, pack, unpack } from "./loom-doc.js";
import { EXAMPLES } from "./loom-examples.js";
import { scriptOf } from "./loom-script.js";
import { captionOf } from "./notebook-scene.js";
import { attachViewer } from "./viewer-client.js";
import { activationListen } from "./view-activation.js";
import { filePicker, fileKeys } from "./file-picker.js";

const $ = (id) => document.getElementById(id);
const PREFIX = "loom/";
// The palette's choices (loom-ui.json): which of the kernel's kinds it shows, and how.
const UI = await fetch(new URL("./loom-ui.json", import.meta.url)).then((r) => r.json());
// A change waits this long for the next before the graph is evaluated: a slider drags.
const SETTLE_MS = 120;

function supported() {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!(gl && window.Worker && window.WebAssembly && "transferControlToOffscreen" in HTMLCanvasElement.prototype);
}

// ---- the node types --------------------------------------------------------------------

// The site's palette on LiteGraph: the graphite, the muted text, the blue for wires.
LiteGraph.NODE_DEFAULT_COLOR = "#2A2928";
LiteGraph.NODE_DEFAULT_BGCOLOR = "#232221";
LiteGraph.NODE_TITLE_COLOR = "#F1EFE8";
LiteGraph.NODE_TEXT_COLOR = "#B4B2A9";
LiteGraph.NODE_SELECTED_TITLE_COLOR = "#F1EFE8";
LiteGraph.WIDGET_BGCOLOR = "#1C1B1A";
LiteGraph.WIDGET_OUTLINE_COLOR = "#5F5E5A";
LiteGraph.WIDGET_TEXT_COLOR = "#F1EFE8";
LiteGraph.WIDGET_SECONDARY_TEXT_COLOR = "#B4B2A9";
LiteGraph.LINK_COLOR = "#8AA7C4";
LiteGraph.CONNECTING_LINK_COLOR = "#378ADD";
LiteGraph.NODE_DEFAULT_BOXCOLOR = "#5F5E5A";
// A title colour per group, so a solid node reads as one at a glance.
const GROUP_COLOURS = { Numbers: "#3A3937", Lists: "#4A4030", Profiles: "#2E4A44", Frames: "#3E3550", Sweeps: "#2E4A44", Selectors: "#3E3550", Solids: "#2D4A66", Output: "#2F4A32" };
// What a wire's colour says about what it carries.
Object.assign(LGraphCanvas.link_type_colors, {
    number: "#B4B2A9", integer: "#B4B2A9", boolean: "#B4B2A9", text: "#B4B2A9", vector2: "#C9B27A", vector3: "#C9B27A",
    profile: "#7CC4B0", path: "#7CC4B0", solid: "#6FAAE8", frame: "#B79CE0", slant: "#B79CE0", selector: "#B79CE0", edges: "#E0B25A", face: "#E0B25A",
    section: "#7CC4B0", sweeppath: "#7CC4B0", record: "#B79CE0",
});

// The records loom-ui.json names (a path, a selector, a face pick...): a port taking any
// record takes each of them.
let RECORDS = ["record"];
// The slot type a port takes: a number port takes an integer too, `any` takes anything, a
// record port any record.
const slotType = (p) => (p.type === "any" ? "*" : p.type === "number" || p.type === "integer" ? "number,integer" : p.type === "choice" ? "text" : p.type === "record" ? RECORDS.join(",") : p.type);
// Whether a value of `from` may go into a port of `to` (the evaluator's own rule).
const accepts = (to, from) => to === "any" || from === "any" || to === from || (to === "number" && from === "integer") || (to === "integer" && from === "number")
    || (to === "text" && from === "choice") || (to === "choice" && from === "text") || (to === "record" && RECORDS.includes(from));
const outType = (def) => (def.output.type === "any" ? "*" : def.output.type === "choice" ? "text" : def.output.type);
const fmtVec = (v) => (Array.isArray(v) ? v.join(", ") : v ?? "");
const parseVec = (text, n) => { const a = String(text).split(/[,\s]+/).filter(Boolean).map(Number); return a.length === n && a.every(Number.isFinite) ? a : null; };
const parseJson = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
// The widget a port shows: a kind's says (`widget`), a builtin's follows its type.
const widgetOf = (p) => p.widget ?? (p.choices ? "choice" : p.type);
// A port's definition by its name on the node (`solids 2` is the list port `solids`).
const portOf = (def, name) => def.inputs.find((p) => p.name === portBase(name) && (p.role === "inputs" || p.name === name));
function nodeClass(def) {
    function Node() {
        this.properties = { params: {}, lacing: "longest", preview: false, docId: null, raw: null };
        for (const p of def.inputs) {
            // An optional port with nothing for a default is a slot alone, marked so.
            const bare = isBare(p);
            if (p.slot !== false) this.addInput(p.name, slotType(p), bare ? { label: `${p.name} (optional)` } : undefined);
            if (bare) continue;
            // What the widget shows is what the node reads (startValue: the evaluator's rule).
            const value = startValue(p);
            if (value === undefined) continue;   // an input or a list: the wire carries it; no widget
            this.properties.params[p.name] = value;
            // An edited port is the user's: what the document held there (`raw`) gives way.
            const set = (v) => { this.properties.params[p.name] = v; this.dropRaw(p.name); schedule(); };
            const range = p.range ? { min: p.range[0], max: p.range[1] } : {};
            switch (widgetOf(p)) {
                case "choice": this.addWidget("combo", p.name, value, set, { values: p.choices }); break;
                case "number":
                    if (def.kind === "Number" && p.name === "value") this.slider = this.addWidget("slider", "value", value, set, { min: 0, max: 100, step: 1, precision: 2 });
                    else this.addWidget("number", p.name, value, set, { step: 10, precision: 3, ...range });
                    break;
                case "integer": this.addWidget("number", p.name, value, (v) => set(Math.round(v)), { step: 10, precision: 0, ...range }); break;
                case "boolean": this.addWidget("toggle", p.name, value, set); break;
                case "text": this.addWidget("text", p.name, value, set); break;
                case "vector2": case "vector3": {
                    const n = widgetOf(p) === "vector2" ? 2 : 3;
                    this.addWidget("text", p.name, fmtVec(value), (v) => { const a = parseVec(v, n); if (a) set(a); }, {});
                    break;
                }
                // A list or a record the field holds, as its JSON.
                case "json": this.addWidget("text", p.name, JSON.stringify(value), (v) => { const a = parseJson(v); if (a !== undefined) set(a); }, { json: true }); break;
            }
        }
        this.addOutput(def.output.list ? "list" : "", outType(def));
        this.color = GROUP_COLOURS[def.group] ?? LiteGraph.NODE_DEFAULT_COLOR;
        this.size = this.computeSize();
        this.size[0] = Math.max(this.size[0], 150);
    }
    Node.title = def.label;
    Node.desc = def.doc;
    // A wired port's widget is greyed: the wire's value is what the node reads.
    Node.prototype.onConnectionsChange = function () {
        this.fitListPorts();
        this.greyWired();
        for (const i of this.inputs) if (i.link != null) this.dropRaw(i.name);
        schedule();
    };
    Node.prototype.dropRaw = function (port) {
        const raw = this.properties.raw;
        const field = portOf(def, port)?.field;
        if (raw && field) delete raw[field];
    };
    Node.prototype.greyWired = function () {
        for (const w of this.widgets ?? []) { const i = this.inputs.find((x) => x.name === w.name); w.disabled = Boolean(i && i.link != null); }
    };
    // A list input (a join's solids) is a port an item: one free port always follows the last
    // wired one, added after its kin and taken away when it is no longer needed.
    Node.prototype.fitListPorts = function (wanted = {}) {
        if (this.fitting) return;
        this.fitting = true;
        try {
            for (const p of def.inputs) {
                if (p.role !== "inputs") continue;
                const at = () => this.inputs.map((i, k) => [i, k]).filter(([i]) => portBase(i.name) === p.name);
                let last = Math.max(-1, wanted[p.name] ?? -1, ...at().filter(([i]) => i.link != null).map(([i]) => portIndex(i.name)));
                while (at().length < last + 2) {
                    const ports = at();
                    this.addInput(portName(p.name, ports.length), slotType(p));
                    // Moved up beside its kin; the links into the ports it passes follow them.
                    const added = this.inputs.pop();
                    this.inputs.splice(ports[ports.length - 1][1] + 1, 0, added);
                    this.inputs.forEach((i, k) => { if (i.link != null && this.graph?.links[i.link]) this.graph.links[i.link].target_slot = k; });
                }
                for (let ports = at(); ports.length > last + 2 && ports[ports.length - 1][0].link == null; ports = at()) this.removeInput(ports[ports.length - 1][1]);
            }
            this.size[1] = this.computeSize()[1];
        } finally {
            this.fitting = false;
        }
    };
    // The slider's range follows the node's own min and max.
    Node.prototype.onWidgetChanged = function (name, value) {
        if (this.slider && (name === "min" || name === "max")) {
            this.slider.options[name] = Number(value);
            this.slider.value = Math.min(Math.max(this.slider.value, this.slider.options.min), this.slider.options.max);
            this.properties.params.value = this.slider.value;
        }
    };
    Node.prototype.onConfigure = function () { this.applyParams(); };
    // The widgets read from the params, after a load.
    Node.prototype.applyParams = function () {
        for (const w of this.widgets ?? []) {
            const v = this.properties.params[w.name];
            if (v === undefined) continue;
            w.value = w.options?.json ? JSON.stringify(v) : Array.isArray(v) && w.type === "text" ? fmtVec(v) : v;
            if (this.slider && (w.name === "min" || w.name === "max")) this.slider.options[w.name] = Number(v);
        }
    };
    Node.prototype.getExtraMenuOptions = function () {
        const node = this;
        return [
            { content: node.properties.preview ? "Preview: on" : "Preview: off", callback: () => { node.properties.preview = !node.properties.preview; schedule(); } },
            { content: `Lacing: ${node.properties.lacing}`, callback: () => { node.properties.lacing = node.properties.lacing === "cross" ? "longest" : "cross"; schedule(); } },
            { content: "About this node", callback: () => showDetail(node) },
        ];
    };
    Node.prototype.onSelected = function () { showDetail(this); };
    return Node;
}

// A document node of a kind the palette does not show (a held body, a kind made elsewhere):
// kept whole, drawn as a box of its kind with its output alone.
function DocumentNode() {
    this.properties = { raw: null, docId: null, preview: false };
    this.addOutput("", "*");
    this.color = GROUP_COLOURS.Solids;
    this.size = [180, 40];
}
DocumentNode.title = "document node";
DocumentNode.desc = "A node of the document no box of the loom makes, kept as it is.";
DocumentNode.prototype.onConfigure = function () { this.title = this.properties.raw?.node?.name ?? this.properties.raw?.node?.kind ?? "node"; };
DocumentNode.prototype.getExtraMenuOptions = function () {
    return [{ content: this.properties.preview ? "Preview: on" : "Preview: off", callback: () => { this.properties.preview = !this.properties.preview; schedule(); } }];
};

// The palette on LiteGraph, once: the kernel's kinds (the worker's `ready`) as loom-ui.json
// shows them, beside the builtins. The search box and the menu list them by group.
let palette = false;
function registerPalette(kinds) {
    if (palette) return;
    useKinds(kinds, UI);
    RECORDS = ["record", ...new Set(Object.values(UI.records ?? {}))];
    for (const def of REGISTRY.values()) {
        LiteGraph.registerNodeType(PREFIX + def.kind, nodeClass(def));
        LiteGraph.registered_node_types[PREFIX + def.kind].category = def.group;
    }
    LiteGraph.registerNodeType(PREFIX + "Document", DocumentNode);
    palette = true;
}

// ---- the picker ---------------------------------------------------------------------------

// The node picker: a searchable list, placed where the pointer is, of the nodes that fit --
// dragged from an output, those with a port taking its type; from an input, those whose
// output it takes; from the empty canvas (a double-click), all of them. Picking adds the
// node there and wires it. Typing filters, arrows move, Enter takes the first, Escape closes.
const picker = { el: null, items: [], at: 0 };
function openPicker(e, { from = null, to = null } = {}) {
    closePicker();
    const pos = canvas.convertEventToCanvasOffset(e);
    // A document node no box makes gives anything and takes nothing.
    const fromType = from ? REGISTRY.get(from.node.type.slice(PREFIX.length))?.output.type ?? "any" : null;
    const toDef = to ? REGISTRY.get(to.node.type.slice(PREFIX.length)) : null;
    const toPort = toDef ? portOf(toDef, to.node.inputs[to.slot]?.name ?? "") ?? null : null;
    const fits = (def) => {
        if (fromType !== null) return def.inputs.some((p) => p.slot !== false && accepts(p.type, fromType));
        if (toPort) return accepts(toPort.type, def.output.type);
        return true;
    };
    // The nodes made for the type first (a solid's verbs), the ones taking anything after.
    const exact = (def) => (fromType !== null ? def.inputs.some((p) => p.slot !== false && p.type === fromType) : toPort ? def.output.type === toPort.type : true);
    const GROUP_ORDER = ["Solids", "Profiles", "Frames", "Sweeps", "Selectors", "Numbers", "Lists", "Input", "Output"];
    const rank = (def) => { const i = GROUP_ORDER.indexOf(def.group); return i < 0 ? GROUP_ORDER.length : i; };
    const all = [...REGISTRY.values()].filter(fits).sort((a, b) => Number(exact(b)) - Number(exact(a)) || rank(a) - rank(b) || a.label.localeCompare(b.label));
    const el = document.createElement("div");
    el.className = "picker";
    el.style.left = `${e.clientX + window.scrollX}px`;
    el.style.top = `${e.clientY + window.scrollY}px`;
    const what = fromType ? `takes: ${fromType}` : toPort ? `makes: ${toPort.type}` : "any node";
    el.innerHTML = `<input type="text" placeholder="${what} — type to filter" spellcheck="false" autocomplete="off"><ul></ul>`;
    document.body.appendChild(el);
    const input = el.querySelector("input"), list = el.querySelector("ul");
    picker.el = el;
    const pick = (def) => {
        const node = LiteGraph.createNode(PREFIX + def.kind);
        node.pos = [pos[0], pos[1]];
        graph.add(node);
        if (from) {
            const slot = node.inputs.findIndex((i) => { const p = portOf(def, i.name); return p && accepts(p.type, fromType); });
            if (slot >= 0) { from.node.connect(from.slot, node, slot); node.pos[1] -= 10; }
        } else if (to) {
            node.connect(0, to.node, to.slot);
            node.pos[0] -= node.size[0];
        }
        closePicker();
        canvas.selectNode(node);
        schedule();
    };
    const render = () => {
        const q = input.value.trim().toLowerCase();
        picker.items = all.filter((d) => !q || d.label.includes(q) || d.kind.toLowerCase().includes(q) || d.group.toLowerCase().includes(q)).slice(0, 40);
        picker.at = Math.min(picker.at, Math.max(picker.items.length - 1, 0));
        list.textContent = "";
        picker.items.forEach((d, i) => {
            const li = document.createElement("li");
            if (i === picker.at) li.className = "at";
            li.innerHTML = `<b></b> <span class="group"></span><span class="doc"></span>`;
            li.querySelector("b").textContent = d.label;
            li.querySelector(".group").textContent = d.group;
            li.querySelector(".doc").textContent = d.doc.replace(/`/g, "").split(/(?<=\.)\s/)[0];
            li.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(d); });
            list.appendChild(li);
        });
        if (!picker.items.length) { const li = document.createElement("li"); li.className = "none"; li.textContent = "nothing fits"; list.appendChild(li); }
    };
    input.addEventListener("input", () => { picker.at = 0; render(); });
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { closePicker(); ev.preventDefault(); }
        else if (ev.key === "Enter") { if (picker.items[picker.at]) pick(picker.items[picker.at]); ev.preventDefault(); }
        else if (ev.key === "ArrowDown") { picker.at = Math.min(picker.at + 1, picker.items.length - 1); render(); ev.preventDefault(); }
        else if (ev.key === "ArrowUp") { picker.at = Math.max(picker.at - 1, 0); render(); ev.preventDefault(); }
    });
    input.addEventListener("blur", () => setTimeout(closePicker, 150));
    render();
    // Kept on screen: nudged up or left when it would run off the window.
    const box = el.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) el.style.left = `${Math.max(8, e.clientX - box.width) + window.scrollX}px`;
    if (box.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, e.clientY - box.height) + window.scrollY}px`;
    input.focus();
}
function closePicker() {
    if (picker.el) { picker.el.remove(); picker.el = null; }
}

// ---- Blueprint's mouse --------------------------------------------------------------------

// Unreal's Blueprint editor's controls over LiteGraph's: the left button drags a node, or
// draws a selection box on the empty canvas; the right and middle buttons pan; a right
// click that did not drag opens the picker (a node's own menu on a node); Alt+click on a
// pin breaks its wires; the wheel zooms; Home fits the graph in the view, F the selection.
// LiteGraph binds its handlers at construction, so the prototype is patched first: a right
// button press reaches it as a middle one (its pan), a left press on the empty canvas as a
// Ctrl one (its selection box).
const eventWith = (e, over) => new Proxy(e, { get: (t, k) => (k in over ? over[k] : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
let rightPress = null;   // { x, y, node } while the right button is down
const baseDown = LGraphCanvas.prototype.processMouseDown;
LGraphCanvas.prototype.processMouseDown = function (e) {
    if (!this.graph) return baseDown.call(this, e);
    const pos = this.convertEventToCanvasOffset(e);
    const node = this.graph.getNodeOnPos(pos[0], pos[1], this.visible_nodes, 5);
    if (e.which === 3) {
        rightPress = { x: e.clientX, y: e.clientY, node };
        return baseDown.call(this, eventWith(e, { which: 2, button: 1, buttons: 4 }));
    }
    if (e.which === 1 && e.altKey && node) {
        // Alt+click on a pin: its wires go.
        const input = this.isOverNodeInput(node, pos[0], pos[1]);
        if (input !== -1) { if (node.inputs[input].link != null) node.disconnectInput(input); this.setDirty(true, true); return; }
        const output = this.isOverNodeOutput(node, pos[0], pos[1]);
        if (output !== -1) { if (node.outputs[output].links?.length) node.disconnectOutput(output); this.setDirty(true, true); return; }
    }
    if (e.which === 1 && !node && !e.ctrlKey && !this.graph.getGroupOnPos(pos[0], pos[1]) && !this.read_only) {
        return baseDown.call(this, eventWith(e, { ctrlKey: true }));
    }
    return baseDown.call(this, e);
};
const baseUp = LGraphCanvas.prototype.processMouseUp;
LGraphCanvas.prototype.processMouseUp = function (e) {
    if (e.which === 3 && rightPress) {
        const press = rightPress;
        rightPress = null;
        const r = baseUp.call(this, eventWith(e, { which: 2, button: 1 }));
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) {
            if (press.node) { this.selectNodes([press.node]); this.processContextMenu(press.node, e); }
            else openPicker(e);
        }
        return r;
    }
    return baseUp.call(this, e);
};

// The view framed on the nodes: all of them (Home), or the selected ones (F).
const MIN_FIT_SCALE = 0.9;
function fitView(nodes) {
    // An empty graph (cleared, or opened empty): the view back at the origin, unzoomed.
    if (!nodes.length) { canvas.ds.scale = 1; canvas.ds.offset = [0, 0]; canvas.setDirty(true, true); return; }
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const box = new Float32Array(4);
    for (const n of nodes) {
        n.getBounding(box);
        b[0] = Math.min(b[0], box[0]); b[1] = Math.min(b[1], box[1]);
        b[2] = Math.max(b[2], box[0] + box[2]); b[3] = Math.max(b[3], box[1] + box[3]);
    }
    const cw = canvas.canvas.width, ch = canvas.canvas.height;
    // Fitted, but never below MIN_FIT_SCALE: a node's text stays readable, and a graph
    // that then overflows the pane is anchored at its left and top (where the inputs
    // are) for the right button to pan, rather than shrunk to a thumbnail.
    const scale = Math.max(Math.min(cw / (b[2] - b[0] + 80), ch / (b[3] - b[1] + 80), 1.25), MIN_FIT_SCALE);
    const place = (size, lo, hi) => (hi - lo + 80 <= size / scale ? size / (2 * scale) - (lo + hi) / 2 : 40 - lo);
    canvas.ds.scale = scale;
    canvas.ds.offset = [place(cw, b[0], b[2]), place(ch, b[1], b[3])];
    canvas.setDirty(true, true);
}

// ---- the graph <-> the loom's JSON ------------------------------------------------------

const graph = new LGraph();
let canvas = null;

// The canvas as loom-doc.js's graph: boxes by their LiteGraph ids (each with the document id
// it keeps), wires from the links.
function toGraph() {
    const nodes = [], wires = [];
    for (const n of graph._nodes) {
        const kind = n.type.slice(PREFIX.length);
        const box = { id: String(n.id), docId: n.properties.docId, kind, x: Math.round(n.pos[0]), y: Math.round(n.pos[1]), params: { ...(n.properties.params ?? {}) }, lacing: n.properties.lacing, preview: n.properties.preview };
        if (n.flags?.collapsed) box.collapsed = true;
        if (n.properties.raw) box.raw = n.properties.raw;
        nodes.push(box);
        for (let i = 0; i < (n.inputs ?? []).length; i++) {
            const link = n.inputs[i].link != null ? graph.links[n.inputs[i].link] : null;
            if (link) wires.push({ from: String(link.origin_id), to: [String(n.id), n.inputs[i].name] });
        }
    }
    return { nodes, wires };
}

// A fresh box's document id: `n` and a number no node holds.
function freshId() {
    const taken = new Set(graph._nodes.map((n) => n.properties.docId));
    let k = graph._nodes.length + 1;
    while (taken.has(`n${k}`)) k++;
    return `n${k}`;
}

// A canvas (nodesToGraph's) on the page: each box with the document id it came with.
function fromGraph(data) {
    graph.clear();
    const made = new Map();
    for (const n of data.nodes) {
        const node = LiteGraph.createNode(PREFIX + n.kind);
        if (!node) { console.warn(`no box ${n.kind}`); continue; }
        node.pos = [n.x ?? 0, n.y ?? 0];
        node.properties.docId = n.docId ?? n.id;
        node.properties.raw = n.raw ?? null;
        if (n.kind !== "Document") {
            // Only what the document holds: a port it leaves out stays out (the kind's default).
            node.properties.params = { ...(n.params ?? {}) };
            node.properties.lacing = n.lacing ?? "longest";
            node.applyParams();
        }
        node.properties.preview = Boolean(n.preview);
        if (n.collapsed) node.collapse(true);
        node.onConfigure?.();
        graph.add(node);
        made.set(String(n.id), node);
    }
    const wanted = new Map();
    for (const w of data.wires) {
        const to = made.get(String(w.to[0]));
        if (!to?.fitListPorts) continue;
        const ports = wanted.get(to) ?? {};
        const base = portBase(w.to[1]);
        ports[base] = Math.max(ports[base] ?? -1, portIndex(w.to[1]));
        wanted.set(to, ports);
    }
    for (const [node, ports] of wanted) node.fitListPorts(ports);
    for (const w of data.wires) {
        const from = made.get(String(w.from)), to = made.get(String(w.to[0]));
        const slot = to?.inputs?.findIndex((i) => i.name === w.to[1]);
        if (from && to && slot >= 0) from.connect(0, to, slot);
    }
    for (const node of made.values()) { node.fitListPorts?.(); node.greyWired?.(); }
    graph.setDirtyCanvas(true, true);
    if (canvas) fitView(graph._nodes);
}

// The nodes to draw: those marked, else the ends of the graph that make solids or profiles.
function drawSet(data, nodes) {
    const idOf = new Map(data.nodes.map((n, i) => [n.id, nodes[i].id]));
    const drawn = data.nodes.filter((n) => n.preview).map((n) => idOf.get(n.id));
    if (drawn.length) return drawn;
    const hasOut = new Set(data.wires.map((w) => w.from));
    return data.nodes.filter((n, i) => {
        if (hasOut.has(n.id)) return false;
        if (n.kind === "Document") return /^(solid|sheet|profile)\./.test(nodes[i].kind);
        const def = REGISTRY.get(n.kind);
        return def && ["solid", "profile"].includes(def.output.type);
    }).map((n) => idOf.get(n.id));
}

// ---- the worker -------------------------------------------------------------------------

let worker = null, client = null, ready = false, viewFailed = false, seq = 0, inflight = null, settle = 0;
// The answers to `open`, `save` and `body` by their seq.
const waiting = new Map();
function ask(message, transfer) {
    const s = ++seq;
    return new Promise((resolve, reject) => {
        waiting.set(s, { resolve, reject });
        worker.postMessage({ ...message, seq: s }, transfer ?? []);
    });
}
// What to open once the worker is ready: a document's text.
let pendingOpen = null;
// A file or link refused before the kernel was up: its words stay the status line's until the
// next open, rather than the boot's "ready" and an empty graph's caption over them.
let refused = false;
// view.js's `listen`, for the activation filter: imported once, before the first worker.
let viewJs = null;

async function boot() {
    ready = false;
    viewFailed = false;
    const params = new URLSearchParams(location.search);
    // Awaited before the worker exists, not after: a worker's own early messages (`ready`,
    // or a `view.failed` from a View that fails to create) would have nowhere to land in
    // the gap between `new Worker` and `worker.onmessage` being set, if that gap held an await.
    // A failed import (a missing or stale pkg/) is said on the status line, not left an
    // unhandled rejection: without view.js there is no view, and no worker is made.
    try {
        viewJs ??= await import("./pkg/view.js");
    } catch (e) {
        setStatus(`the view failed to load: ${e?.message ?? e}`, "error");
        return;
    }
    worker = new Worker(new URL("./loom-worker.js", import.meta.url), { type: "module" });
    const own = worker;
    worker.onmessage = ({ data }) => {
        // A message the old worker queued before a restart terminated it (a second
        // "crashed" would otherwise restart the new one) is not this page's any more.
        if (worker !== own) return;
        if (data.kind === "ready") {
            registerPalette(data.kinds);
            ready = true;
            $("versions").textContent = `cadaclysm-blacksmith document · wasm ${data.versions.wasm}`;
            if (!refused) setStatus("ready", "ready");
            if (pendingOpen !== null) { const text = pendingOpen; pendingOpen = null; openText(text); }
            else if (!refused) { lastSent = null; schedule(0); }
        }
        else if (data.kind === "opened" || data.kind === "saved" || data.kind === "bodies") {
            const w = waiting.get(data.seq);
            waiting.delete(data.seq);
            if (data.error) w?.reject(new Error(data.error)); else w?.resolve(data);
        } else if (typeof data.kind === "string" && data.kind.startsWith("view.")) client?.receive(data);
        else if (data.kind === "boot-failed") setStatus(`the kernel failed to load: ${data.message}`, "error");
        else if (data.kind === "crashed") restart(data.message);
        else if (data.kind === "result") { if (data.seq === inflight) { inflight = null; applyResult(data); } }
    };
    worker.onerror = (e) => setStatus(`the kernel failed to load: ${e.message}`, "error");
    client = attachViewer({
        canvas: viewCanvas, worker, id: 1, controls: true,
        listen: activationListen({ view, baseListen: viewJs.listen }),
        surfaces: params.get("surfaces") ?? undefined,
        backend: params.get("backend") ?? undefined,
        onError: (m) => setStatus(m, "error"),
    });
    const mine = client;
    client.ready.catch((e) => {
        if (client !== mine) return;   // a view since replaced by a restart
        viewFailed = true;
        setStatus(`the view failed: ${e.message}`, "error");
    });
    // A double click frames what it hit, as it did before the View made that opt-in (through the
    // bridge's view.call, queued until the worker's View exists).
    client.view.setDoubleClickFrames(true);
}

// The wasm trapped: the worker is gone for good, and the view's canvas with it -- a canvas
// hands its drawing to a worker once only. The client lets go (its input listeners, its
// size watch), a fresh copy of the canvas takes the old one's place, and a new worker boots
// with a new client on it; the graph is sent again once it is ready.
function restart(message) {
    setStatus(`the kernel crashed: ${message} -- restarting`, "error");
    client?.free();
    client = null;
    worker.terminate();
    const fresh = viewCanvas.cloneNode(false);
    viewCanvas.replaceWith(fresh);
    viewCanvas = fresh;
    lastSent = null;
    inflight = null;
    boot();
}

// A CAD file of the user's own: read by the kernel in the worker, each of its bodies a
// `solid.body` node of the document (the B-rep held in the file), drawn at once.
async function openCadFile(file) {
    if (!ready) { setStatus("the kernel is still loading", "error"); return; }
    try {
        const bytes = await file.arrayBuffer();
        const { bodies } = await ask({ kind: "body", name: file.name, bytes }, [bytes]);
        const box = $("canvas").getBoundingClientRect();
        const at = canvas.convertOffsetToCanvas ? canvas.convertOffsetToCanvas([40, box.height / 2]) : [40, 40];
        bodies.forEach((body, i) => {
            const node = LiteGraph.createNode(PREFIX + "Document");
            node.properties.docId = freshId();
            node.properties.raw = { node: { id: node.properties.docId, kind: "solid.body", name: bodies.length > 1 ? `${file.name} ${i + 1}` : file.name, body: JSON.parse(body) } };
            node.onConfigure();
            node.pos = [at[0], at[1] + 60 * i];
            graph.add(node);
        });
        schedule(0);
    } catch (e) {
        setStatus(`could not read ${file.name}: ${e.message}`, "error");
    }
}

function schedule(delay = SETTLE_MS) {
    clearTimeout(settle);
    settle = setTimeout(() => { settle = 0; send(); }, delay);
}

// A drag moves boxes: the document changes with them (their places are its `meta.loom`), but
// nothing is evaluated again -- the worker's evaluation keys leave out `meta`. The canvas is
// sent only when its nodes changed since the last send.
let lastSent = null;
function send() {
    if (!ready) return;
    let nodes;
    const data = toGraph();
    try { nodes = graphToNodes(data); }
    catch (e) { setStatus(e.message, "error"); return; }
    const draw = drawSet(data, nodes);
    const key = JSON.stringify({ nodes, draw });
    if (key === lastSent) return;
    lastSent = key;
    refused = false;
    inflight = ++seq;
    worker.postMessage({ kind: "evaluate", seq: inflight, nodes, draw, message: "loom" });
    if (nodes.length) setStatus("evaluating…", "");
}

let lastResult = null;
function applyResult(data) {
    lastResult = data;
    if (data.error && !Object.keys(data.nodes).length) { setStatus(data.error, "error"); return; }
    let errors = 0;
    for (const n of graph._nodes) {
        const r = data.nodes[n.properties.docId];
        if (!r) continue;
        n.boxcolor = r.state === "ok" ? "#7CC48A" : r.state === "error" ? "#E5646A" : "#E0B25A";
        n.properties.error = r.error;
        n.outputs[0].label = r.count > 1 ? `×${r.count}` : "";
        if (r.state === "error") errors++;
    }
    graph.setDirtyCanvas(true, true);
    // The worker drew them itself: what comes back is each one's counts, for the caption.
    const solids = data.drawn.flatMap((d) => d.solids);
    // Not over a failed view: client.ready's own rejection said so, and that stays the
    // status line's last word rather than a caption for a part that will never draw.
    if (data.error) setStatus(`refused: ${data.error}`, "error");
    else if (!viewFailed) setStatus(`${graph._nodes.length} nodes · ${captionOf(solids)} · ${data.ms} ms${errors ? ` · ${errors} failed` : ""}`, errors ? "error" : "ready");
    if (selected) showDetail(selected);
}

function setStatus(text, cls) {
    $("status-text").textContent = text;
    $("status").className = cls;
}

let selected = null;
function showDetail(node) {
    selected = node;
    const def = REGISTRY.get(node.type.slice(PREFIX.length)) ?? { label: node.title, doc: `the document's ${node.properties.raw?.node?.kind ?? "node"}, kept as it is` };
    const detail = $("detail");
    detail.textContent = "";
    const title = document.createElement("b");
    title.textContent = def.label;
    detail.appendChild(title);
    detail.appendChild(document.createTextNode(` — ${def.doc.replace(/`/g, "")}`));
    if (node.properties.error) { const e = document.createElement("span"); e.className = "err"; e.textContent = ` ${node.properties.error}`; detail.appendChild(e); }
}

// ---- the view ---------------------------------------------------------------------------

// The worker draws the view (its grid, the camera's framing and the keep-camera rule
// included: loom-worker.js); the page keeps the canvas it transfers there, replaced by a
// fresh copy after a crash (`restart`).
const view = $("view");
let viewCanvas = view.querySelector("canvas");

// A new graph loaded: the worker frames its next part afresh rather than into the old
// part's frame.
function reframe() {
    worker?.postMessage({ kind: "reframe" });
}

function frame() {
    // The graph canvas follows its box: a page laid out while hidden has it at a few pixels
    // until the box gets its size, which a ResizeObserver does not always report.
    if (canvas) {
        const box = canvas.canvas.parentElement;
        if (box.offsetWidth && (canvas.canvas.width !== box.offsetWidth || canvas.canvas.height !== box.offsetHeight)) canvas.resize(box.offsetWidth, box.offsetHeight);
    }
    requestAnimationFrame(frame);
}

// ---- files and links ----------------------------------------------------------------------

let loaded = null;

// A document's text on the canvas, through the worker (which holds it from now on). A text
// that is no document is refused in the document's words.
async function openText(text, what = "the file") {
    const why = notDocument(text);
    refused = Boolean(why);
    if (why) { setStatus(`${what}: ${why}`, "error"); return false; }
    if (!ready) { pendingOpen = text; return true; }
    try {
        const { nodes } = await ask({ kind: "open", text });
        fromGraph(nodesToGraph(nodes));
        lastSent = JSON.stringify({ nodes, draw: drawSet(toGraph(), nodes) });
        lastSent = null;
        reframe();
        schedule(0);
        return true;
    } catch (e) {
        setStatus(`${what}: ${e.message}`, "error");
        return false;
    }
}

async function loadExample(id) {
    const example = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
    if (loaded && graph._nodes.length && !confirm("Replace the graph with this example? The edits here will be lost.")) return false;
    loaded = example;
    $("example").value = example.id;
    const text = await fetch(new URL(`./loom-examples/${example.id}.json`, import.meta.url)).then((r) => r.text());
    return openText(text, example.title);
}

function download(name, text, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The document as the worker holds it, every change so far in its history.
async function saved() {
    send();
    return (await ask({ kind: "save" })).text;
}

// ---- go ---------------------------------------------------------------------------------

if (!supported()) {
    $("unsupported").style.display = "block";
    setStatus("unsupported browser", "error");
    for (const id of ["example", "open", "open-cad", "save", "link", "export", "copy-script", "language"]) $(id).disabled = true;
} else {
    for (const e of EXAMPLES) {
        const o = document.createElement("option");
        o.value = e.id;
        o.textContent = e.title;
        o.title = e.blurb;
        $("example").appendChild(o);
    }
    canvas = new LGraphCanvas($("canvas"), graph);
    canvas.background_image = null;
    canvas.clear_background_color = "#1C1B1A";
    canvas.render_canvas_border = false;
    canvas.allow_searchbox = true;
    canvas.onNodeSelected = (node) => showDetail(node);
    LiteGraph.release_link_on_empty_shows_menu = true;
    canvas.showSearchBox = (e, options = {}) => {
        if (options.node_from) openPicker(e, { from: { node: options.node_from, slot: options.node_from.outputs.indexOf(options.slot_from) } });
        else if (options.node_to) openPicker(e, { to: { node: options.node_to, slot: options.node_to.inputs.indexOf(options.slot_from) } });
        else openPicker(e);
    };
    canvas.showConnectionMenu = (opts) => {
        if (opts.nodeFrom) openPicker(opts.e, { from: { node: opts.nodeFrom, slot: opts.nodeFrom.outputs.indexOf(opts.slotFrom) } });
        else if (opts.nodeTo) openPicker(opts.e, { to: { node: opts.nodeTo, slot: opts.nodeTo.inputs.indexOf(opts.slotTo) } });
    };
    // A box made here gets a document id no node holds (a loaded box keeps its own).
    graph.onNodeAdded = (node) => { if (node.properties && !node.properties.docId) node.properties.docId = freshId(); schedule(); };
    graph.onNodeRemoved = () => schedule();
    graph.onAfterChange = () => schedule();
    const fit = () => { const box = $("canvas").parentElement.getBoundingClientRect(); canvas.resize(Math.floor(box.width), Math.floor(box.height)); };
    // Home and F: the graph, or the selection, framed. Not while typing in the picker.
    $("canvas").addEventListener("keydown", (e) => {
        if (e.key === "Home") { fitView(graph._nodes); e.preventDefault(); }
        else if (e.key === "f" || e.key === "F") { const chosen = Object.values(canvas.selected_nodes); fitView(chosen.length ? chosen : graph._nodes); e.preventDefault(); }
    });
    // The browser's menu fires where the right button is RELEASED, so a right-drag that ends
    // off the canvas would open it: suppressed page-wide, except over a text field.
    document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input, textarea, [contenteditable]")) e.preventDefault(); });
    new ResizeObserver(fit).observe($("canvas").parentElement);
    fit();
    graph.start();

    // The file the graph was opened from or saved to, as the forge keeps it: a save writes back.
    const file = filePicker({ name: "loom.json" });
    // An example is no file of yours: the next save asks where.
    $("example").addEventListener("change", async () => { if (await loadExample($("example").value)) file.forget(); else $("example").value = loaded?.id ?? ""; });
    const openFile = async () => {
        try {
            const picked = await file.open();
            if (picked && await openText(picked.text, picked.name)) loaded = { id: picked.name.replace(/\.json$/i, "") };
        } catch (e) { setStatus(`open: ${e.message}`, "error"); }
    };
    const saveFile = async (asNew = false) => {
        try {
            const name = await file.save(await saved(), { asNew, name: `${loaded?.id ?? "loom"}.json` });
            if (name) setStatus(`${name}: saved`, "ready");
        } catch (e) { setStatus(`save: ${e.message}`, "error"); }
    };
    $("open").addEventListener("click", openFile);
    $("open-cad").addEventListener("click", () => $("cad-file").click());
    $("cad-file").addEventListener("change", () => {
        const [file] = $("cad-file").files;
        $("cad-file").value = "";
        if (file) openCadFile(file);
    });
    $("save").addEventListener("click", () => saveFile(false));
    fileKeys({ save: saveFile, open: openFile });
    $("link").addEventListener("click", async () => {
        const url = new URL(location.href);
        url.search = "";
        url.searchParams.set("doc", await pack(await saved()));
        history.replaceState(null, "", url);
        const b = $("link"); const was = b.textContent;
        try { await navigator.clipboard.writeText(url.href); b.textContent = "link copied"; } catch { b.textContent = "in the address bar"; }
        setTimeout(() => { b.textContent = was; }, 1500);
    });
    $("clear").addEventListener("click", () => { if (confirm("Clear the graph?")) { graph.clear(); loaded = null; file.forget(); fitView([]); schedule(0); } });
    const exported = () => {
        try { return scriptOf(graphToNodes(toGraph()), $("language").value); }
        catch (e) { setStatus(`export: ${e.message}`, "error"); return null; }
    };
    $("export").addEventListener("click", () => {
        const text = exported();
        if (text !== null) download(`${loaded?.id ?? "graph"}.${$("language").value === "python" ? "py" : "js"}`, text, "text/plain");
    });
    $("copy-script").addEventListener("click", async () => {
        const text = exported();
        if (text === null) return;
        const b = $("copy-script"); const was = b.textContent;
        try { await navigator.clipboard.writeText(text); b.textContent = "copied"; } catch { b.textContent = "clipboard blocked"; }
        setTimeout(() => { b.textContent = was; }, 1200);
    });

    // For the console and the tests: the graph, the canvas, the canvas as the loom's graph
    // and as the document's nodes, opening a document's text and saving the one held.
    window.loom = { graph, canvas, toGraph, fromGraph, schedule, nodes: () => graphToNodes(toGraph()), open: openText, save: saved,
        // Settled: nothing waiting to be sent, nothing in flight; and the last answer.
        idle: () => ready && !settle && inflight === null, result: () => lastResult, status: () => $("status-text").textContent };
    requestAnimationFrame(frame);
    const params = new URLSearchParams(location.search);
    setStatus("loading…", "");
    boot();
    // A link's document, or an old link's graph (refused in the document's words), else an example.
    const link = params.get("doc") ?? params.get("graph");
    if (link) {
        unpack(link).then((text) => openText(text, "the link"))
            .catch((e) => setStatus(`the link could not be read: ${e.message}`, "error"));
    } else {
        loadExample((EXAMPLES.find((e) => e.id === params.get("example")) ?? EXAMPLES[0]).id);
    }
}
