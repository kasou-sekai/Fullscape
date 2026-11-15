export type FocusLyricsLine = {
    startTime: number | null;
    endTime?: number | null;
    text: string;
};

export type Verse = {
    lines: FocusLyricsLine[];
    space: "none" | "verse" | "interlude";
    marker?: boolean;
};

const MUSIC_MARKER =
    /^(?:[♪♫♬𝄞]+|[[(（【{]?\s*(?:instrumental|music(?:al break)?|intro|outro|interlude|solo|break|bridge)\s*[\])）】}]?\s*[♪♫♬𝄞]*)$/iu;

export function groupVerses(lines: readonly FocusLyricsLine[], duration: number): Verse[] {
    const verses: Verse[] = [];
    const lyricCount = lines.filter(
        ({ text }) => text.trim() && !MUSIC_MARKER.test(text.trim()),
    ).length;
    const longGap = Math.max(5800, (duration / Math.max(lyricCount, 1)) * 1.9);
    let previous: FocusLyricsLine | undefined;
    let space: Verse["space"] = "none";
    let current: Verse | undefined;
    for (const line of lines) {
        const text = line.text.trim();
        if (!text) {
            space = "verse";
            current = undefined;
            continue;
        }
        const lastStart = previous?.startTime ?? 0;
        const lastEnd = previous?.endTime ?? lastStart + (previous ? 1800 : 0);
        if (line.startTime !== null && line.startTime - lastEnd >= longGap) {
            space = "interlude";
            current = undefined;
        }
        if (line.startTime !== null) previous = line;
        if (MUSIC_MARKER.test(text)) {
            verses.push({ lines: [{ ...line, text }], space: "interlude", marker: true });
            space = "verse";
            current = undefined;
            continue;
        }
        if (!current) {
            current = { lines: [], space };
            verses.push(current);
            space = "none";
        }
        current.lines.push({ ...line, text });
    }
    return divideAtRefrains(verses);
}

function divideAtRefrains(verses: Verse[]) {
    const keys: string[] = [];
    const ends: number[] = [];
    for (const verse of verses) {
        const end = keys.length + verse.lines.length;
        for (const { text } of verse.lines) {
            keys.push(
                verse.marker
                    ? ""
                    : text
                          .normalize("NFKC")
                          .toLowerCase()
                          .replace(/[\s\p{P}]+/gu, ""),
            );
            ends.push(end);
        }
    }

    const previousPairs = new Map<string, { first: number; last: number }>();
    const repeats: Array<{ earlier: number; later: number; length: number }> = [];
    for (let later = 0; later + 1 < keys.length; later += 1) {
        const first = keys[later];
        const second = keys[later + 1];
        if (!first || !second || first === second || ends[later] <= later + 1) continue;
        const pair = JSON.stringify([first, second]);
        const seen = previousPairs.get(pair);
        if (seen) {
            for (const earlier of new Set([seen.first, seen.last])) {
                const limit = Math.min(
                    later - earlier,
                    ends[earlier] - earlier,
                    ends[later] - later,
                    24,
                );
                let length = 2;
                while (length < limit && keys[earlier + length] === keys[later + length])
                    length += 1;
                repeats.push({ earlier, later, length });
            }
            seen.last = later;
        } else {
            previousPairs.set(pair, { first: later, last: later });
        }
    }

    // Longer recurring passages claim their lines first, so smaller repeated
    // phrases inside the same chorus do not create extra paragraph breaks.
    const owners = new Map<number, { start: number; length: number }>();
    const breaks = new Set<number>();
    for (const { earlier, later, length } of repeats.sort((a, b) => b.length - a.length)) {
        const spans = [earlier, later];
        if (
            !spans.every((start) => {
                for (let index = start; index < start + length; index += 1) {
                    const owner = owners.get(index);
                    if (owner && (owner.start !== start || owner.length !== length)) return false;
                }
                return true;
            })
        )
            continue;

        for (const start of spans) {
            const owner = { start, length };
            breaks.add(start);
            breaks.add(start + length);
            for (let index = start; index < start + length; index += 1) owners.set(index, owner);
        }
    }

    let offset = 0;
    return verses.flatMap((verse) => {
        const chunks: Verse[] = [];
        let start = 0;
        for (let index = 1; index < verse.lines.length; index += 1) {
            if (!breaks.has(offset + index)) continue;
            chunks.push({
                ...verse,
                space: start === 0 ? verse.space : "verse",
                lines: verse.lines.slice(start, index),
            });
            start = index;
        }
        offset += verse.lines.length;
        chunks.push({
            ...verse,
            space: start === 0 ? verse.space : "verse",
            lines: verse.lines.slice(start),
        });
        return chunks;
    });
}

export type LyricSplit = [Verse[], Verse[]];

function verseWeight({ lines }: Verse) {
    return lines.reduce((sum, { text }) => sum + Math.max(1, Array.from(text).length / 26), 0);
}

export function splitCandidates(verses: Verse[]): LyricSplit[] {
    const weights = verses.map(verseWeight);
    const target = weights.reduce((sum, weight) => sum + weight, 0) * 0.46;
    let consumed = 0;
    const cuts = weights.slice(0, -1).map((weight, index) => {
        consumed += weight;
        return { index: index + 1, distance: Math.abs(consumed - target) };
    });
    return cuts
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
        .map(({ index }) => [verses.slice(0, index), verses.slice(index)]);
}

export function columnEnds(weights: number[], columns: number): number[] {
    if (columns === 1) return [weights.length];

    // Find the smallest block size that can hold the ordered, complete verses.
    let low = Math.max(...weights);
    let high = weights.reduce((sum, weight) => sum + weight, 0);
    while (high - low > 0.01) {
        const limit = (low + high) / 2;
        let count = 1;
        let used = 0;
        for (const weight of weights) {
            if (used + weight > limit) {
                count += 1;
                used = 0;
            }
            used += weight;
        }
        if (count > columns) low = limit;
        else high = limit;
    }
    const ends: number[] = [];
    let used = 0;
    for (const [index, weight] of weights.entries()) {
        const remaining = columns - ends.length - 1;
        if (
            remaining > 0 &&
            index > (ends.at(-1) ?? 0) &&
            (used + weight > high || weights.length - index === remaining)
        ) {
            ends.push(index);
            used = 0;
        }
        used += weight;
    }
    ends.push(weights.length);
    return ends;
}

export function surroundEnds(verses: Verse[]): number[] | null {
    if (verses.filter(({ marker }) => !marker).length < 4) return null;
    const weights = verses.map(verseWeight);
    const ends = columnEnds(weights, 4);
    const sideWeights = ends.map((end, index) => {
        const start = ends[index - 1] ?? 0;
        if (verses.slice(start, end).every(({ marker }) => marker)) return 0;
        return weights.slice(start, end).reduce((sum, weight) => sum + weight, 0);
    });
    return Math.min(...sideWeights) >= Math.max(...sideWeights) * 0.57 ? ends : null;
}
