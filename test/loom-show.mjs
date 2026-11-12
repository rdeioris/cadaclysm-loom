// What the loom's worker shows of an evaluation (loom-show.js), under Node over the wasm
// and a blacksmith document, as the worker holds one: the result's
// `drawn` summary (captionOf's fields) across several nodes, the palette index running on
// across them as sceneOf used to number the page's list, a solid's own paint left to the
// kernel, a profile's polyline as showLines' six-float segments (meshOf's own pairs), the
// boxes' frame and the keep-camera rule.
//
// Run: node test/loom-show.mjs   (after npm run setup)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { graphToNodes, opsBetween } from "../loom-doc.js";
import { useKinds } from "../loom-nodes.js";
import { drawnOf, freeItems, keyOf, diffShown } from "../loom-show.js";
import { segmentsOf, paletteColour, sphereOf, keeps } from "../pkg/view-show.js";
import { PALETTE, OUTLINE, captionOf } from "../notebook-scene.js";
import { meshOf } from "../notebook-mesh.js";
import { loadPackage } from "./package.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { wasm } = await loadPackage();
useKinds(wasm.cadaclysm_blacksmith_document_kinds(), JSON.parse(readFileSync(join(here, "..", "loom-ui.json"), "utf8")));
const g = (nodes, wires) => ({ nodes, wires });
// A canvas as a document, evaluated: the handle and each node's evaluation key.
function documentOf(graph, d = wasm.cadaclysm_blacksmith_document_new("mm"), before = []) {
    const nodes = graphToNodes(graph);
    const op = opsBetween(before, nodes);
    if (op) wasm.cadaclysm_blacksmith_document_apply(d, JSON.stringify(op), "");
    const status = JSON.parse(wasm.cadaclysm_blacksmith_document_evaluate(d, false));
    for (const st of status) assert.strictEqual(st.state, "ok", `${st.id}: ${st.error ?? st.by}`);
    return { d, nodes, keys: new Map(status.map((st) => [st.id, st.key])) };
}
const close = (a, b, what) => { assert.strictEqual(a.length, b.length, what); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-9, `${what}[${i}]: ${x} vs ${b[i]}`)); };

// ---- segmentsOf: polylines to six-float segments -------------------------------------------

{
    // Three polylines: three points, one point (no segment), two points.
    const points = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 9, 9, 9, 2, 2, 2, 3, 3, 3]);
    const offsets = new Uint32Array([0, 3, 4, 6]);
    assert.deepStrictEqual(Array.from(segmentsOf({ points, offsets })), [
        0, 0, 0, 1, 0, 0,
        1, 0, 0, 1, 1, 0,
        2, 2, 2, 3, 3, 3,
    ]);
    assert.strictEqual(segmentsOf({ points: new Float32Array(0), offsets: new Uint32Array([0]) }).length, 0);
}

// ---- the palette index ---------------------------------------------------------------------

for (let i = 0; i < 9; i++) assert.deepStrictEqual(paletteColour(i), PALETTE[i % PALETTE.length], `palette ${i}`);

// ---- drawnOf: the summary and the items, over several nodes -------------------------------

const doc = documentOf(g([
    { id: "a", kind: "solid.cuboid", params: { x: 10, y: 20, z: 30 } },
    { id: "b", kind: "solid.cuboid", params: { x: 4, y: 4, z: 4 } },
    { id: "rect", kind: "profile.rect", params: { w: 30, h: 20 } },
    { id: "mix", kind: "Expression", params: { expression: "[a, rect]" } },
    { id: "red", kind: "solid.coloured", params: { colour: "#f00" } },
    { id: "top", kind: "selector.max", params: { axis: "z" } },
    { id: "face", kind: "solid.select_face" },
    { id: "one", kind: "solid.coloured", params: { colour: "#00f" } },
    { id: "tint", kind: "profile.coloured", params: { colour: "#38d" } },
], [
    { from: "b", to: ["red", "solid"] },
    { from: "b", to: ["face", "solid"] }, { from: "top", to: ["face", "selector"] },
    { from: "b", to: ["one", "solid"] }, { from: "face", to: ["one", "face"] },
    { from: "rect", to: ["tint", "profile"] },
]));

// `b` drawn twice, so the palette's index runs on across nodes (b is item 2, then item 7).
const draw = ["mix", "b", "red", "one", "tint", "b", "b", "b"];
const { drawn, items } = drawnOf(wasm, doc.d, doc.keys, draw);
assert.deepStrictEqual(drawn.map((d) => d.node), draw, "a node's entry, in the order asked");
assert.deepStrictEqual(drawn[0].solids, [{ kind: "solid", faces: 6, edgeCount: 12 }, { kind: "profile", faces: 0, edgeCount: 4 }]);
assert.deepStrictEqual(drawn[1].solids, [{ kind: "solid", faces: 6, edgeCount: 12 }]);
assert.strictEqual(items.length, 9);
assert.strictEqual(captionOf(drawn.flatMap((d) => d.solids)), "7 solids · 2 profiles · 42 faces · 92 edges", "captionOf reads the summary");

// Colours: every solid gets the palette's colour by its index among every item drawn
// (profiles counted) as showSolid's `fill` -- below its paint, so a solid with a colour of its
// own, or a face painted apart, still draws its paint (the View's rule) -- and a profile its own colour or OUTLINE.
assert.strictEqual(items[0].show.kind, "solid");
assert.deepStrictEqual(items[0].show.fill, PALETTE[0], "item 0: the palette's first");
for (const [i, it] of items.entries()) if (it.show.kind === "solid") assert.strictEqual(it.show.colour, undefined, `item ${i}: no \`colour\` option (it would flatten paint)`);
assert.strictEqual(wasm.cadaclysm_blacksmith_face_count(items[0].show.handle), 6, "a handle of its own, for the View");
assert.strictEqual(items[1].show.kind, "profile");
assert.deepStrictEqual(items[1].show.colour, OUTLINE, "an uncoloured profile: OUTLINE");
assert.deepStrictEqual(items[2].show.fill, PALETTE[2], "item 2 (the second node's): the palette's third");
assert.deepStrictEqual(items[3].show.fill, PALETTE[3], "a coloured solid: the palette's fill too (its own colour wins inside the View)");
assert.deepStrictEqual(items[4].show.fill, PALETTE[0], "a face painted, the solid not: the palette's fill for the unpainted faces");
close(items[5].show.colour, [0x33 / 255, 0x88 / 255, 0xdd / 255], "a coloured profile: its own colour");
assert.deepStrictEqual(items[6].show.fill, PALETTE[6 % PALETTE.length], "item 6: the palette wraps");
assert.deepStrictEqual(items[7].show.fill, PALETTE[7 % PALETTE.length], "item 7");
assert.deepStrictEqual(items[8].show.fill, PALETTE[8 % PALETTE.length], "item 8");

// A profile's segments are meshOf's own pairs, float for float, one per outline segment here.
const rect = wasm.cadaclysm_blacksmith_document_result_profile(doc.d, "rect");
const oracle = meshOf(wasm, rect, 0, 0, null, [], "profile");
assert.deepStrictEqual(Array.from(items[1].show.segments), Array.from(oracle.edges), "the outline as meshOf paired it");
assert.strictEqual(items[1].show.segments.length, 4 * 6, "a rectangle: four segments");

// ---- the frame: the boxes' union, and the keep rule --------------------------------------------

close(items[0].box.hi.map((h, a) => h - items[0].box.lo[a]), [10, 20, 30], "a 10 x 20 x 30 cuboid's box");
close(items[1].box.hi.map((h, a) => h - items[1].box.lo[a]), [30, 20, 0], "a 30 x 20 rectangle's box, on z = 0");
const lone = sphereOf([items[0].box]);
assert.ok(Math.abs(lone.radius - 15) < 1e-9, `half the longest side: ${lone.radius}`);
close(lone.centre, items[0].box.lo.map((l, a) => (l + items[0].box.hi[a]) / 2), "the box's centre");
const both = sphereOf([items[0].box, null, items[1].box]);
const lo = [0, 1, 2].map((a) => Math.min(items[0].box.lo[a], items[1].box.lo[a]));
const hi = [0, 1, 2].map((a) => Math.max(items[0].box.hi[a], items[1].box.hi[a]));
close(both.centre, lo.map((l, a) => (l + hi[a]) / 2), "the union's centre");
assert.ok(Math.abs(both.radius - Math.max(...hi.map((h, a) => h - lo[a])) / 2) < 1e-9, "the union's radius");
assert.strictEqual(sphereOf([]), null, "nothing drawn: no frame");
assert.strictEqual(sphereOf([null]), null, "nothing with a point: no frame");

const at = { centre: [0, 0, 0], radius: 10 };
assert.strictEqual(keeps(null, at), false, "never framed: frame");
assert.strictEqual(keeps(at, null), false, "nothing to frame on");
assert.strictEqual(keeps(at, { centre: [1, 0, 0], radius: 12 }), true, "a small edit keeps the camera");
assert.strictEqual(keeps(at, { centre: [0, 0, 0], radius: 20 }), false, "twice the size: frame");
assert.strictEqual(keeps(at, { centre: [0, 0, 0], radius: 5 }), false, "half the size: frame");
assert.strictEqual(keeps(at, { centre: [0, 10, 0], radius: 10 }), false, "moved a radius away: frame");

// keyOf: one key per node evaluation, item and style -- the same node unchanged in the same
// colour is the same key across evaluations (its evaluation key is the same); another
// evaluation, another item, or another colour is another key. Not the handle: a handle is
// fetched afresh every evaluation.
{
    assert.strictEqual(keyOf("k1", "a", [1, 0, 0]), keyOf("k1", "a", [1, 0, 0]), "same node, item and colour: same key");
    assert.notStrictEqual(keyOf("k1", "a", [1, 0, 0]), keyOf("k2", "a", [1, 0, 0]), "another evaluation: another key");
    assert.notStrictEqual(keyOf("k1", "a#0", [1, 0, 0]), keyOf("k1", "a#1", [1, 0, 0]), "another item: another key");
    assert.notStrictEqual(keyOf("k1", "a", [1, 0, 0]), keyOf("k1", "a", [0, 1, 0]), "another colour: another key");
}
freeItems(wasm, items);

// diffShown: what stays shown, what goes up, what comes down, from the last evaluation's
// items (key -> View id) and this one's. An item drawn twice under one key goes up once.
{
    const shown = new Map([["k1", 10], ["k2", 11], ["k3", 12]]);
    const items = [{ key: "k2" }, { key: "k4" }, { key: "k1" }, { key: "k4" }];
    const { keep, add, remove } = diffShown(shown, items);
    assert.deepStrictEqual([...keep], [["k2", 11], ["k1", 10]], "unchanged items keep their View ids");
    assert.deepStrictEqual(add.map((i) => i.key), ["k4"], "only the new one goes up, once");
    assert.deepStrictEqual(remove, [12], "only the one no longer drawn comes down");
    const none = diffShown(new Map(), []);
    assert.deepStrictEqual([none.keep.size, none.add.length, none.remove.length], [0, 0, 0]);
}

// The keyed diff over real evaluations: an unchanged document keeps everything shown (and
// takes no handle for it); a node removed ahead of another shifts that one's palette index,
// so it is re-shown in its new colour, not kept in its old one.
{
    const P = { id: "p", kind: "solid.cuboid", params: { x: 10, y: 10, z: 10 } };
    const Q = { id: "q", kind: "solid.cuboid", params: { x: 20, y: 5, z: 5 } };
    const first = documentOf(g([P, Q], []));
    const one = drawnOf(wasm, first.d, first.keys, ["p", "q"]).items;
    let next = 100;
    const shown = new Map(one.map((i) => [i.key, next++]));   // what the worker's show() would hold
    freeItems(wasm, one);
    const last = new Map(one.map((i) => [i.key, i]));

    const again = documentOf(g([P, Q], []), first.d, first.nodes);
    const sameItems = drawnOf(wasm, again.d, again.keys, ["p", "q"], last, shown).items;
    assert.ok(sameItems.every((i) => i.show.handle === undefined), "an unchanged item takes no handle");
    const same = diffShown(shown, sameItems);
    assert.deepStrictEqual([same.keep.size, same.add.length, same.remove.length], [2, 0, 0], "nothing changed: both stay up");

    const without = documentOf(g([Q], []), again.d, again.nodes);
    assert.strictEqual(without.keys.get("q"), first.keys.get("q"), "q is unchanged: the same key");
    const two = drawnOf(wasm, without.d, without.keys, ["q"], last, shown).items;
    assert.deepStrictEqual(two[0].show.fill, PALETTE[0], "q is now the first item drawn: PALETTE[0], not [1]");
    const shifted = diffShown(shown, two);
    assert.deepStrictEqual(shifted.add.map((i) => i.key), [two[0].key], "q goes up again, in its new colour");
    assert.deepStrictEqual(shifted.remove.sort(), [100, 101], "p's item and q's old-coloured one come down");
    assert.strictEqual(shifted.keep.size, 0);
    freeItems(wasm, two);
}

// A laced node's items are drawn one by one (`id#i`).
{
    const laced = documentOf(g([{ id: "w", kind: "Expression", params: { expression: "[1, 2, 3]" } }, { id: "c", kind: "solid.cuboid", params: { y: 1, z: 1 } }], [{ from: "w", to: ["c", "x"] }]));
    const { drawn: d3, items: i3 } = drawnOf(wasm, laced.d, laced.keys, ["c"]);
    assert.strictEqual(d3[0].solids.length, 3);
    assert.strictEqual(new Set(i3.map((i) => i.key)).size, 3, "an item a key");
    freeItems(wasm, i3);
}

console.log("loom-show: ok");
