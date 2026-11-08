// The loom on the blacksmith document: a canvas (the loom's graph, `{ nodes: [{ id, kind, x,
// y, params, lacing, preview, docId, raw }], wires: [{ from, to: [id, port] }] }`) as the
// document's nodes and back, the one batch op that takes the worker's document from one
// set of nodes to the next, and the refusal of a file that is not a document.
// Environment-free: the page, the worker and test/loom*.mjs call these, the page and the
// tests once the palette has its kinds (loom-nodes.js `useKinds`).
//
// - A kind's box is a node of that kind: each port its field, a wire into an input its
//   upstream node's id (a list input's ports, `solids`, `solids 2`..., the list of their
//   ids), into a frame field or a face or edge pick the id too, into any other field an
//   expression naming it (`"=w"`); an unwired port its widget's value.
// - A number or list box is a `value` node holding the expression its ports make
//   (`"=zip(r * cos(a), r * sin(a), -5)"`); `meta.loom` keeps its ports' values and wires,
//   so the box comes back as it was. A value node whose expression is no longer what its
//   box would make (edited elsewhere) comes back as an expression box.
// - `meta.loom` holds the canvas: `{ x, y }` (and `node`, the box, for a value node),
//   `preview` and `collapsed` when set.
// - A field loom cannot show as a port (an expression written elsewhere) is kept as it was
//   (`raw`) until its port is wired or edited; a node of a kind the palette does not show is
//   kept whole (a `Document` box).
import { REGISTRY, VALUE_BOXES, portBase, portIndex, portName } from "./loom-nodes.js";

export const FORMAT = "cadaclysm-blacksmith";
export { VALUE_BOXES };

// ---- ids ---------------------------------------------------------------------------------

const RESERVED = new Set(["min", "max", "clamp", "abs", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "round", "floor",
    "ceil", "range", "repeat", "item", "slice", "merge", "flatten", "reverse", "len", "polar", "if", "zip",
    "and", "or", "not", "true", "false", "mm", "cm", "m", "in", "ft", "deg", "rad", "xy", "xz", "yz"]);
/** A box's id as a document id an expression can name: letters, digits and `_`, not a reserved word. */
export function docIdOf(id) {
    let s = String(id).replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z_]/.test(s)) s = `n${s}`;
    return RESERVED.has(s) ? `${s}_` : s;
}

// ---- literals ----------------------------------------------------------------------------

// A number as an expression writes it: JavaScript's shortest round-trip form, which the
// document's lexer reads back to the same f64.
const numText = (v) => (Object.is(v, -0) ? "-0.0" : String(v));
function litText(v) {
    if (typeof v === "number") return numText(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (Array.isArray(v)) return `[${v.map(litText).join(", ")}]`;
    throw new Error(`not a value an expression can hold: ${JSON.stringify(v)}`);
}

// ---- the canvas as the document's nodes --------------------------------------------------------

/** The document's nodes for a canvas `graph`, in its order. */
export function graphToNodes(graph) {
    const byId = new Map(graph.nodes.map((n) => [String(n.id), n]));
    const idOf = (n) => n.docId ?? docIdOf(n.id);
    const wiresTo = new Map();
    for (const w of graph.wires) {
        const key = String(w.to[0]);
        if (!wiresTo.has(key)) wiresTo.set(key, new Map());
        wiresTo.get(key).set(w.to[1], byId.get(String(w.from)));
    }
    return graph.nodes.map((n) => nodeOf(n, wiresTo.get(String(n.id)) ?? new Map(), idOf));
}

function loomMeta(n, extra = {}) {
    const meta = { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0), ...extra };
    if (n.preview) meta.preview = true;
    if (n.collapsed) meta.collapsed = true;
    return { loom: meta };
}

function nodeOf(n, wired, idOf) {
    if (n.kind === "Document") return { ...n.raw.node, meta: { ...(n.raw.node.meta ?? {}), ...loomMeta(n, { node: "Document" }) } };
    const def = REGISTRY.get(n.kind);
    if (!def) throw new Error(`no box ${n.kind}`);
    const id = idOf(n);
    if (VALUE_BOXES.has(n.kind)) {
        const { value, params, wires } = valueOf(n, def, wired, idOf);
        const extra = { node: n.kind };
        if (Object.keys(params).length) extra.params = params;
        if (Object.keys(wires).length) extra.wires = wires;
        return { id, kind: "value", meta: loomMeta(n, extra), value };
    }
    // A list input's ports in their order: `solids`, `solids 2`, ...
    const items = new Map();
    for (const [port, src] of wired) {
        const base = portBase(port);
        if (!src || !def.inputs.some((p) => p.name === base && p.role === "inputs")) continue;
        if (!items.has(base)) items.set(base, []);
        items.get(base).push([portIndex(port), idOf(src)]);
    }
    const fields = {};
    for (const p of def.inputs) {
        if (p.role === "inputs" && items.has(p.name)) {
            fields[p.field] = items.get(p.name).sort((a, b) => a[0] - b[0]).map(([, sid]) => sid);
            continue;
        }
        const src = p.role === "inputs" ? null : wired.get(p.name);
        if (src) {
            const sid = idOf(src);
            fields[p.field] = p.role === "field" ? `=${sid}` : sid;
            continue;
        }
        if (n.raw && p.field in n.raw) { fields[p.field] = n.raw[p.field]; continue; }
        const v = n.params?.[p.name];
        if (v !== undefined && v !== null) fields[p.field] = v;
    }
    // Fields no port shows (a name, a field of a newer kernel): kept as they were.
    for (const [k, v] of Object.entries(n.raw ?? {})) if (!(k in fields) && !def.inputs.some((p) => p.field === k)) fields[k] = v;
    const node = { id, kind: n.kind, meta: loomMeta(n), ...fields };
    if (n.lacing === "cross") node.lacing = "cross";
    return node;
}

// A value box's expression: its ports' values or the ids wired to them, in the box's shape.
function valueOf(n, def, wired, idOf) {
    const params = {}, wires = {};
    const arg = (name, fallback) => {
        const src = wired.get(name);
        if (src) { wires[name] = idOf(src); return idOf(src); }
        let v = n.params?.[name];
        if (v === undefined || v === null) v = def.inputs.find((p) => p.name === name)?.default ?? fallback;
        else params[name] = v;
        return litText(v);
    };
    for (const p of def.inputs) if (p.slot === false && n.params?.[p.name] !== undefined) params[p.name] = n.params[p.name];
    const a = (name, fallback) => arg(name, fallback);
    let value;
    switch (n.kind) {
        case "Number": case "Integer": case "Boolean": {
            const src = wired.get("value");
            if (src) { wires.value = idOf(src); value = `=${idOf(src)}`; }
            // The value is the node's field alone: one copy, which an edit elsewhere changes.
            else value = n.params?.value ?? def.inputs[0].default;
            break;
        }
        case "Expression": {
            const text = String(n.params?.expression ?? "0");
            params.expression = text;
            value = text.startsWith("=") ? text : `=${text}`;
            break;
        }
        case "Angle": value = `=${a("degrees")} * 1 deg`; break;
        case "Vector2": value = `=zip(${a("x")}, ${a("y")})`; break;
        case "Vector3": value = `=zip(${a("x")}, ${a("y")}, ${a("z")})`; break;
        case "Math": {
            const op = n.params?.op ?? "add";
            params.op = op;
            const x = a("a"), y = a("b");
            value = "=" + ({ add: `${x} + ${y}`, subtract: `${x} - ${y}`, multiply: `${x} * ${y}`, divide: `${x} / ${y}`, min: `min(${x}, ${y})`,
                max: `max(${x}, ${y})`, power: `${x} ^ ${y}`, modulo: `${x} - ${y} * floor(${x} / ${y})` })[op];
            break;
        }
        case "Range": {
            const count = a("count"), from = a("from"), to = a("to");
            // The loom's own: `from + (to - from) * i / steps`, steps the count (closed: it goes
            // round) or one less, at least 1.
            const closedWire = wired.get("closed");
            let steps;
            if (closedWire) { wires.closed = idOf(closedWire); steps = `if(${idOf(closedWire)}, max(${count}, 1), max(${count} - 1, 1))`; }
            else {
                const closed = Boolean(n.params?.closed);
                if (n.params?.closed !== undefined) params.closed = n.params.closed;
                steps = closed ? `max(${count}, 1)` : `max(${count} - 1, 1)`;
            }
            value = `=${from} + (${to} - ${from}) * range(${count}) / ${steps}`;
            break;
        }
        case "Item": value = `=item(${a("list")}, ${a("index")})`; break;
        case "Length": value = `=len(${a("list")})`; break;
        case "Repeat": value = `=repeat(${a("value")}, ${a("count")})`; break;
        case "Merge": value = `=merge(${a("a")}, ${a("b")})`; break;
        case "Reverse": value = `=reverse(${a("list")})`; break;
        case "Flatten": value = `=flatten(${a("list")})`; break;
        case "Slice": {
            const list = a("list"), from = a("from");
            const toWire = wired.get("to");
            if (toWire) { wires.to = idOf(toWire); value = `=slice(${list}, ${from}, if(${idOf(toWire)} == 0, len(${list}), ${idOf(toWire)}))`; }
            else {
                const to = n.params?.to;
                if (to !== undefined) params.to = to;
                value = to ? `=slice(${list}, ${from}, ${litText(to)})` : `=slice(${list}, ${from})`;
            }
            break;
        }
        case "Polar": {
            const r = a("radius"), ang = a("angle"), z = a("z", 0);
            value = `=zip(${r} * cos(${ang}), ${r} * sin(${ang}), ${z})`;
            break;
        }
        default: throw new Error(`no expression for ${n.kind}`);
    }
    return { value, params, wires };
}

// ---- the document's nodes as a canvas ------------------------------------------------------------

// Whether port `p`'s widget can show `v`: a number for a number, a named plane for a frame,
// a point's numbers, any list for a list field's text. An expression never.
function fitsWidget(p, v) {
    switch (p.widget) {
        case "number": case "integer": return typeof v === "number";
        case "boolean": return typeof v === "boolean";
        case "text": return typeof v === "string" && !v.startsWith("=");
        case "choice": return typeof v === "string" && (p.choices ?? []).includes(v);
        case "vector2": case "vector3": return Array.isArray(v) && v.length === (p.widget === "vector2" ? 2 : 3) && v.every((x) => typeof x === "number");
        case "json": return typeof v !== "string" && !JSON.stringify(v).includes('"=');
        default: return false;
    }
}

/**
 * The canvas for a document's `nodes`: `{ nodes, wires }`, each box with its `docId`. A node
 * of a kind the palette does not show keeps its fields as they were (a `Document` box).
 */
export function nodesToGraph(nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    const out = [], wires = [];
    const exprId = (v) => (typeof v === "string" && /^=([A-Za-z_]\w*)$/.exec(v)?.[1]) || null;
    for (const d of nodes) {
        const meta = d.meta?.loom ?? {};
        const box = { id: d.id, docId: d.id, x: meta.x ?? 0, y: meta.y ?? 0, params: {} };
        if (meta.preview) box.preview = true;
        if (meta.collapsed) box.collapsed = true;
        if (d.kind === "value") {
            const kind = VALUE_BOXES.has(meta.node) ? meta.node : "Expression";
            box.kind = kind;
            if (kind !== "Expression") {
                box.params = { ...(meta.params ?? {}) };
                if (["Number", "Integer", "Boolean"].includes(kind) && typeof d.value !== "string" && !meta.wires?.value) box.params.value = d.value;
                for (const [port, from] of Object.entries(meta.wires ?? {})) if (ids.has(from)) wires.push({ from, to: [d.id, port] });
                // The box as it would write itself: when that is not the node's expression (it
                // was edited elsewhere), an expression box shows what the node holds.
                const again = nodeOf(box, new Map(Object.entries(meta.wires ?? {}).map(([p, f]) => [p, { id: f, docId: f }])), (n) => n.docId ?? n.id);
                if (JSON.stringify(again.value) !== JSON.stringify(d.value)) {
                    box.kind = "Expression";
                    box.params = { expression: typeof d.value === "string" ? d.value.replace(/^=/, "") : litText(d.value) };
                    for (let i = wires.length - 1; i >= 0; i--) if (wires[i].to[0] === d.id) wires.splice(i, 1);
                }
            } else box.params = { expression: typeof d.value === "string" ? d.value.replace(/^=/, "") : litText(d.value) };
            out.push(box);
            continue;
        }
        const def = REGISTRY.get(d.kind);
        if (!def?.document) {
            // A kind the palette does not show (a held body, a kind made elsewhere): kept whole.
            const { meta: m, ...rest } = d;
            const own = { ...(m ?? {}) };
            delete own.loom;
            box.kind = "Document";
            box.raw = { node: Object.keys(own).length ? { ...rest, meta: own } : rest };
            out.push(box);
            continue;
        }
        box.kind = d.kind;
        if (d.lacing === "cross") box.lacing = "cross";
        const raw = {};
        const used = new Set(["id", "kind", "meta", "lacing"]);
        for (const p of def.inputs) {
            used.add(p.field);
            const v = d[p.field];
            if (v === undefined) continue;
            const to = (from, port = p.name) => wires.push({ from, to: [d.id, port] });
            if (p.role === "inputs") {
                // A list of node ids: one port an id.
                if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && ids.has(x))) v.forEach((x, i) => to(x, portName(p.name, i)));
                else raw[p.field] = v;
                continue;
            }
            const src = p.role === "field" ? exprId(v) : typeof v === "string" && ids.has(v) ? v : null;
            if (src && ids.has(src)) to(src);
            else if (fitsWidget(p, v)) box.params[p.name] = v;
            else raw[p.field] = v;
        }
        // Fields no port shows: kept as they were.
        for (const k of Object.keys(d)) if (!used.has(k)) raw[k] = d[k];
        if (Object.keys(raw).length) box.raw = raw;
        out.push(box);
    }
    return { nodes: out, wires };
}

// ---- comparing and diffing nodes -------------------------------------------------------------------

/** A value with every object's keys sorted: two nodes are the same when these are. */
export function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
    return v;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// The ids a node names: input ids and the names in its expressions.
function refsOf(node, ids) {
    const out = new Set();
    const walk = (v) => {
        if (typeof v === "string") {
            if (ids.has(v)) out.add(v);
            if (v.startsWith("=")) for (const m of v.matchAll(/[A-Za-z_]\w*/g)) if (ids.has(m[0])) out.add(m[0]);
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    for (const [k, v] of Object.entries(node)) if (!["id", "kind", "meta", "name"].includes(k)) walk(v);
    out.delete(node.id);
    return out;
}

/**
 * The one batch op that takes a document whose nodes are `before` to `after`, or null when
 * they are the same: `set`s first (a node no longer reading what goes), then the `remove`s,
 * readers before what they read, then the `add`s.
 */
export function opsBetween(before, after) {
    const old = new Map(before.map((n) => [n.id, n]));
    const now = new Map(after.map((n) => [n.id, n]));
    const sets = [], removes = [], adds = [];
    for (const n of after) {
        const o = old.get(n.id);
        if (!o) { adds.push({ op: "add", node: n }); continue; }
        if (o.kind !== n.kind) { removes.push(n.id); adds.push({ op: "add", node: n }); continue; }
        const fields = {};
        for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
            if (k === "id" || k === "kind") continue;
            if (!same(o[k], n[k])) fields[k] = n[k] === undefined ? null : n[k];
        }
        if (Object.keys(fields).length) sets.push({ op: "set", id: n.id, fields });
    }
    for (const o of before) if (!now.has(o.id)) removes.push(o.id);
    if (!sets.length && !removes.length && !adds.length) return null;
    // Readers first: a node goes once nothing left to go reads it.
    const gone = new Set(removes);
    const reads = new Map(removes.map((id) => [id, refsOf(old.get(id), gone)]));
    const ordered = [];
    while (gone.size) {
        const next = [...gone].find((id) => ![...gone].some((r) => r !== id && reads.get(r).has(id))) ?? [...gone][0];
        ordered.push(next);
        gone.delete(next);
    }
    return { op: "batch", ops: [...sets, ...ordered.map((id) => ({ op: "remove", id })), ...adds] };
}

// ---- files ---------------------------------------------------------------------------------------

/**
 * Why `text` is not a blacksmith document, in the words every app uses, or null when it is
 * one: ``not a cadaclysm-blacksmith document: its format is "loom"``.
 */
export function notDocument(text) {
    let data;
    try { data = JSON.parse(text); } catch { return "not a cadaclysm-blacksmith document (it is not JSON)"; }
    const format = data && typeof data === "object" && !Array.isArray(data) ? data.format : undefined;
    if (format === FORMAT) return null;
    if (typeof format === "string") return `not a cadaclysm-blacksmith document: its format is ${JSON.stringify(format)}`;
    // A loom graph of before (`{ version, nodes, wires }`) names no format.
    return "not a cadaclysm-blacksmith document: it names no format";
}

const b64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
/** A document's text as `?doc=`: deflate-raw, then base64url. */
export async function pack(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return b64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
/** `?doc=`'s text back. */
export async function unpack(code) {
    const stream = new Blob([unb64(code)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
}
