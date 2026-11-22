const STANZA_LAYOUTS = ["stanza-bands", "stanza-columns", "stanza-insets"] as const;
const MIN_COLUMN_MEASURE = 96;

export type StanzaLayout = (typeof STANZA_LAYOUTS)[number];
export { STANZA_LAYOUTS };

export type StanzaMeasure = {
    inlineSize: number;
    blockSize: number;
    ownRow: boolean;
};

type StanzaRow = {
    fractions: number[];
    align?: "start" | "end";
};

export function isStanzaLayout(layout: string): layout is StanzaLayout {
    return STANZA_LAYOUTS.some((candidate) => candidate === layout);
}

export function stanzaRows(
    stanzas: readonly StanzaMeasure[],
    inlineSize: number,
    gutter: number,
    layout: StanzaLayout,
): StanzaRow[] {
    if (inlineSize <= 0) return stanzas.map(() => ({ fractions: [1] }));
    if (layout === "stanza-insets") {
        let insetCount = 0;
        return stanzas.map(({ inlineSize: stanzaSize, ownRow }) =>
            !ownRow && stanzaSize < inlineSize * 0.62
                ? {
                      fractions: [Math.max(0.46, stanzaSize / inlineSize + 0.07)],
                      align: insetCount++ % 2 ? "start" : "end",
                  }
                : { fractions: [1] },
        );
    }

    const weighted = layout === "stanza-columns";
    const maxColumns = weighted ? 2 : 3;
    const best: { cost: number; row: StanzaRow }[] = [];
    for (let start = stanzas.length - 1; start >= 0; start -= 1) {
        const first = stanzas[start];
        best[start] = {
            cost: first.blockSize + (best[start + 1]?.cost ?? 0),
            row: { fractions: [1] },
        };
        if (first.ownRow) continue;
        for (let count = 2; count <= maxColumns && start + count <= stanzas.length; count += 1) {
            const group = stanzas.slice(start, start + count);
            if (group.some(({ ownRow }) => ownRow)) break;
            const available = inlineSize - (count - 1) * gutter;
            if (available < count * MIN_COLUMN_MEASURE) break;
            // Leave a usable measure even when a very short stanza sits beside a wide one.
            const required = group.map(({ inlineSize }) =>
                Math.max(inlineSize + 1, available * 0.24, MIN_COLUMN_MEASURE),
            );
            const total = required.reduce((sum, size) => sum + size, 0);
            if (weighted ? total > available : required.some((size) => size * count > available))
                continue;

            const tallest = Math.max(...group.map(({ blockSize }) => blockSize));
            const unused = group.reduce((sum, { blockSize }) => sum + tallest - blockSize, 0);
            // A small stanza beside a much taller one leaves too much dead space.
            const cost = tallest + (unused / count) * 0.52 + (best[start + count]?.cost ?? 0);
            if (cost >= best[start].cost) continue;
            best[start] = {
                cost,
                row: { fractions: required.map((size) => (weighted ? size / total : 1 / count)) },
            };
        }
    }

    const rows: StanzaRow[] = [];
    for (let start = 0; start < stanzas.length; ) {
        const { row } = best[start];
        rows.push(row);
        start += row.fractions.length;
    }
    return rows;
}
