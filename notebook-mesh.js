// What a cell draws, read off a kernel handle: the solid's mesh and feature edges at the
// notebook's tolerance, whether it is closed, and its colours -- or a profile's outline, or
// an assembly's parts.
// Shared by the Python kernel (kernel.js) and the JavaScript one (kernel-js.js), so a solid
// looks the same under either. Meshing is done here, from JS, on the handles, and the
// arrays go to the page.

export const RENDER_TOLERANCE = 0.05;
// Steps a curved segment of a drawn profile is sampled in: an arc or a spline reads as a
// curve at any zoom the view frames it at.
export const OUTLINE_STEPS = 64;

// Whether a solid is closed, read off its topology (the SDK's `Solid.manifold`).
export function closureOf(wasm, handle) {
    const row = wasm.cadaclysm_blacksmith_manifold(handle);
    return row && {
        closed: row[7] === 1, manifold: row[6] === 1,
        boundaryEdges: row[3], nonManifoldEdges: row[4], nonManifoldVertices: row[5],
    };
}

// An assembly as a read scene: the kernel writes it out as STEP (`assembly_step`, in
// millimetres) and the module's own reader opens that text -- every placement at its frame,
// every part in its colours, the tree its nodes, as a file of it would read. The caller
// frees the scene.
export function assemblySceneOf(wasm, handle) {
    const text = wasm.cadaclysm_blacksmith_assembly_step(handle, undefined, 1);
    return wasm.open(new TextEncoder().encode(text), "stp");
}

// How many parts a read scene draws: the distinct nodes its triangle spans belong to.
export function partCountOf(scene) {
    const spans = scene.spans();
    const nodes = new Set();
    for (let i = 0; i < spans.length; i += 3) nodes.add(spans[i]);
    return nodes.size;
}

// An assembly's drawing as one mesh, read off its scene: positions moved back out of the
// scene's origin-relative space, the scene's feature edges, no faces to colour.
function assemblyMeshOf(wasm, handle) {
    const scene = assemblySceneOf(wasm, handle);
    try {
        const o = scene.origin(), v = scene.vertices();
        const count = v.length / 9;
        const vertices = new Float32Array(3 * count), normals = new Float32Array(3 * count);
        for (let i = 0; i < count; i++) {
            for (let k = 0; k < 3; k++) {
                vertices[3 * i + k] = v[9 * i + k] + o[k];
                normals[3 * i + k] = v[9 * i + 3 + k];
            }
        }
        const edges = scene.edges();
        for (let i = 0; i < edges.length; i++) edges[i] += o[i % 3];
        return {
            vertices, normals, indices: scene.indices(), edges, faces: 0, edgeCount: edges.length / 6,
            faceTriangles: new Uint32Array(0), colour: null, faceColours: [], kind: "assembly",
            parts: partCountOf(scene), closure: null, flaws: null, edgeColours: null,
        };
    } finally {
        scene.free();
    }
}

// A profile (`kind` "profile", its handle a profile's) is drawn as its loops alone -- its
// segments as drawn, an open chain open -- with no triangles; its edge count is its
// segment count. An assembly (`kind` "assembly") as its read scene's triangles and edges.
export function meshOf(wasm, handle, faces, edgeCount, colour, faceColours, kind) {
    if (kind === "assembly") return assemblyMeshOf(wasm, handle);
    const outline = kind === "profile";
    const m = outline
        ? { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0), face_triangles: new Uint32Array(0) }
        : wasm.cadaclysm_blacksmith_mesh(handle, RENDER_TOLERANCE);
    const p = outline
        ? wasm.cadaclysm_blacksmith_profile_outline(handle, OUTLINE_STEPS)
        : wasm.cadaclysm_blacksmith_edge_polylines(handle, RENDER_TOLERANCE);
    if (outline) edgeCount = p.segments;
    // Polylines to segment pairs: the renderer draws a `LineList`.
    let n = 0;
    for (let i = 0; i + 1 < p.offsets.length; i++) n += Math.max(p.offsets[i + 1] - p.offsets[i] - 1, 0);
    const edges = new Float32Array(n * 6);
    let k = 0;
    for (let i = 0; i + 1 < p.offsets.length; i++) {
        for (let j = p.offsets[i]; j + 1 < p.offsets[i + 1]; j++) {
            edges.set(p.points.subarray(3 * j, 3 * j + 6), k);
            k += 6;
        }
    }
    // A solid's edge paint, a colour or null per segment pair above (the kernel's
    // `edge_polyline_colours`: three per polyline, -1s where none, nothing at all when no
    // edge has paint -- then null for the whole solid, and the view does nothing new).
    let edgeColours = null;
    const paint = outline ? null : wasm.cadaclysm_blacksmith_edge_polyline_colours(handle, RENDER_TOLERANCE);
    if (paint?.length) {
        const polylineCount = p.offsets.length - 1;
        if (paint.length !== 3 * polylineCount) {
            throw new Error(`meshOf: edge paint has ${paint.length} numbers for ${polylineCount} polylines`);
        }
        edgeColours = [];
        for (let i = 0; i + 1 < p.offsets.length; i++) {
            const rgb = paint[3 * i] < 0 ? null : [paint[3 * i], paint[3 * i + 1], paint[3 * i + 2]];
            for (let j = p.offsets[i]; j + 1 < p.offsets[i + 1]; j++) edgeColours.push(rgb);
        }
    }
    // A profile's colour is its own, read off its handle; a solid's is the caller's.
    if (outline) {
        const own = wasm.cadaclysm_blacksmith_profile_colour(handle);
        colour = own ? Array.from(own) : null;
    }
    // Whether a solid is closed, read off its topology (the SDK's `Solid.manifold`); a
    // profile's sheet is open by nature and says nothing about the profile.
    const closure = outline ? null : closureOf(wasm, handle);
    // And where it is not: the edges one face borders and those three or more do, as
    // segment pairs, and the pinched vertices as points -- drawn over the solid.
    const flaws = closure && !closure.closed ? wasm.cadaclysm_blacksmith_manifold_flaws(handle) : null;
    // The solid's colours ride along: its own (or null, the palette's) and [face, rgb]
    // pairs for faces drawn otherwise; `faceTriangles` says which run of triangles is
    // which face; `edgeColours` a colour or null per segment, or null.
    return {
        vertices: m.positions, normals: m.normals, indices: m.indices, edges, faces, edgeCount,
        faceTriangles: m.face_triangles, colour: colour ?? null, faceColours, kind: outline ? "profile" : "solid",
        closure, flaws, edgeColours,
    };
}
