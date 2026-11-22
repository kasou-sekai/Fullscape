import { richGroupEnd } from "../../../services/lyrics-rich-document";
import type { EnhancedLyricLine } from "../../../services/third-party-lyrics";

export type TimedLyricLine = {
    index: number;
    time: number;
};

export type LyricInterlude = {
    start: number;
    end: number;
    anchorIndex: number;
    nextIndex: number;
};

const INTERLUDE_MIN_GAP_MS = 4000;
const INTERLUDE_FALLBACK_LINE_DURATION_MS = 2000;
const INTERLUDE_MIN_RELIABLE_INTERVALS = 5;
const INTERLUDE_NORMAL_EXTENSION_MS = 4000;
const INTERLUDE_MAX_MAD_RATIO = 0.35;
const INTERLUDE_MIN_INLIER_RATIO = 0.65;
const INTERLUDE_BREATH_BEATS = 8;
const INTERLUDE_DEFAULT_BPM = 120;

const CREDIT_ROLE_PATTERN =
    /^(?:作词|作曲|词曲|编曲|制作人|制作发行|音乐制作|音乐总监|发行|录音|人声录音|混音|母带|监制|和声|配唱|人声编辑|录音助理|键盘|吉他|贝斯|贝司|鼓手|鼓|长笛|提琴|录音棚|录音室|原唱|翻唱|作詞|編曲|演奏|録音|混音)\s*[:：]\s*\S/iu;
const CREDIT_PHRASE_PATTERN =
    /^(?:lyrics?|written|composed|arranged|produced|recorded|mixed|mastered|performed|vocals?)\s+by\s+\S/iu;
const COPYRIGHT_PATTERN = /(?:未经著作权人许可|不得翻唱翻录重制|all\s+rights\s+reserved|[©℗®])/iu;

export function buildLyricsTimeline(lines: EnhancedLyricLine[]) {
    const timedLines = getTimedLyrics(lines);
    return {
        timedLines,
        interludes: buildInterludes(lines, timedLines),
    };
}

export function findActiveLineIndex(timedLines: TimedLyricLine[], progress: number) {
    let low = 0;
    let high = timedLines.length - 1;
    let activeIndex = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const line = timedLines[middle];
        if (line.time <= progress) {
            activeIndex = line.index;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return activeIndex;
}

export function findActiveInterlude(interludes: LyricInterlude[], progress: number) {
    let low = 0;
    let high = interludes.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        const interlude = interludes[middle];
        if (progress < interlude.start) {
            high = middle - 1;
        } else if (progress >= interlude.end) {
            low = middle + 1;
        } else {
            return interlude;
        }
    }
    return null;
}

export function getInterludeBreatheDuration(bpm: number | null) {
    const normalizedBpm =
        typeof bpm === "number" && Number.isFinite(bpm)
            ? Math.min(220, Math.max(48, bpm))
            : INTERLUDE_DEFAULT_BPM;
    return (60000 / normalizedBpm) * INTERLUDE_BREATH_BEATS;
}

function getTimedLyrics(lines: EnhancedLyricLine[]): TimedLyricLine[] {
    return lines.flatMap((line, index) => (line.time === null ? [] : [{ index, time: line.time }]));
}

function buildInterludes(lines: EnhancedLyricLine[], timedLines: TimedLyricLine[]) {
    const metadataIndexes = getLyricsMetadataIndexes(lines);
    const plainLyricsNormalGap = getPlainLyricsNormalGap(lines, timedLines, metadataIndexes);
    const interludes: LyricInterlude[] = [];
    const rich = lines.some((line) => line.presentation);
    let richEnd = 0;

    for (let index = 0; index < timedLines.length; index += 1) {
        const next = timedLines[index];
        const previous = timedLines[index - 1];
        if (rich && previous) {
            richEnd = Math.max(richEnd, richGroupEnd(lines[previous.index]));
        }
        if (!previous && next.index !== 0) continue;
        if (previous && next.index !== previous.index + 1) continue;
        if (previous && (metadataIndexes.has(previous.index) || metadataIndexes.has(next.index))) {
            continue;
        }

        if (
            previous &&
            plainLyricsNormalGap !== null &&
            next.time - previous.time <= plainLyricsNormalGap
        ) {
            continue;
        }
        if (
            previous &&
            plainLyricsNormalGap === null &&
            !hasExplicitLyricEnd(lines[previous.index])
        ) {
            continue;
        }

        const plainLyricsMinimumDuration =
            plainLyricsNormalGap === null
                ? null
                : Math.max(0, plainLyricsNormalGap - INTERLUDE_NORMAL_EXTENSION_MS);
        const gapStart = previous
            ? rich
                ? richEnd
                : getLyricLineEnd(lines[previous.index], next.time, plainLyricsMinimumDuration)
            : 0;
        const gapEnd = Math.max(gapStart, next.time);
        if (gapEnd - gapStart < INTERLUDE_MIN_GAP_MS) continue;

        interludes.push({
            start: gapStart,
            end: gapEnd,
            anchorIndex: previous?.index ?? -1,
            nextIndex: next.index,
        });
    }
    return interludes;
}

function hasExplicitLyricEnd(line: EnhancedLyricLine) {
    const hasTimedWords = (line.words ?? []).some(
        (word) => Number.isFinite(word.time) && word.duration > 0,
    );
    return (
        hasTimedWords ||
        typeof line.presentation?.end === "number" ||
        (typeof line.duration === "number" && line.duration > 0)
    );
}

function getLyricsMetadataIndexes(lines: EnhancedLyricLine[]) {
    const metadataIndexes = new Set<number>();
    const creditLike = lines.map(isCreditLikeLyrics);
    const boundaryWindow = Math.max(2, Math.ceil(lines.length * 0.1));

    for (let start = 0; start < creditLike.length; ) {
        if (!creditLike[start]) {
            start += 1;
            continue;
        }

        let end = start;
        while (end + 1 < creditLike.length && creditLike[end + 1]) end += 1;
        const isBoundaryBlock = start <= boundaryWindow || end >= lines.length - boundaryWindow - 1;
        if (isBoundaryBlock) {
            for (let index = start; index <= end; index += 1) metadataIndexes.add(index);
        }
        start = end + 1;
    }

    lines.forEach((line, index) => {
        const isTailLine = index >= Math.max(0, lines.length - boundaryWindow);
        if (isTailLine && COPYRIGHT_PATTERN.test(normalizeMetadataText(line.text))) {
            metadataIndexes.add(index);
        }
    });

    return metadataIndexes;
}

function isCreditLikeLyrics(line: EnhancedLyricLine) {
    const text = normalizeMetadataText(line.text);
    return CREDIT_ROLE_PATTERN.test(text) || CREDIT_PHRASE_PATTERN.test(text);
}

function normalizeMetadataText(text: string) {
    return text.replace(/\s+/g, " ").trim();
}

export function getMedian(values: number[]) {
    if (!values.length) return null;
    const sorted = [...values].sort((first, second) => first - second);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function getPlainLyricsNormalGap(
    lines: EnhancedLyricLine[],
    timedLines: TimedLyricLine[],
    metadataIndexes: ReadonlySet<number>,
) {
    if (lines.some(hasExplicitLyricEnd)) return null;

    const intervals = timedLines.flatMap((current, index) => {
        const previous = timedLines[index - 1];
        if (
            !previous ||
            current.index !== previous.index + 1 ||
            metadataIndexes.has(previous.index) ||
            metadataIndexes.has(current.index)
        ) {
            return [];
        }
        const interval = current.time - previous.time;
        return interval > 0 ? [interval] : [];
    });
    if (intervals.length < INTERLUDE_MIN_RELIABLE_INTERVALS) return null;

    const median = getMedian(intervals);
    if (!median || median <= 0) return null;
    const deviations = intervals.map((interval) => Math.abs(interval - median));
    const mad = getMedian(deviations) ?? Number.POSITIVE_INFINITY;
    const normalBand = Math.max(1500, median * INTERLUDE_MAX_MAD_RATIO);
    const inlierRatio =
        intervals.filter((interval) => Math.abs(interval - median) <= normalBand).length /
        intervals.length;
    if (mad > median * INTERLUDE_MAX_MAD_RATIO || inlierRatio < INTERLUDE_MIN_INLIER_RATIO) {
        return null;
    }

    return median + INTERLUDE_NORMAL_EXTENSION_MS;
}

function getLyricLineEnd(
    line: EnhancedLyricLine,
    nextTime: number,
    plainLyricsMinimumDuration: number | null = null,
) {
    if (line.time === null) return nextTime;
    const measuredEnd = getMeasuredLyricEnd(line);
    if (measuredEnd !== undefined) return Math.min(nextTime, measuredEnd);

    // Plain LRC/Spotify lines do not carry an end timestamp. Keep the line
    // readable for the normal cadence when it is reliable, then use the
    // remainder as the interlude.
    const fallbackDuration = Math.min(
        Math.max(0, nextTime - line.time),
        Math.max(INTERLUDE_FALLBACK_LINE_DURATION_MS, plainLyricsMinimumDuration ?? 0),
    );
    return Math.min(nextTime, line.time + fallbackDuration);
}

export function getMeasuredLyricEnd(line: EnhancedLyricLine) {
    if (line.time === null) return undefined;
    const richEnd = line.presentation ? richGroupEnd(line) : line.time;
    if (richEnd > line.time) return richEnd;
    const explicitEnd =
        typeof line.duration === "number" && line.duration > 0
            ? line.time + line.duration
            : line.time;
    const timedWordEnd = (line.words ?? []).reduce((end, word) => {
        const wordEnd = word.time + Math.max(0, word.duration);
        return Number.isFinite(wordEnd) ? Math.max(end, wordEnd) : end;
    }, line.time);
    const measuredEnd = Math.max(timedWordEnd, explicitEnd);
    return measuredEnd > line.time ? measuredEnd : undefined;
}
