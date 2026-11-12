// How a notebook cell's drawn items are named and coloured: the palette solids cycle
// through, the outline colour a profile is drawn in, the pinched cross a non-manifold
// vertex is drawn as, the caption and legend text over a view, and the words a file the
// Open button refuses as a document is refused in. The palette and the outline colour
// are the web package's (pkg/view-show.js), which every page draws with; they are
// re-exported here for the legend and the tests.
import { PALETTE, OUTLINE } from "./pkg/view-show.js";
export { PALETTE, OUTLINE };

// A pinched vertex is drawn as a cross, its arms this fraction of the scene's radius.
export const CROSS = 0.04;

// A pinched vertex drawn as a cross: per point, three segments -- one along each axis,
// `arm` either way -- as `x0 y0 z0 x1 y1 z1` pairs.
export function crossesOf(points, arm) {
    const crosses = new Float32Array((points.length / 3) * 18);
    for (let k = 0; k < points.length / 3; k++) {
        for (let a = 0; a < 3; a++) {
            for (let end = 0; end < 2; end++) {
                const at = (k * 3 + a) * 6 + end * 3;
                crosses.set(points.subarray(3 * k, 3 * k + 3), at);
                crosses[at + a] += end ? arm : -arm;
            }
        }
    }
    return crosses;
}

// The format a blacksmith document names first thing: the one document the notebook opens
// (`.json`) and saves.
export const DOCUMENT_FORMAT = "cadaclysm-blacksmith";

// Why `text` is not a blacksmith document, in words -- naming the format it says it is, when
// it says one -- or null when it is one.
export function documentRefusal(text) {
    let doc;
    try { doc = JSON.parse(text); } catch { return `not a ${DOCUMENT_FORMAT} document (not JSON)`; }
    const format = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.format : undefined;
    if (format === DOCUMENT_FORMAT) return null;
    return typeof format === "string" ? `not a ${DOCUMENT_FORMAT} document (it is "${format}")` : `not a ${DOCUMENT_FORMAT} document`;
}

// The caption over a view: a played job first, its programs' tools; then how many solids,
// profiles and assemblies (with the parts the assemblies draw), the solids' faces, the
// solids' and profiles' edges.
export function captionOf(solids) {
    const count = (n, what) => `${n} ${what}${n === 1 ? "" : "s"}`;
    const jobs = solids.filter((s) => s.kind === "machining");
    const bodies = solids.filter((s) => s.kind !== "profile" && s.kind !== "assembly" && s.kind !== "machining");
    const profiles = solids.filter((s) => s.kind === "profile").length;
    const assemblies = solids.filter((s) => s.kind === "assembly");
    const parts = [];
    for (const j of jobs) {
        parts.push(`a job · ${count(j.programs.length, "program")} · ${j.programs.map((p) => `T${p.tool} ${p.shape} ${p.diameter} mm`).join(", ")}`);
    }
    if (bodies.length) parts.push(count(bodies.length, "solid"));
    if (profiles) parts.push(count(profiles, "profile"));
    if (assemblies.length) parts.push(`${count(assemblies.length, "assembly").replace(/assemblys$/, "assemblies")} of ${count(assemblies.reduce((n, s) => n + s.parts, 0), "part")}`);
    if (bodies.length) parts.push(`${bodies.reduce((n, s) => n + s.faces, 0)} faces`);
    // Edges are counted on solids and profiles; an assembly's parts are not counted again.
    if (bodies.length || profiles) parts.push(`${solids.reduce((n, s) => n + s.edgeCount, 0)} edges`);
    return parts.join(" · ");
}

// The legend over a view: which solids are closed. One entry per solid -- its number among
// the cell's solids (the palette repeats past four), the colour it is drawn in, and what
// the kernel's topology says: closed; open, with how many edges only one face borders; or
// not a manifold, with the edges three or more faces border and the pinched vertices. Past
// `MAX_LEGEND` solids the closed ones fold into one count and only the rest are listed.
// Profiles are outlines, neither closed nor open, and have no entry.
export const MAX_LEGEND = 6;
export function legendOf(solids) {
    const count = (n, what, many = what + "s") => `${n} ${n === 1 ? what : many}`;
    const entries = [];
    let number = 0;
    solids.forEach((s, node) => {
        if (s.kind === "profile" || !s.closure) return;
        number += 1;
        const c = s.closure;
        let state, text;
        if (c.closed) { state = "closed"; text = "closed"; }
        else if (c.manifold) { state = "open"; text = `open · ${count(c.boundaryEdges, "boundary edge")}`; }
        else {
            state = "pinched";
            const where = [];
            if (c.nonManifoldEdges) where.push(`${count(c.nonManifoldEdges, "edge")} on 3+ faces`);
            if (c.nonManifoldVertices) where.push(count(c.nonManifoldVertices, "pinched vertex", "pinched vertices"));
            text = `not manifold · ${where.join(", ")}`;
        }
        entries.push({ number, colour: s.colour ?? PALETTE[node % PALETTE.length], state, text });
    });
    if (entries.length <= MAX_LEGEND) return entries;
    const closed = entries.filter((e) => e.state === "closed");
    const rest = entries.filter((e) => e.state !== "closed");
    return closed.length ? [{ number: null, colour: null, state: "closed", text: `${closed.length} closed` }, ...rest] : rest;
}
