// The loom's palette: every box the canvas can hold. Each box is one node of a blacksmith
// document (loom-doc.js turns a canvas into one). The document's own kinds are the boxes,
// built at runtime from the kernel's `document_kinds()` (`useKinds`): each kind one box, each
// of its fields a port, typed, defaulted and documented as the kind says. loom-ui.json says
// only what the palette makes of them: the kinds shown and hidden, the groups, short labels,
// the record wires' types and what a fresh node starts at. The numbers and lists -- sliders,
// vectors, maths, ranges and list tools, a free expression -- are BUILTIN_NODES here, each a
// `value` node holding one expression. Angles are degrees everywhere, as the document takes
// them.

// A builtin's port: `{ name, type, mode: "item" | "list", default, optional, slot, choices }`
// (`slot: false`: a widget with no port).
export const BUILTIN_NODES = [
    { kind: "Number", group: "Numbers", label: "number", doc: "A number, as a slider between `min` and `max`.",
      // `min` and `max` are the slider's range, never wired (`slot: false`): the page gives them no port.
      inputs: [{ name: "value", type: "number", mode: "item", default: 10 }, { name: "min", type: "number", mode: "item", default: 0, optional: true, slot: false }, { name: "max", type: "number", mode: "item", default: 100, optional: true, slot: false }],
      output: { type: "number", list: false } },
    { kind: "Integer", group: "Numbers", label: "integer", doc: "A whole number.",
      inputs: [{ name: "value", type: "integer", mode: "item", default: 4 }], output: { type: "integer", list: false } },
    { kind: "Boolean", group: "Numbers", label: "boolean", doc: "True or false.",
      inputs: [{ name: "value", type: "boolean", mode: "item", default: true }], output: { type: "boolean", list: false } },
    { kind: "Expression", group: "Numbers", label: "expression", doc: "Any expression of the document: numbers with units, lists (`range(0, 360, 60)`), comparisons, `if(c, a, b)`, other boxes by their id.",
      inputs: [{ name: "expression", type: "text", mode: "item", default: "0" }], output: { type: "any", list: false } },
    { kind: "Vector2", group: "Numbers", label: "vector (x, y)", doc: "A point or direction on a profile's plane.",
      inputs: [{ name: "x", type: "number", mode: "item", default: 0 }, { name: "y", type: "number", mode: "item", default: 0 }],
      output: { type: "vector2", list: false } },
    { kind: "Vector3", group: "Numbers", label: "vector (x, y, z)", doc: "A point or direction in space.",
      inputs: [{ name: "x", type: "number", mode: "item", default: 0 }, { name: "y", type: "number", mode: "item", default: 0 }, { name: "z", type: "number", mode: "item", default: 0 }],
      output: { type: "vector3", list: false } },
    { kind: "Angle", group: "Numbers", label: "angle", doc: "An angle in degrees.",
      inputs: [{ name: "degrees", type: "number", mode: "item", default: 90 }], output: { type: "number", list: false } },
    { kind: "Math", group: "Numbers", label: "maths", doc: "`a op b`: add, subtract, multiply, divide, min, max, power, modulo.",
      inputs: [{ name: "op", type: "choice", mode: "item", default: "add", choices: ["add", "subtract", "multiply", "divide", "min", "max", "power", "modulo"] },
               { name: "a", type: "number", mode: "item", default: 0 }, { name: "b", type: "number", mode: "item", default: 0 }],
      output: { type: "number", list: false } },
    { kind: "Range", group: "Lists", label: "range", doc: "`count` numbers from `from` to `to`, the ends included -- the source of a list: angles round a bolt circle, positions along an edge.",
      inputs: [{ name: "count", type: "integer", mode: "item", default: 6 }, { name: "from", type: "number", mode: "item", default: 0 }, { name: "to", type: "number", mode: "item", default: 1 },
               { name: "closed", type: "boolean", mode: "item", default: false, optional: true }],
      output: { type: "number", list: true } },
    { kind: "Item", group: "Lists", label: "item", doc: "One item of a list, by index (0 first; negative counts from the end).",
      inputs: [{ name: "list", type: "any", mode: "list" }, { name: "index", type: "integer", mode: "item", default: 0 }], output: { type: "any", list: false } },
    { kind: "Length", group: "Lists", label: "length", doc: "How many items a list has.",
      inputs: [{ name: "list", type: "any", mode: "list" }], output: { type: "integer", list: false } },
    { kind: "Repeat", group: "Lists", label: "repeat", doc: "A list of `count` copies of the value.",
      inputs: [{ name: "value", type: "any", mode: "item" }, { name: "count", type: "integer", mode: "item", default: 3 }], output: { type: "any", list: true } },
    { kind: "Merge", group: "Lists", label: "merge", doc: "One list of both lists, `a` then `b`.",
      inputs: [{ name: "a", type: "any", mode: "list" }, { name: "b", type: "any", mode: "list" }], output: { type: "any", list: true } },
    { kind: "Reverse", group: "Lists", label: "reverse", doc: "The list the other way round.",
      inputs: [{ name: "list", type: "any", mode: "list" }], output: { type: "any", list: true } },
    { kind: "Slice", group: "Lists", label: "slice", doc: "The items from `from` up to (not including) `to`; a negative index counts from the end, `to` left at 0 means the end.",
      inputs: [{ name: "list", type: "any", mode: "list" }, { name: "from", type: "integer", mode: "item", default: 0 }, { name: "to", type: "integer", mode: "item", default: 0, optional: true }],
      output: { type: "any", list: true } },
    { kind: "Flatten", group: "Lists", label: "flatten", doc: "The list and every list in it as one list.",
      inputs: [{ name: "list", type: "any", mode: "list" }], output: { type: "any", list: true } },
    { kind: "Polar", group: "Numbers", label: "polar", doc: "A point at `radius` from the z axis, `angle` (degrees) round from x, at height `z`: a bolt circle from a range of angles.",
      inputs: [{ name: "radius", type: "number", mode: "item", default: 10 }, { name: "angle", type: "number", mode: "item", default: 0, angle: true }, { name: "z", type: "number", mode: "item", default: 0, optional: true }],
      output: { type: "vector3", list: false } },
];

// Every box by name: the builtins', then the kinds' once `useKinds` has run.
export const REGISTRY = new Map(BUILTIN_NODES.map((n) => [n.kind, n]));
// The boxes that are `value` nodes.
export const VALUE_BOXES = new Set(BUILTIN_NODES.map((n) => n.kind));

// The named planes a frame field offers.
export const CHOICES = { frame: ["xy", "xz", "yz"] };

// ---- the document's kinds as boxes ---------------------------------------------------------

// loom-ui.json's lookups: a key ending in "." is a namespace, any other one kind.
const matches = (key, kind) => (key.endsWith(".") ? kind.startsWith(key) : key === kind);
const lookup = (table, kind) => { for (const [k, v] of Object.entries(table ?? {})) if (matches(k, kind)) return v; return undefined; };

/** Whether loom-ui.json's palette shows `kind`. */
export function shown(ui, kind) {
    return !(ui.hide ?? []).some((k) => matches(k, kind)) && (ui.show ?? []).some((k) => matches(k, kind));
}

// What a kind's output is on the canvas: its wire type, and whether it is a list. Bodies and
// sheets are solids to the wires (the evaluator checks the rest); a record is what
// loom-ui.json names it (a selector, a path, a face pick, the edges), else `record`.
function wireOf(type, kind, ui) {
    const list = /^list<(.+)>$/.exec(type);
    const base = list ? list[1] : type;
    let t;
    if (base === "body" || base === "sheet" || base === "solid") t = "solid";
    else if (base === "profiles" || base === "curve") t = "profile";
    else if (base === "record") t = (kind && lookup(ui.records, kind)) ?? "record";
    else if (base === "value") t = "any";
    else if (base === "bool") t = "boolean";
    else if (base === "point" || base === "vector") t = "vector3";
    else t = base;
    return { type: t, list: Boolean(list) || base === "profiles" };
}

// A field type as a port: its wire type, whether it takes a list, the widget an unwired port
// shows, and what a wire writes (`role`: "input" an id, "inputs" a list of ids, one port an
// item, "ref" an id the field reads as a face pick or edges, "frame" an id or a named plane,
// "field" an expression naming the box). A type with no wire type is a widget alone.
const FIELD = {
    number: { type: "number", widget: "number" }, int: { type: "integer", widget: "integer" }, bool: { type: "boolean", widget: "boolean" },
    text: { type: "text", widget: "text" }, choice: { type: "text", widget: "choice" }, expr: { type: "any", widget: "text" },
    point2: { type: "vector2", widget: "vector2" }, point3: { type: "vector3", widget: "vector3" }, vector3: { type: "vector3", widget: "vector3" },
    numbers: { type: "number", widget: "json", list: true }, ints: { type: "integer", widget: "json", list: true },
    points2: { type: "vector2", widget: "json", list: true }, points3: { type: "vector3", widget: "json", list: true },
    frame: { type: "frame", widget: "choice", role: "frame" }, frames: { type: "frame", role: "inputs" },
    plane: { type: "frame", widget: "json" },
    face_ref: { type: "face", role: "ref" }, face_refs: { type: "face", role: "ref" }, edge_refs: { type: "edges", role: "ref" }, vertex_ref: { type: "vertex", role: "ref" },
    json: { type: null, widget: "json" }, path: { type: null, widget: "json" }, body: { type: null },
};

// One field of a kind as a port: `{ name, field, type, mode, role, widget, default, optional,
// choices, range, positive, unit, start, slot }`.
function portOf(p, kind, ui) {
    const port = { name: p.name, field: p.name };
    if (p.role === "input") {
        Object.assign(port, { type: wireOf(p.type, null, ui).type, mode: p.list ? "list" : "item", role: p.list ? "inputs" : "input" });
    } else {
        const f = FIELD[p.type] ?? { type: null, widget: "json" };
        Object.assign(port, { type: f.type ?? "any", mode: f.list || f.role === "inputs" ? "list" : "item", role: f.role ?? "field" });
        if (f.widget) port.widget = f.widget;
        if (f.type === null) port.slot = false;
    }
    // A record port takes what loom-ui.json says it does (a path, a selector), else any record.
    const narrowed = lookup(ui.ports, kind)?.[p.name];
    if (narrowed) port.type = narrowed;
    if (p.default !== undefined) port.default = p.default;
    if (p.optional) port.optional = true;
    if (p.choices) port.choices = p.choices;
    else if (port.widget === "choice") port.choices = CHOICES[p.type];
    if (p.range) port.range = p.range;
    if (p.positive) port.positive = true;
    if (p.unit) port.unit = p.unit;
    const start = ui.start?.[kind]?.[p.name];
    if (start !== undefined) port.start = start;
    return port;
}

/** A kind of `document_kinds()` as a box. */
export function boxOf(k, ui) {
    const short = k.name.slice(k.name.indexOf(".") + 1).replace(/_/g, " ");
    return {
        kind: k.name, group: lookup(ui.groups, k.name) ?? "Other", label: ui.labels?.[k.name] ?? short, doc: k.doc ?? "",
        inputs: k.params.map((p) => portOf(p, k.name, ui)), output: wireOf(k.output, k.name, ui), document: true,
    };
}

/**
 * The palette from the kernel's kinds table (`document_kinds()`, its JSON or parsed) and
 * loom-ui.json: every kind it shows becomes a box of REGISTRY, beside the builtins. Called
 * once the kernel is up, before any canvas is made.
 */
export function useKinds(kindsJson, ui) {
    const kinds = typeof kindsJson === "string" ? JSON.parse(kindsJson) : kindsJson;
    for (const k of kinds) if (shown(ui, k.name) && !REGISTRY.has(k.name)) REGISTRY.set(k.name, boxOf(k, ui));
    return REGISTRY;
}

// ---- ports -----------------------------------------------------------------------------------

// A list port's items: `solids`, `solids 2`, `solids 3`..., one wire each, in that order. The
// page keeps one free port after the last wired one.
export const portBase = (name) => name.replace(/ \d+$/, "");
export const portIndex = (name) => { const m = / (\d+)$/.exec(name); return m ? Number(m[1]) - 1 : 0; };
export const portName = (base, i) => (i === 0 ? base : `${base} ${i + 1}`);
// Whether an optional port with nothing for a default (a face to colour, a shell's open
// faces) is a slot alone on the page: no widget, no param, the kind's own default.
export const isBare = (p) => Boolean(p.optional && (p.default == null || (Array.isArray(p.default) && !p.default.length)));
// A port's starting value on a fresh node: loom-ui.json's start (a cuboid's 10), else the
// kind's default, else the widget's own (zero, or one where the field must be positive,
// within its range; false, "", zeros, the first choice), which is a value -- a translate by
// (0, 0, 0) is a translate. Undefined for a port with no widget: an input (the wire carries
// it), a list, a bare optional.
export function startValue(p) {
    if (isBare(p) || p.role === "input" || p.role === "inputs" || p.role === "ref") return undefined;
    if (p.field && !p.widget) return undefined;
    if (p.start !== undefined) return p.start;
    if (p.default !== undefined) return p.default;
    if (p.mode === "list" && p.widget !== "json") return undefined;
    const choices = p.choices ?? CHOICES[p.type];
    if (choices) return choices[0];
    switch (p.widget ?? p.type) {
        case "number": case "integer": {
            let v = p.positive ? 1 : 0;
            if (p.range) v = Math.min(Math.max(v, p.range[0]), p.range[1]);
            return v;
        }
        case "boolean": return false;
        case "text": return "";
        case "vector2": return [0, 0];
        case "vector3": return [0, 0, 0];
        case "json": return [];
        default: return undefined;
    }
}
