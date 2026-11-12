// What the loom's worker (loom-worker.js) shows of an evaluation, worked out apart from the
// View so Node can test it (test/loom-show.mjs): for each drawable -- a solid, sheet or
// profile a document node evaluated to, or an item of a node's list (`id#i`) -- the summary
// the page's caption reads (captionOf, notebook-scene.js), what to hand the View
// (`showSolid`'s handle and colour, or `showLines`' segments and colour), and its box, for
// the keep-camera rule (pkg/view-show.js `keeps`).
//
// Colours match what notebook-scene.js's sceneOf used to give a drawn item before the
// View took the page over: its own colour where it has one, else the palette's
// (pkg/view-show.js paletteColour) by its index among every item drawn (solids and profiles
// counted alike, as sceneOf counted them); a profile's outline in its own colour, else
// OUTLINE. A solid's palette colour goes to `showSolid` as its `fill`, below all paint
// (pkg/view-show.js says how).
//
// The drawing helpers every page shares -- the palette, segments, boxes, the frame and
// the keep-camera rule -- are the web package's pkg/view-show.js; what is here is the
// loom's own: a document's drawables, described and diffed against what the View already
// shows.
import { OUTLINE, paletteColour, segmentsOf, boxOfPoints } from "./pkg/view-show.js";
import { RENDER_TOLERANCE, OUTLINE_STEPS } from "./notebook-mesh.js";

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
