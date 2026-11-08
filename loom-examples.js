// The loom's examples: what the page's menu offers, the first being what it opens with. Each
// is a blacksmith document under loom-examples/<id>.json (the canvas's places in its
// nodes' `meta.loom`); test/loom.mjs evaluates each one and pins its part.

export const EXAMPLES = [
    { id: "plate", title: "A plate, a boss and a bore", blurb: "the site's part: extrude, join, cut, fillet, with sliders" },
    { id: "flange", title: "A flange with a bolt circle", blurb: "one circle, a range of angles: the lists at work" },
    { id: "vase", title: "A vase, turned", blurb: "a section drawn as a path, revolved; the waist on a slider" },
    { id: "edges", title: "A box with coloured edges", blurb: "every edge gold, then one picked edge blue: colour on edges, as on faces" },
];
