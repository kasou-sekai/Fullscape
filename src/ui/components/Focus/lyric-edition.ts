import { STANZA_LAYOUTS } from "./stanza-layout";

const LAYOUTS = [
    "folio",
    "masthead",
    "inset",
    "colophon",
    "banner",
    "sidebar",
    "broadsheet",
    "staggered",
    "surround",
    "tategaki",
    ...STANZA_LAYOUTS,
] as const;

const PAPERS = ["ivory", "oat", "stone", "mist", "sage", "vellum"] as const;

export type LyricLayout = (typeof LAYOUTS)[number];
type Paper = (typeof PAPERS)[number];

function shuffle<T>(items: T[], random: () => number) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [items[index], items[swap]] = [items[swap], items[index]];
    }
    return items;
}

export function lyricEdition(
    previousLayout?: LyricLayout,
    previousPaper?: Paper,
    random = Math.random,
) {
    const layouts = shuffle(
        LAYOUTS.filter((layout) => layout !== previousLayout),
        random,
    );
    if (previousLayout) layouts.push(previousLayout);
    const papers = PAPERS.filter((paper) => paper !== previousPaper);
    return {
        layouts,
        paper: papers[Math.floor(random() * papers.length)],
        serif: random() < 0.6,
        direction: random(),
        centered: random() < 0.5,
    };
}
