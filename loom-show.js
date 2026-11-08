// What the loom's worker (loom-worker.js) shows of an evaluation, worked out apart from the
// View so Node can test it (test/loom-show.mjs): for each drawable -- a solid, sheet or
// profile a document node evaluated to, or an item of a node's list (`id#i`) -- the summary
// the page's caption reads (captionOf, notebook-scene.js), what to hand the View
// (`showSolid`'s handle and colour, or `showLines`' segments and colour), and its box, for
// the keep-camera rule below.
//
// Colours match what notebook-scene.js's sceneOf used to give a drawn item before the
// View took the page over: its own colour where it has one, else PALETTE by its index
// among every item drawn (solids and profiles counted alike, as sceneOf counted them); a
// profile's outline in its own colour, else OUTLINE.
//
// A solid's palette colour goes to `showSolid` as its `fill` -- below all paint, never over
// it (the kernel's own scene of a solid): a face with neither paint
// of its own nor the solid's colour draws in it, a face or edge painted apart keeps its
// paint, and a solid with a colour of its own ignores it. (Not `colour`, which paints the
// whole solid over its faces' and edges' own paint.)
import { PALETTE, OUTLINE } from "./notebook-scene.js";
import { RENDER_TOLERANCE, OUTLINE_STEPS } from "./notebook-mesh.js";

// The palette's colour for the `index`th item drawn, as sceneOf used to pick it.
export function paletteColour(index) {
    return PALETTE[index % PALETTE.length];
}

// A polyline set (`{ points, offsets }`: three floats a point, `offsets` where each
// polyline starts, one past the last at the end) as `showLines`' segments -- six floats a
// segment, `x0 y0 z0 x1 y1 z1`, each consecutive pair of a polyline's points, as meshOf
// (notebook-mesh.js) made the renderer's GL_LINES pairs.
export function segmentsOf({ points, offsets }) {
    let n = 0;
    for (let i = 0; i + 1 < offsets.length; i++) n += Math.max(offsets[i + 1] - offsets[i] - 1, 0);
    const out = new Float32Array(n * 6);
    let k = 0;
    for (let i = 0; i + 1 < offsets.length; i++) {
        for (let j = offsets[i]; j + 1 < offsets[i + 1]; j++) {
            out.set(points.subarray(3 * j, 3 * j + 6), k);
            k += 6;
        }
    }
    return out;
}

// The box of some segments, `{ lo, hi }`, or null for none.
export function boxOfPoints(points) {
    if (!points.length) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k + 2 < points.length; k += 3) {
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], points[k + a]); hi[a] = Math.max(hi[a], points[k + a]); }
    }
    return { lo, hi };
}

// A drawn thing's key across evaluations: the node's evaluation key (unchanged while nothing
// it reads changed), the item's place in the node's list, and the colour it is drawn in.
// Not its handle: a handle is fetched afresh each evaluation, and freed once shown.
export function keyOf(nodeKey, path, colour) {
    return `${nodeKey}|${path}|${colour.join(",")}`;
}

// The next evaluation against what the last one left shown (`shown`, key -> View id):
// `keep`, the items unchanged (key -> the id they already have, in the new order); `add`, the
// items to show (a key drawn twice, once); `remove`, the ids of those no longer drawn.
export function diffShown(shown, items) {
    const keep = new Map(), add = [], seen = new Set();
    for (const item of items) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        if (shown.has(item.key)) keep.set(item.key, shown.get(item.key));
        else add.push(item);
    }
    const remove = [...shown].filter(([key]) => !seen.has(key)).map(([, id]) => id);
    return { keep, add, remove };
}

// What can be drawn of document node `id`: `[{ path, kind }]` -- `path` the id to read it
// by (`id`, or `id#2` for a list's third item, lists of lists in turn), `kind` "solid" or
// "profile"; a profile list's profiles as `{ path, kind: "profile", at }`.
export function drawablesOf(wasm, doc, id) {
    const kind = wasm.cadaclysm_blacksmith_document_result_kind(doc, id);
    if (kind === "solid" || kind === "sheet") return [{ path: id, kind: "solid" }];
    if (kind === "profile") return [{ path: id, kind: "profile" }];
    if (kind === "profiles") {
        const n = wasm.cadaclysm_blacksmith_document_result_profile_count(doc, id);
        return Array.from({ length: n }, (_, at) => ({ path: id, kind: "profile", at }));
    }
    if (kind === "list") {
        const n = JSON.parse(wasm.cadaclysm_blacksmith_document_value(doc, id)).length;
        return Array.from({ length: n }, (_, i) => drawablesOf(wasm, doc, `${id}#${i}`)).flat();
    }
    return [];
}

const tagOf = (item) => (item.at === undefined ? item.path : `${item.path}@${item.at}`);

// One drawable (`drawablesOf`'s), the `index`th item drawn: `{ summary, show, box, key }`.
//   summary: `{ kind: "solid" | "profile", faces, edgeCount }` -- captionOf's fields;
//   show:    `{ kind: "solid", handle, fill }` (showSolid's `fill` option; the handle the
//            caller frees once shown) or `{ kind: "profile", segments, colour }`;
//   box:     `{ lo, hi }`, or null where it has nothing to bound;
//   key:     keyOf's, for the worker to keep an unchanged item shown.
export function describe(wasm, doc, item, index, nodeKey) {
    const tag = tagOf(item);
    if (item.kind === "profile") {
        const h = item.at === undefined ? wasm.cadaclysm_blacksmith_document_result_profile(doc, item.path)
            : wasm.cadaclysm_blacksmith_document_result_profile_at(doc, item.path, item.at);
        try {
            const outline = wasm.cadaclysm_blacksmith_profile_outline(h, OUTLINE_STEPS);
            const segments = segmentsOf(outline);
            const own = wasm.cadaclysm_blacksmith_profile_colour(h);
            const colour = own ? Array.from(own) : OUTLINE.slice();
            return {
                summary: { kind: "profile", faces: 0, edgeCount: outline.segments },
                show: { kind: "profile", segments, colour },
                box: boxOfPoints(segments),
                key: keyOf(nodeKey, tag, paletteColour(index)),
            };
        } finally {
            wasm.cadaclysm_blacksmith_profile_free(h);
        }
    }
    const handle = wasm.cadaclysm_blacksmith_document_result_solid(doc, item.path);
    // The box of the mesh at the View's own tolerance (showSolid's default): the same
    // tessellation it draws, cached on the solid, so this costs no second meshing.
    let box = null;
    try {
        const b = wasm.cadaclysm_blacksmith_bounds(handle, RENDER_TOLERANCE);
        if (b && b.length === 6 && b.every(Number.isFinite)) box = { lo: [b[0], b[1], b[2]], hi: [b[3], b[4], b[5]] };
    } catch { /* an empty solid: nothing to bound */ }
    return {
        summary: { kind: "solid", faces: wasm.cadaclysm_blacksmith_face_count(handle), edgeCount: wasm.cadaclysm_blacksmith_edge_count(handle) },
        show: { kind: "solid", handle, fill: paletteColour(index).slice() },
        box,
        key: keyOf(nodeKey, tag, paletteColour(index)),
    };
}

// An evaluation's nodes to draw (`draw`, their ids, in order) as the page's summary and the
// View's items: `drawn`, `[{ node, solids: [summary] }]` -- the result's `drawn` -- and
// `items`, every drawable's `describe` in the same order, its palette index running on
// across the nodes. `keys` maps a node id to its evaluation key. An item `last` (the previous
// call's items by key) already describes, and `shown` still shows, is taken from there with
// no handle: an unchanged part costs nothing. The solids' handles are the caller's to free
// (`freeItems`).
export function drawnOf(wasm, doc, keys, draw, last = new Map(), shown = new Map()) {
    const drawn = [], items = [];
    for (const id of draw ?? []) {
        const described = drawablesOf(wasm, doc, id).map((d, k) => {
            const index = items.length + k;
            const key = keyOf(keys.get(id) ?? "", tagOf(d), paletteColour(index));
            const before = last.get(key);
            if (before && shown.has(key)) return { ...before, show: { kind: before.show.kind, segments: before.show.segments ?? [] } };
            return describe(wasm, doc, d, index, keys.get(id) ?? "");
        });
        drawn.push({ node: id, solids: described.map((d) => d.summary) });
        items.push(...described);
    }
    return { drawn, items };
}

// The solid handles `drawnOf` took, freed.
export function freeItems(wasm, items) {
    for (const i of items) if (i.show.kind === "solid" && i.show.handle !== undefined) wasm.cadaclysm_blacksmith_solid_free(i.show.handle);
}

// The union of some boxes as sceneOf's frame used to be: its centre and radius (half the
// longest side, at least 1e-6). Null when no box has a point -- nothing drawn.
export function sphereOf(boxes) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) {
        if (!b) continue;
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b.lo[a]); hi[a] = Math.max(hi[a], b.hi[a]); }
    }
    if (!(lo[0] <= hi[0])) return null;
    const centre = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
    const radius = Math.max(Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2, 1e-6);
    return { centre, radius };
}

// The camera stays unless the part outgrew its frame, shrank past half of it or moved away
// (the OpenSCAD editor's rule, moved here from loom.js). `framedAt` is the sphere last
// framed, or null (never framed, nothing drawn since, or a new graph loaded).
export function keeps(framedAt, sphere) {
    if (!framedAt || !sphere) return false;
    return sphere.radius < 2 * framedAt.radius && sphere.radius > framedAt.radius / 2
        && Math.hypot(...sphere.centre.map((c, i) => c - framedAt.centre[i])) < framedAt.radius;
}
