import { getMedian } from "../Lyrics/timeline";

export type FocusLyricsLine = {
    startTime: number | null;
    endTime?: number;
    sectionBreakBefore?: boolean;
    sectionIndex?: number;
    interludeBefore?: boolean;
    text: string;
};

export type Verse = {
    lines: FocusLyricsLine[];
    space: "none" | "verse" | "interlude";
    heading?: boolean;
    marker?: boolean;
    trailingInterlude?: boolean;
};

const MUSIC_NOTE = /^[♩♪♫♬𝄞🎵🎶]+$/u;
const MUSIC_LABEL =
    /^[[(（【{]?\s*(?:instrumental|music(?:al break)?|intro|outro|interlude|solo|break|bridge)\s*[\])）】}]?\s*[♪♫♬𝄞]*$/iu;
const SECTION_LABEL =
    /^(?:verse|(?:(?:pre|post)[ -]?)?chorus|refrain|hook|bridge|intro|outro|主歌|副歌|サビ|[AB]メロ)(?:\s*\d+)?(?:\s*:\s*.+)?$/iu;
const SECTION_BRACKETS = /^(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}|【([^】]+)】)$/u;
const CADENCE_WINDOW = 4;
const MAX_REFRAIN_LINES = 24;

function isMusicNote(text: string) {
    return MUSIC_NOTE.test(text.replace(/[\s\p{Cf}\uFE0E\uFE0F]/gu, ""));
}

function groupSourceSections(lines: readonly FocusLyricsLine[]): Verse[] {
    const verses: Verse[] = [];
    const bySection = new Map<number, Verse>();
    let current: Verse | undefined;
    let interlude = false;
    for (const line of lines) {
        const text = line.text.trim();
        const note = isMusicNote(text);
        interlude ||= Boolean(line.interludeBefore) || note;
        if (!text || note) continue;

        const { sectionIndex } = line;
        if (sectionIndex !== undefined) current = bySection.get(sectionIndex);
        if (!current) {
            current = {
                lines: [],
                space: interlude ? "interlude" : verses.length ? "verse" : "none",
            };
            verses.push(current);
            if (sectionIndex !== undefined) bySection.set(sectionIndex, current);
        }
        current.lines.push({ ...line, text, interludeBefore: interlude });
        interlude = false;
    }
    const last = verses.at(-1);
    if (interlude && last) last.trailingInterlude = true;
    return verses;
}

export function groupVerses(lines: readonly FocusLyricsLine[]): Verse[] {
    if (lines.some(({ sectionIndex }) => sectionIndex !== undefined)) {
        return groupSourceSections(lines);
    }
    const verses: Verse[] = [];
    let space: Verse["space"] = "none";
    let current: Verse | undefined;
    let pendingBlank = false;
    let hasAuthoredBreak = false;
    let sawLyric = false;

    for (const line of lines) {
        const text = line.text.trim();
        const note = isMusicNote(text);
        pendingBlank ||= Boolean(line.sectionBreakBefore) || !text;
        if (line.interludeBefore || note) {
            space = "interlude";
            current = undefined;
        }
        if (!text || note) continue;

        const heading = SECTION_BRACKETS.exec(text.normalize("NFKC"));
        const section = heading
            ?.slice(1)
            .some((label) => label && SECTION_LABEL.test(label.trim()));
        if (section) {
            current = {
                lines: [{ ...line, text }],
                space: space === "interlude" ? space : verses.length ? "verse" : "none",
                heading: true,
            };
            verses.push(current);
            hasAuthoredBreak = true;
            pendingBlank = false;
            space = "none";
            continue;
        }
        if (MUSIC_LABEL.test(text)) {
            verses.push({
                lines: [{ ...line, text }],
                space: "interlude",
                marker: true,
            });
            pendingBlank = false;
            space = "verse";
            current = undefined;
            continue;
        }

        if (pendingBlank && !(current?.heading && current.lines.length === 1)) {
            if (sawLyric && space !== "interlude") {
                hasAuthoredBreak = true;
                space = "verse";
            }
            current = undefined;
        }
        pendingBlank = false;
        if (!current) {
            current = { lines: [], space };
            verses.push(current);
            space = "none";
        }
        current.lines.push({ ...line, text });
        sawLyric = true;
    }

    const result = hasAuthoredBreak ? verses : inferVerses(verses);
    const last = result.at(-1);
    if (last && space === "interlude") last.trailingInterlude = true;
    return result;
}

function onsetGap(previous: FocusLyricsLine, next: FocusLyricsLine) {
    if (previous.startTime === null || next.startTime === null) return null;
    const gap = next.startTime - previous.startTime;
    return Number.isFinite(gap) ? gap : null;
}

function nearbyMedian(gaps: (number | null)[], index: number) {
    const nearby = gaps
        .slice(Math.max(1, index - CADENCE_WINDOW), index)
        .concat(gaps.slice(index + 1, index + 1 + CADENCE_WINDOW))
        .filter((gap): gap is number => gap !== null);
    return nearby.length >= 3 ? getMedian(nearby) : null;
}

function timingEvidence(lines: FocusLyricsLine[]) {
    const starts = lines.map((line, index) => (index ? onsetGap(lines[index - 1], line) : null));
    const intervals = starts.map((gap) => (gap !== null && gap > 0 ? gap : null));
    let latestEnd = -Infinity;
    const pauses = lines.map(({ startTime }, index) => {
        const previous = lines[index - 1];
        if (!previous) return null;
        const { startTime: previousStart, endTime } = previous;
        const hasEnd =
            previousStart !== null &&
            endTime !== undefined &&
            Number.isFinite(endTime) &&
            endTime > previousStart;
        if (hasEnd) latestEnd = Math.max(latestEnd, endTime);
        if (startTime === null || intervals[index] === null) return null;
        if (latestEnd >= startTime) return 0; // A prior voice is still singing.
        return hasEnd ? startTime - latestEnd : null;
    });

    return intervals.map((interval, index) => {
        if (interval === null) return 0;
        const typicalInterval = nearbyMedian(intervals, index);
        const pause = pauses[index];
        if (pause !== null) {
            const typicalPause = nearbyMedian(pauses, index) ?? 0;
            return pause / Math.max(650, typicalPause * 1.7, typicalPause + 450);
        }
        if (typicalInterval === null) return 0;
        // Start-only lyrics need a stronger departure from the local cadence:
        // a long interval can also be a single sustained lyric.
        return interval / Math.max(3200, typicalInterval * 1.55, typicalInterval + 1500);
    });
}

function relatedLine(first: string, second: string) {
    if (!first || !second) return 0;
    if (first === second) return 1;
    const length = Math.min(first.length, second.length);
    if (length < 5) return 0;
    let prefix = 0;
    while (prefix < length && first[prefix] === second[prefix]) prefix += 1;
    let suffix = 0;
    while (
        suffix < length - prefix &&
        first[first.length - suffix - 1] === second[second.length - suffix - 1]
    )
        suffix += 1;
    return prefix + suffix >= Math.ceil(Math.max(first.length, second.length) * 0.75) ? 0.75 : 0;
}

type Repeat = { first: number; second: number; length: number; score: number };
type LineEvidence = { key: string; end: number; pause: number; canSplit: boolean };

function repeatCandidates(lines: LineEvidence[]) {
    const repeats: Repeat[] = [];
    for (const [first, anchor] of lines.entries()) {
        if (anchor.end - first < 2 || !anchor.canSplit) continue;
        for (let second = first + 2; second < lines.length - 1; second += 1) {
            const other = lines[second];
            const limit = Math.min(anchor.end - first, other.end - second, second - first);
            if (limit < 2 || !other.canSplit || !relatedLine(anchor.key, other.key)) continue;
            if (
                lines[first - 1]?.end === anchor.end &&
                lines[second - 1].end === other.end &&
                relatedLine(lines[first - 1].key, lines[second - 1].key)
            )
                continue; // Use the start of the shared passage, including nearby variants.

            let length = 0;
            let matches = 0;
            for (; length < Math.min(limit, MAX_REFRAIN_LINES); length += 1) {
                const similarity = relatedLine(
                    lines[first + length].key,
                    lines[second + length].key,
                );
                if (!similarity) break;
                matches += similarity;
            }
            if (length < 2 || matches < length * 0.8) continue;
            if (
                length === MAX_REFRAIN_LINES &&
                length < limit &&
                relatedLine(lines[first + length].key, lines[second + length].key)
            )
                continue; // The scan limit is not evidence for a boundary.
            const distinct = new Set(lines.slice(first, first + length).map(({ key }) => key)).size;
            const pauses = [first, second].map((start) => [
                lines[start].pause,
                lines[start + length]?.pause ?? 0,
            ]);
            if (
                distinct < 2 ||
                (distinct < 3 && !pauses.every((pair) => Math.max(...pair) >= 0.85))
            )
                continue; // Short repeated hooks need a rhythmic break in both occurrences.
            const support = pauses.flat().reduce((sum, pause) => sum + Math.min(1, pause), 0);
            repeats.push({ first, second, length, score: matches + support * 0.5 });
        }
    }
    return repeats.sort((a, b) => b.score - a.score);
}

function inferVerses(verses: Verse[]) {
    const evidence: LineEvidence[] = [];
    for (const { lines, marker } of verses) {
        const end = evidence.length + lines.length;
        const timing = marker ? [0] : timingEvidence(lines);
        for (const [index, line] of lines.entries()) {
            const gap = index ? onsetGap(lines[index - 1], line) : null;
            evidence.push({
                key: marker
                    ? ""
                    : line.text
                          .normalize("NFKC")
                          .toLowerCase()
                          .replace(/[\s\p{P}\p{Cf}]+/gu, ""),
                end,
                pause: timing[index],
                canSplit: gap === null || gap > 0,
            });
        }
    }

    // Reserve longer shared passages before their shorter, overlapping motifs.
    const owners: ({ start: number; end: number } | undefined)[] = [];
    const breaks = new Set<number>();
    for (const { first, second, length } of repeatCandidates(evidence)) {
        const starts = [first, second];
        if (
            !starts.every((start) => {
                const end = start + length;
                if (end < evidence[start].end && !evidence[end].canSplit) return false;
                for (let index = start; index < end; index += 1) {
                    const owner = owners[index];
                    if (owner && (owner.start !== start || owner.end !== end)) return false;
                }
                return true;
            })
        )
            continue;

        for (const start of starts) {
            const end = start + length;
            breaks.add(start);
            breaks.add(end);
            const owner = { start, end };
            for (let index = start; index < end; index += 1) owners[index] = owner;
        }
    }

    let offset = 0;
    return verses.flatMap((verse) => {
        const { lines } = verse;
        const cuts = new Set(
            lines.flatMap((_, index) => (index && breaks.has(offset + index) ? [index] : [])),
        );
        cuts.add(0);
        cuts.add(lines.length);
        const pauses = evidence
            .slice(offset, offset + lines.length)
            .map(({ pause }, index) => ({ pause, index }))
            // A pause within a refrain needs more evidence to split the shared phrase.
            .filter(({ pause, index }) => pause >= (owners[offset + index] ? 1.25 : 1))
            .sort((a, b) => b.pause - a.pause);
        for (const { index } of pauses) {
            if (!cuts.has(index - 1) && !cuts.has(index + 1)) cuts.add(index);
        }

        offset += lines.length;
        const boundaries = [...cuts].sort((a, b) => a - b);
        return boundaries.slice(0, -1).map((start, index) => ({
            ...verse,
            space: start === 0 ? verse.space : ("verse" as const),
            lines: lines.slice(start, boundaries[index + 1]),
        }));
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
