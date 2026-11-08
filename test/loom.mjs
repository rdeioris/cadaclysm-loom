// The loom on the blacksmith document, under Node over the wasm: the palette is the kernel's
// own kinds (`document_kinds()`) as loom-ui.json shows them, every kind one box and every
// field one port, and a node just placed from the palette evaluates; a canvas made into the
// document's nodes and back is the same nodes; a list input's ports; the number and list
// boxes as expressions; lacing (longest, cross); an error stops what is downstream only; the
// batch op between two canvases takes a document from one to the other; every example
// document evaluates, its last part pinned (volume, area, bounds), and saves, opens and
// saves again byte for byte through the canvas; an old file is refused in words.
//
// Run: node test/loom.mjs   (after npm run setup)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { loadPackage } from "./package.mjs";
import { BUILTIN_NODES, REGISTRY, useKinds, shown, startValue, portName } from "../loom-nodes.js";
import { graphToNodes, nodesToGraph, opsBetween, notDocument, VALUE_BOXES, canonical, docIdOf } from "../loom-doc.js";
import { EXAMPLES } from "../loom-examples.js";

const here = dirname(fileURLToPath(import.meta.url));
const { wasm, bs } = await loadPackage();
const kinds = JSON.parse(wasm.cadaclysm_blacksmith_document_kinds());
const ui = JSON.parse(readFileSync(join(here, "..", "loom-ui.json"), "utf8"));
useKinds(kinds, ui);
const kindByName = new Map(kinds.map((k) => [k.name, k]));

// ---- the palette --------------------------------------------------------------------------

// Every kind loom-ui.json shows is a box, its ports its fields in the kind's order; the
// forge's kinds and the bare value node are not; every builtin is a value box.
const boxes = [...REGISTRY.values()].filter((b) => b.document);
assert.ok(boxes.length > 90, `${boxes.length} kinds in the palette`);
for (const k of kinds) {
    const box = REGISTRY.get(k.name);
    assert.strictEqual(Boolean(box), shown(ui, k.name), `${k.name}: in the palette exactly when loom-ui.json shows it`);
    if (!box) continue;
    assert.deepStrictEqual(box.inputs.map((p) => p.field), k.params.map((p) => p.name), `${k.name}: a port a field`);
    assert.strictEqual(box.doc, k.doc);
    assert.ok(box.group !== "Other", `${k.name}: no group in loom-ui.json`);
}
for (const k of ["value", "forge.sketch", "forge.extrude", "frame.axis", "solid.body"]) assert.ok(!REGISTRY.get(k)?.document, `${k} is not in the palette`);
assert.ok(BUILTIN_NODES.every((b) => VALUE_BOXES.has(b.kind) && REGISTRY.get(b.kind) === b));
// loom-ui.json names only kinds and fields the kernel has (a namespace by its prefix).
const named = (key) => (key.endsWith(".") ? kinds.some((k) => k.name.startsWith(key)) || key === "forge." : kindByName.has(key));
for (const section of ["show", "hide"]) for (const key of ui[section]) assert.ok(named(key), `loom-ui.json ${section}: no kind ${key}`);
for (const section of ["groups", "labels", "records", "ports", "start"]) for (const key of Object.keys(ui[section])) assert.ok(named(key), `loom-ui.json ${section}: no kind ${key}`);
for (const [kind, fields] of Object.entries(ui.start)) for (const f of Object.keys(fields)) assert.ok(kindByName.get(kind).params.some((p) => p.name === f), `loom-ui.json start: ${kind} has no field ${f}`);
assert.strictEqual(REGISTRY.get("solid.loft_sections").label, "loft through");
assert.strictEqual(REGISTRY.get("solid.select_face").output.type, "face");
assert.strictEqual(REGISTRY.get("solid.select_face").inputs[1].type, "selector");
// Angles are the document's degrees: a revolve starts at a whole turn.
assert.strictEqual(startValue(REGISTRY.get("solid.revolve").inputs.find((p) => p.name === "angle")), 360);
assert.strictEqual(docIdOf("boss-circle"), "boss_circle");
assert.strictEqual(docIdOf(7), "n7");
assert.strictEqual(docIdOf("range"), "range_", "a function's name is no id an expression can read");

// ---- a canvas through a document ----------------------------------------------------------

const g = (nodes, wires = []) => ({ nodes, wires: wires.map(([from, to, port]) => ({ from, to: [to, port] })) });
// A document of a canvas's nodes, evaluated: `{ d, nodes, state(id), value(id), solid(id) }`.
function run(graph) {
    const nodes = graphToNodes(graph);
    const d = wasm.cadaclysm_blacksmith_document_new("mm");
    wasm.cadaclysm_blacksmith_document_apply(d, JSON.stringify(opsBetween([], nodes)), "");
    const status = new Map(JSON.parse(wasm.cadaclysm_blacksmith_document_evaluate(d, false)).map((s) => [s.id, s]));
    return {
        d, nodes,
        state: (id) => status.get(id).state,
        error: (id) => status.get(id).error ?? status.get(id).by,
        value: (id) => JSON.parse(wasm.cadaclysm_blacksmith_document_value(d, id)),
        kind: (id) => wasm.cadaclysm_blacksmith_document_result_kind(d, id),
        solid: (id) => new bs.Solid(wasm.cadaclysm_blacksmith_document_result_solid(d, id)),
    };
}

// A node just placed makes something: every kind with no input to wire, at its start values.
{
    const fresh = (box) => Object.fromEntries(box.inputs.map((p) => [p.name, startValue(p)]).filter(([, v]) => v !== undefined));
    const sources = boxes.filter((b) => b.inputs.every((p) => p.role !== "input" && p.role !== "inputs" && p.role !== "ref" || p.optional));
    assert.ok(sources.length > 25, `${sources.length} sources`);
    const failed = [];
    for (const box of sources) {
        const r = run(g([{ id: "n", kind: box.kind, params: fresh(box) }]));
        if (r.state("n") !== "ok") failed.push(`${box.kind}: ${r.error("n")}`);
    }
    assert.deepStrictEqual(failed, [], "a fresh node evaluates");
}

// Lacing: three widths, two offsets. Longest by default, the last offset repeating.
const laced = (lacing) => g([
    { id: "w", kind: "Expression", params: { expression: "[10, 20, 30]" } },
    { id: "box", kind: "solid.cuboid", params: { y: 10, z: 5 } },
    { id: "h", kind: "Expression", params: { expression: "[[0, 0, 0], [0, 0, 100]]" } },
    { id: "moved", kind: "solid.translate", lacing },
], [["w", "box", "x"], ["box", "moved", "solid"], ["h", "moved", "by"]]);
{
    const r = run(laced("longest"));
    assert.strictEqual(r.state("moved"), "ok", r.error("moved"));
    assert.strictEqual(r.kind("box"), "list");
    assert.strictEqual(r.value("box").length, 3, "three widths, three boxes");
    assert.deepStrictEqual(r.value("moved").length, 3, "longest: 3 boxes, 2 offsets -> 3");
    assert.deepStrictEqual([0, 1, 2].map((i) => r.solid(`moved#${i}`).bounds[1][2]), [2.5, 102.5, 102.5], "the last offset repeats (a cuboid is centred)");
    const cross = run(laced("cross"));
    assert.strictEqual(cross.value("moved").length, 6, "cross: 3 x 2");
    assert.strictEqual(cross.nodes.find((n) => n.id === "moved").lacing, "cross");
}

// A list input: a port an item (`solids`, `solids 2`), in their order; a list wired into
// one port is that list.
{
    const graph = g([
        { id: "a", kind: "solid.cuboid", params: { x: 10, y: 10, z: 10 } },
        { id: "b", kind: "solid.sphere", params: { r: 6 } },
        { id: "j", kind: "solid.join" },
    ], [["b", "j", portName("solids", 1)], ["a", "j", "solids"]]);
    const r = run(graph);
    assert.deepStrictEqual(r.nodes.find((n) => n.id === "j").solids, ["a", "b"]);
    assert.strictEqual(r.state("j"), "ok", r.error("j"));
    const back = nodesToGraph(r.nodes);
    assert.deepStrictEqual(back.wires.filter((w) => w.to[0] === "j").map((w) => [w.from, w.to[1]]), [["a", "solids"], ["b", "solids 2"]]);
    assert.strictEqual(opsBetween(r.nodes, graphToNodes(back)), null);
}

// The number and list boxes are value nodes holding expressions.
{
    const r = run(g([
        { id: "a", kind: "Expression", params: { expression: "[1, 2, 3]" } },
        { id: "b", kind: "Expression", params: { expression: "[10, 20]" } },
        { id: "mg", kind: "Merge" }, { id: "rv", kind: "Reverse" },
        { id: "sl", kind: "Slice", params: { from: 1, to: -1 } }, { id: "tail", kind: "Slice", params: { from: 3 } },
        { id: "n", kind: "Length" }, { id: "it", kind: "Item", params: { index: -1 } },
        { id: "angles", kind: "Range", params: { count: 6, from: 0, to: 360, closed: true } },
        { id: "steps", kind: "Range", params: { count: 3, from: 0, to: 1 } },
        { id: "sum", kind: "Math", params: { op: "modulo", a: 7, b: 3 } },
        { id: "quarter", kind: "Angle", params: { degrees: 90 } },
        { id: "p", kind: "Polar", params: { radius: 2, z: 1 } },
        { id: "v", kind: "Vector3", params: { x: 1, y: 2, z: 3 } },
    ], [["a", "mg", "a"], ["b", "mg", "b"], ["mg", "rv", "list"], ["mg", "sl", "list"], ["mg", "tail", "list"], ["mg", "n", "list"], ["mg", "it", "list"], ["quarter", "p", "angle"]]));
    assert.deepStrictEqual(r.value("mg"), [1, 2, 3, 10, 20]);
    assert.deepStrictEqual(r.value("rv"), [20, 10, 3, 2, 1]);
    assert.deepStrictEqual(r.value("sl"), [2, 3, 10]);
    assert.deepStrictEqual(r.value("tail"), [10, 20], "`to` left at 0 is the end");
    assert.strictEqual(r.value("n"), 5);
    assert.strictEqual(r.value("it"), 20);
    assert.deepStrictEqual(r.value("angles"), [0, 60, 120, 180, 240, 300], "closed: the sixth angle is 300, not 360");
    assert.deepStrictEqual(r.value("steps"), [0, 0.5, 1]);
    assert.strictEqual(r.value("sum"), 1);
    assert.strictEqual(r.value("quarter"), 90);
    const [x, y, z] = r.value("p");
    assert.ok(Math.abs(x) < 1e-12 && y === 2 && z === 1, `polar at 90 degrees: ${r.value("p")}`);
    assert.deepStrictEqual(r.value("v"), [1, 2, 3]);
}

// An error stops what is downstream of it, and the rest still runs.
{
    const r = run(g([
        { id: "neg", kind: "Expression", params: { expression: "-1" } },
        { id: "bad", kind: "profile.rect", params: { h: 10 } },
        { id: "ex", kind: "solid.extrude", params: { distance: 5 } },
        { id: "plane", kind: "frame.xy" },
        { id: "fine", kind: "solid.sphere", params: { r: 3 } },
    ], [["neg", "bad", "w"], ["bad", "ex", "profile"], ["plane", "ex", "frame"]]));
    assert.strictEqual(r.nodes.find((n) => n.id === "ex").frame, "plane", "a frame field takes the frame's id");
    assert.strictEqual(r.state("bad"), "error");
    assert.match(r.error("bad"), /`w` must be/);
    assert.strictEqual(r.state("ex"), "blocked");
    assert.strictEqual(r.state("fine"), "ok");
    // A literal out of range is the document's refusal: the op changes nothing.
    assert.throws(() => run(g([{ id: "bad", kind: "profile.rect", params: { w: -1, h: 10 } }])), /`w` must be within 0 and 1e9, not -1/);
}

// The op between two canvases: a slider moved is one `set`; a box taken off, with what reads
// it, is removes readers first; the document then holds the second canvas's nodes.
{
    const one = graphToNodes(laced("longest"));
    const two = structuredClone(one);
    two.find((n) => n.id === "w").value = "=[10, 40]";
    assert.deepStrictEqual(opsBetween(one, two), { op: "batch", ops: [{ op: "set", id: "w", fields: { value: "=[10, 40]" } }] });
    assert.strictEqual(opsBetween(one, structuredClone(one)), null, "nothing changed: no op");
    const three = one.filter((n) => n.id !== "box" && n.id !== "moved");
    const op = opsBetween(one, three);
    assert.deepStrictEqual(op.ops.map((o) => o.id), ["moved", "box"], "the reader goes first");
    const d = wasm.cadaclysm_blacksmith_document_new("mm");
    wasm.cadaclysm_blacksmith_document_apply(d, JSON.stringify(opsBetween([], one)), "");
    wasm.cadaclysm_blacksmith_document_apply(d, JSON.stringify(op), "");
    assert.deepStrictEqual(canonical(JSON.parse(wasm.cadaclysm_blacksmith_document_save(d)).nodes), canonical(three));
}

// ---- the examples -------------------------------------------------------------------------

// Each example's last part, pinned: `old` what the loom's first evaluator made of the graph
// (over the SDK's wrapper), `doc` what the document makes. Same volume, area and bounds to
// the bit where the route is the same call; the flange differs in the last digits (its bolt
// circle's sines and cosines are the document's libm, where the graph's were V8's).
const PINS = JSON.parse(readFileSync(join(here, "fixtures", "loom-example-pins.json"), "utf8"));
const LAST = { plate: "rounded", flange: "flange", vase: "vase", edges: "blue" };
assert.deepStrictEqual(EXAMPLES.map((e) => e.id), Object.keys(LAST));
for (const example of EXAMPLES) {
    const text = readFileSync(join(here, "..", "loom-examples", `${example.id}.json`), "utf8").replace(/\r\n/g, "\n");
    assert.strictEqual(notDocument(text), null, `${example.id}: a document`);
    const d = wasm.cadaclysm_blacksmith_document_load(text);
    // Saved, opened and saved again: byte for byte.
    assert.strictEqual(wasm.cadaclysm_blacksmith_document_save(d), text, `${example.id}: save, open, save`);
    for (const s of JSON.parse(wasm.cadaclysm_blacksmith_document_evaluate(d, false))) assert.strictEqual(s.state, "ok", `${example.id} ${s.id}: ${s.error ?? s.by}`);
    const part = new bs.Solid(wasm.cadaclysm_blacksmith_document_result_solid(d, LAST[example.id]));
    assert.ok(part.manifold.isClosed, `${example.id}: the part is closed`);
    const mass = part.mass();
    const pin = PINS[example.id];
    const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${example.id} ${what}: ${a} vs ${b}`);
    near(mass.volume, pin.old.volume, "volume");
    near(mass.area, pin.old.area, "area");
    part.bounds.flat().forEach((v, i) => near(v, pin.old.bounds.flat()[i], `bounds[${i}]`));
    assert.strictEqual(mass.volume, pin.doc.volume, `${example.id}: the document's own volume, to the bit`);
    assert.strictEqual(part.faces, pin.old.faces, `${example.id}: faces`);
    // The canvas round trip: the document's nodes as boxes and back are the same nodes, so a
    // save after opening (no edit) is the file again.
    const nodes = JSON.parse(text).nodes;
    const canvas = nodesToGraph(nodes);
    assert.ok(canvas.nodes.every((b) => b.kind !== "Document" && b.kind !== "Expression" && !b.raw), `${example.id}: every node its own box, every field a port: ${JSON.stringify(canvas.nodes.filter((b) => b.raw))}`);
    const again = graphToNodes(canvas);
    assert.strictEqual(opsBetween(nodes, again), null, `${example.id}: the canvas makes the same nodes: ${JSON.stringify(opsBetween(nodes, again))}`);
}
// The flange's lists: six holes from one circle and a range of six angles.
{
    const d = wasm.cadaclysm_blacksmith_document_load(readFileSync(join(here, "..", "loom-examples", "flange.json"), "utf8"));
    wasm.cadaclysm_blacksmith_document_evaluate(d, false);
    assert.strictEqual(JSON.parse(wasm.cadaclysm_blacksmith_document_value(d, "angles")).length, 6);
    assert.strictEqual(wasm.cadaclysm_blacksmith_document_result_kind(d, "holes"), "list");
    assert.strictEqual(JSON.parse(wasm.cadaclysm_blacksmith_document_value(d, "holes")).length, 6, "one circle laced over six frames");
    // A cylinder face is two halves in the kernel: the disc's wall, each of the six holes, the bore.
    assert.strictEqual(wasm.cadaclysm_blacksmith_face_count(wasm.cadaclysm_blacksmith_document_result_solid(d, "flange")), 2 + 2 + 6 * 2 + 2);
}
// The coloured-edges example: every edge gold, the picked edge 5 then blue over it.
{
    const d = wasm.cadaclysm_blacksmith_document_load(readFileSync(join(here, "..", "loom-examples", "edges.json"), "utf8"));
    wasm.cadaclysm_blacksmith_document_evaluate(d, false);
    const part = new bs.Solid(wasm.cadaclysm_blacksmith_document_result_solid(d, "blue"));
    assert.deepStrictEqual(part.edgeColour(5), [0x37 / 255, 0x8a / 255, 0xdd / 255]);
    for (const i of [0, 1, 11]) assert.deepStrictEqual(part.edgeColour(i), [0xd4 / 255, 0xa0 / 255, 0x17 / 255], `edge ${i}`);
}

// A document made elsewhere opens too: a node of a kind the palette hides is kept whole, a
// value node whose expression its box would not write is an expression box, an expression
// no wire draws is kept as it was, and all come back unchanged.
{
    const nodes = [
        { id: "v", kind: "value", value: "=range(0, 30, 10)" },
        { id: "m", kind: "measure.mass", solid: "c" },
        { id: "c", kind: "solid.cuboid", x: "=v + 1", y: 2, z: 3, name: "the box" },
    ];
    const canvas = nodesToGraph(nodes);
    assert.deepStrictEqual(canvas.nodes.map((b) => b.kind), ["Expression", "Document", "solid.cuboid"]);
    assert.strictEqual(canvas.nodes[2].raw.x, "=v + 1", "an expression no wire draws is kept as it was");
    const again = graphToNodes(canvas).map((n) => { const { meta, ...rest } = n; return rest; });
    assert.strictEqual(opsBetween(nodes, again), null, JSON.stringify(opsBetween(nodes, again)));
}
// A file saved by the loom before its palette was the kinds' (its boxes named in
// `meta.loom.node`) opens as the kinds' boxes, the old names dropped on the next save.
{
    const nodes = [{ id: "r", kind: "profile.rect", meta: { loom: { node: "Profile.rect", x: 4, y: 8 } }, w: 3, h: 4 }];
    const canvas = nodesToGraph(nodes);
    assert.strictEqual(canvas.nodes[0].kind, "profile.rect");
    assert.deepStrictEqual(graphToNodes(canvas)[0], { id: "r", kind: "profile.rect", meta: { loom: { x: 4, y: 8 } }, w: 3, h: 4 });
}

// ---- old files ------------------------------------------------------------------------------

const OLD_GRAPH = JSON.stringify({ version: 1, nodes: [{ id: "a", kind: "Number", x: 0, y: 0, params: { value: 1 } }], wires: [] });
assert.strictEqual(notDocument(OLD_GRAPH), "not a cadaclysm-blacksmith document: it names no format", "a .loom.json of before");
assert.strictEqual(notDocument('{"format": "cadaclysm-forge", "version": 3}'), 'not a cadaclysm-blacksmith document: its format is "cadaclysm-forge"');
assert.strictEqual(notDocument("<svg/>"), "not a cadaclysm-blacksmith document (it is not JSON)");

console.log(`loom: ok (${REGISTRY.size} boxes, ${EXAMPLES.length} examples)`);
