export type FocusLyricsLine = {
    startTime: number | null;
    interludeBefore?: boolean;
    text: string;
};

export type Verse = {
    lines: FocusLyricsLine[];
    space: "none" | "verse" | "interlude";
    marker?: boolean;
    trailingInterlude?: boolean;
};

const MUSIC_NOTE = /^[♩♪♫♬𝄞🎵🎶]+$/u;
const MUSIC_LABEL =
    /^[[(（【{]?\s*(?:instrumental|music(?:al break)?|intro|outro|interlude|solo|break|bridge)\s*[\])）】}]?\s*[♪♫♬𝄞]*$/iu;
const MIN_REFRAIN_LINES = 3;

export function groupVerses(lines: readonly FocusLyricsLine[]): Verse[] {
    const entries = lines.map((line) => {
        const text = line.text.trim();
        const note = MUSIC_NOTE.test(text.replace(/[\s\p{Cf}\uFE0E\uFE0F]/gu, ""));
        return { ...line, text, note, label: MUSIC_LABEL.test(text) };
    });
    const verses: Verse[] = [];
    let space: Verse["space"] = "none";
    let current: Verse | undefined;
    let blankAfterLyrics = false;
    let hasAuthoredBreak = false;
    let sawLyric = false;
    for (const { text, startTime, note, label, interludeBefore } of entries) {
        if (interludeBefore) {
            space = "interlude";
            current = undefined;
        }
        if (!text || note) {
            if (!text && sawLyric) blankAfterLyrics = true;
            if (note) space = "interlude";
            else if (space !== "interlude") space = "verse";
            current = undefined;
            continue;
        }
        if (label) {
            verses.push({
                lines: [{ text, startTime }],
                space: "interlude",
                marker: true,
            });
            space = "verse";
            current = undefined;
            continue;
        }
        if (blankAfterLyrics) {
            hasAuthoredBreak = true;
            blankAfterLyrics = false;
        }
        if (!current) {
            current = { lines: [], space: !verses.length && space === "verse" ? "none" : space };
            verses.push(current);
            space = "none";
        }
        current.lines.push({ text, startTime });
        sawLyric = true;
    }

    const result = hasAuthoredBreak ? verses : divideAtRefrains(verses);
    const last = result.at(-1);
    if (last && space === "interlude") last.trailingInterlude = true;
    return result;
}

function divideAtRefrains(verses: Verse[]) {
    const keys: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    for (const verse of verses) {
        const start = keys.length;
        const end = start + verse.lines.length;
        for (const { text } of verse.lines) {
            keys.push(
                verse.marker
                    ? ""
                    : text
                          .normalize("NFKC")
                          .toLowerCase()
                          .replace(/[\s\p{P}]+/gu, ""),
            );
            starts.push(start);
            ends.push(end);
        }
    }

    const previousPassages = new Map<string, { first: number; last: number }>();
    const repeats: Array<{ earlier: number; later: number; length: number }> = [];
    for (let later = 0; later + MIN_REFRAIN_LINES <= keys.length; later += 1) {
        if (ends[later] - later < MIN_REFRAIN_LINES) continue;
        const lead = keys.slice(later, later + MIN_REFRAIN_LINES);
        if (lead.some((key) => !key)) continue;
        const signature = JSON.stringify(lead);
        const seen = previousPassages.get(signature);
        if (seen) {
            for (const earlier of new Set([seen.first, seen.last])) {
                const limit = Math.min(
                    later - earlier - 2,
                    ends[earlier] - earlier,
                    ends[later] - later,
                    24,
                );
                if (limit < MIN_REFRAIN_LINES) continue;
                let length = MIN_REFRAIN_LINES;
                while (length < limit && keys[earlier + length] === keys[later + length])
                    length += 1;
                if (new Set(keys.slice(later, later + length)).size < MIN_REFRAIN_LINES) continue;

                // A nearly identical neighboring line often belongs to a
                // slightly varied chorus. Leave that passage intact.
                const hasContinuation =
                    (earlier > starts[earlier] &&
                        later > starts[later] &&
                        relatedLine(keys[earlier - 1], keys[later - 1])) ||
                    (earlier + length < ends[earlier] &&
                        later + length < ends[later] &&
                        relatedLine(keys[earlier + length], keys[later + length]));
                if (!hasContinuation) repeats.push({ earlier, later, length });
            }
            seen.last = later;
        } else {
            previousPassages.set(signature, { first: later, last: later });
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

function relatedLine(first: string, second: string) {
    if (first === second) return true;
    const length = Math.min(first.length, second.length);
    if (length < 5) return false;
    let prefix = 0;
    while (prefix < length && first[prefix] === second[prefix]) prefix += 1;
    let suffix = 0;
    while (
        suffix < length - prefix &&
        first[first.length - suffix - 1] === second[second.length - suffix - 1]
    )
        suffix += 1;
    return prefix + suffix >= Math.ceil(Math.max(first.length, second.length) * 0.72);
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
