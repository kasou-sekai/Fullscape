import {
    mergeFuriganaAnnotations,
    type FuriganaAnnotation,
    type FuriganaRenderData,
} from "../utils/furigana";
import { getOfflineFurigana } from "./offline-furigana-dictionary";

type DictionaryToken = {
    surface: string;
    reading?: string;
};

type DictionaryFuriganaResponse = {
    tokens?: unknown;
    words?: unknown;
};

const SHIRABE_FURIGANA_URL = "https://shirabe.dev/api/v1/text/furigana";
const YOMI_FURIGANA_URL = "https://yomi.onrender.com/analyze";
const REQUEST_TIMEOUT_MS = 10000;
const YOMI_MAX_TEXT_LENGTH = 4500;
const ONLINE_CACHE_LIMIT = 500;
const KANJI_PATTERN = /[\p{Script=Han}々〆ヶ]/u;
const onlineFuriganaCache = new Map<string, FuriganaRenderData>();

export type DictionaryFuriganaOptions = {
    allowOnline?: boolean;
    onOfflineResults?: (results: FuriganaRenderData[]) => void;
};

/**
 * Gets render-only furigana from Shirabe's public IPAdic-backed endpoint.
 * The caller owns the returned data; this module intentionally has no
 * persistent cache and never mutates lyric lines.
 */
export async function fetchDictionaryFurigana(
    lines: string[],
    options: DictionaryFuriganaOptions = {},
): Promise<FuriganaRenderData[]> {
    const emptyResults: FuriganaRenderData[] = lines.map((text) => ({
        text,
        annotations: [],
    }));
    const offlineResults = await getOfflineFurigana(lines);
    const baseResults = offlineResults ?? emptyResults;
    if (offlineResults) {
        options.onOfflineResults?.(offlineResults.map(cloneRenderData));
    }
    if (options.allowOnline === false) return baseResults;

    const unresolvedTexts = Array.from(
        new Set(
            lines.filter((text, index) =>
                hasUnannotatedKanji(text, baseResults[index]?.annotations ?? []),
            ),
        ),
    );
    if (!unresolvedTexts.length) return baseResults;

    const resultsByText = new Map<string, FuriganaRenderData>();
    const uncachedTexts: string[] = [];
    unresolvedTexts.forEach((text) => {
        const cached = onlineFuriganaCache.get(text);
        if (cached) resultsByText.set(text, cloneRenderData(cached));
        else uncachedTexts.push(text);
    });
    if (uncachedTexts.length) {
        const onlineResults = await fetchOnlineDictionaryFurigana(uncachedTexts);
        uncachedTexts.forEach((text, index) => {
            const result = onlineResults[index] ?? { text, annotations: [] };
            resultsByText.set(text, result);
            if (result.annotations.length) cacheOnlineResult(text, result);
        });
    }

    const results = baseResults.map((result) => ({
        text: result.text,
        annotations: [...result.annotations],
    }));
    lines.forEach((text, index) => {
        const onlineResult = resultsByText.get(text);
        if (onlineResult?.annotations.length) {
            results[index].annotations = mergeFuriganaAnnotations(
                results[index].annotations,
                onlineResult.annotations,
            );
        }
    });
    return results;
}

function cloneRenderData(data: FuriganaRenderData): FuriganaRenderData {
    return {
        text: data.text,
        annotations: data.annotations.map((annotation) => ({ ...annotation })),
    };
}

function cacheOnlineResult(text: string, result: FuriganaRenderData) {
    onlineFuriganaCache.delete(text);
    onlineFuriganaCache.set(text, cloneRenderData(result));
    if (onlineFuriganaCache.size <= ONLINE_CACHE_LIMIT) return;
    const oldestKey = onlineFuriganaCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) onlineFuriganaCache.delete(oldestKey);
}

async function fetchOnlineDictionaryFurigana(lines: string[]): Promise<FuriganaRenderData[]> {
    const emptyResults: FuriganaRenderData[] = lines.map((text) => ({
        text,
        annotations: [],
    }));
    const requestLines = lines.filter((text) => KANJI_PATTERN.test(text));
    if (!requestLines.length) return emptyResults;

    const sourceText = requestLines.join("\n");
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
            response = await fetch(SHIRABE_FURIGANA_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: sourceText }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        if (response.ok) {
            const payload = (await response.json()) as DictionaryFuriganaResponse;
            const tokens = parseDictionaryTokens(payload);
            if (tokens.length)
                return splitAnnotationsByLine(requestLines, sourceText, tokens, lines);
        }
    } catch {
        // Shirabe currently does not expose CORS headers to Spotify pages.
    }

    try {
        if (typeof Spicetify !== "undefined" && Spicetify.CosmosAsync?.post) {
            const response = await withTimeout(
                Spicetify.CosmosAsync.post(
                    SHIRABE_FURIGANA_URL,
                    { text: sourceText },
                    { "Content-Type": "application/json" },
                ),
                REQUEST_TIMEOUT_MS,
            );
            const tokens = parseDictionaryTokens(response);
            if (tokens.length)
                return splitAnnotationsByLine(requestLines, sourceText, tokens, lines);
        }
    } catch {
        // Fall through to the CORS-friendly public service.
    }
    return fetchYomiDictionaryFurigana(lines);
}

async function fetchYomiDictionaryFurigana(lines: string[]): Promise<FuriganaRenderData[]> {
    const results: FuriganaRenderData[] = lines.map((text) => ({
        text,
        annotations: [],
    }));
    const chunks: string[][] = [];
    lines.forEach((line) => {
        const previous = chunks[chunks.length - 1];
        if (previous && previous.join("\n").length + line.length + 1 <= YOMI_MAX_TEXT_LENGTH) {
            previous.push(line);
        } else {
            chunks.push([line]);
        }
    });

    let lineOffset = 0;
    for (const chunk of chunks) {
        const chunkResults = await fetchYomiChunk(chunk);
        chunkResults.forEach((result, index) => {
            if (result.annotations.length) results[lineOffset + index] = result;
        });
        lineOffset += chunk.length;
    }
    return results;
}

async function fetchYomiChunk(lines: string[]): Promise<FuriganaRenderData[]> {
    const emptyResults: FuriganaRenderData[] = lines.map((text) => ({
        text,
        annotations: [],
    }));
    const requestLines = lines.filter((text) => KANJI_PATTERN.test(text));
    if (!requestLines.length) return emptyResults;

    const sourceText = requestLines.join("\n");
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
            response = await fetch(YOMI_FURIGANA_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    text: sourceText,
                    mode: "furigana",
                    to: "hiragana",
                }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        if (!response.ok) return emptyResults;

        const tokens = parseDictionaryTokens(await response.json());
        if (!tokens.length) return emptyResults;
        return splitAnnotationsByLine(requestLines, sourceText, tokens, lines);
    } catch {
        return emptyResults;
    }
}

function parseDictionaryTokens(value: unknown): DictionaryToken[] {
    if (typeof value === "string") {
        try {
            return parseDictionaryTokens(JSON.parse(value));
        } catch {
            return [];
        }
    }
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const tokenList = Array.isArray(record.tokens)
        ? record.tokens
        : Array.isArray(record.words)
          ? record.words
          : [];
    return tokenList.flatMap((token) => {
        if (!token || typeof token !== "object") return [];
        const tokenRecord = token as Record<string, unknown>;
        const surface = typeof tokenRecord.surface === "string" ? tokenRecord.surface : "";
        const reading =
            typeof tokenRecord.reading_raw === "string"
                ? tokenRecord.reading_raw
                : typeof tokenRecord.reading === "string"
                  ? tokenRecord.reading
                  : undefined;
        return surface ? [{ surface, reading }] : [];
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(
            () => reject(new Error("dictionary request timed out")),
            timeoutMs,
        );
        promise.then(
            (value) => {
                clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}

function splitAnnotationsByLine(
    requestLines: string[],
    sourceText: string,
    tokens: DictionaryToken[],
    originalLines: string[],
) {
    const lineResults = requestLines.map((text) => ({
        text,
        annotations: [] as FuriganaAnnotation[],
    }));
    const lineStarts = requestLines.reduce<number[]>((starts, line, index) => {
        starts.push(index === 0 ? 0 : starts[index - 1] + requestLines[index - 1].length + 1);
        return starts;
    }, []);
    let cursor = 0;

    tokens.forEach((token) => {
        const tokenStart = sourceText.indexOf(token.surface, cursor);
        if (tokenStart < 0) return;
        cursor = tokenStart + token.surface.length;
        const annotations = createTokenAnnotations(token.surface, token.reading);
        if (!annotations.length) return;

        const lineIndex = findLineIndex(lineStarts, tokenStart);
        const lineStart = lineStarts[lineIndex] ?? 0;
        annotations.forEach((annotation) => {
            if (tokenStart + annotation.end > lineStart + requestLines[lineIndex].length) return;
            lineResults[lineIndex].annotations.push({
                start: tokenStart - lineStart + annotation.start,
                end: tokenStart - lineStart + annotation.end,
                reading: annotation.reading,
            });
        });
    });

    let requestLineIndex = 0;
    return originalLines.map((line) => {
        if (!KANJI_PATTERN.test(line)) return { text: line, annotations: [] };
        const result = lineResults[requestLineIndex++] ?? { text: line, annotations: [] };
        const annotations = result.annotations.sort((first, second) => first.start - second.start);
        return { text: line, annotations };
    });
}

function hasUnannotatedKanji(text: string, annotations: FuriganaAnnotation[]) {
    let offset = 0;
    for (const character of Array.from(text)) {
        if (
            KANJI_PATTERN.test(character) &&
            !annotations.some((annotation) => annotation.start <= offset && offset < annotation.end)
        ) {
            return true;
        }
        offset += character.length;
    }
    return false;
}

function findLineIndex(lineStarts: number[], position: number) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lineStarts[middle] <= position) low = middle;
        else high = middle - 1;
    }
    return low;
}

function createTokenAnnotations(surface: string, reading?: string): FuriganaAnnotation[] {
    if (!reading || !KANJI_PATTERN.test(surface)) return [];

    const surfaceCharacters = Array.from(surface);
    const readingCharacters = Array.from(reading);
    const normalizedSurface = surfaceCharacters.map(toHiragana);
    const normalizedReading = readingCharacters.map(toHiragana);
    const surfaceOffsets = getCharacterOffsets(surfaceCharacters);
    const readingOffsets = getCharacterOffsets(readingCharacters);
    const annotations: FuriganaAnnotation[] = [];
    let surfaceCursor = 0;
    let readingCursor = 0;

    while (surfaceCursor < surfaceCharacters.length) {
        if (
            KANJI_PATTERN.test(surfaceCharacters[surfaceCursor]) &&
            KANJI_PATTERN.test(readingCharacters[readingCursor] ?? "") &&
            normalizedSurface[surfaceCursor] === normalizedReading[readingCursor]
        ) {
            surfaceCursor += 1;
            readingCursor += 1;
            continue;
        }

        if (!KANJI_PATTERN.test(surfaceCharacters[surfaceCursor])) {
            const surfaceAnchorStart = surfaceCursor;
            while (
                surfaceCursor < surfaceCharacters.length &&
                !KANJI_PATTERN.test(surfaceCharacters[surfaceCursor])
            ) {
                surfaceCursor += 1;
            }
            const readingAnchorStart = findSequence(
                normalizedReading,
                normalizedSurface.slice(surfaceAnchorStart, surfaceCursor),
                readingCursor,
            );
            if (readingAnchorStart < 0) return [];
            readingCursor = readingAnchorStart + (surfaceCursor - surfaceAnchorStart);
            continue;
        }

        const kanjiStart = surfaceCursor;
        while (
            surfaceCursor < surfaceCharacters.length &&
            KANJI_PATTERN.test(surfaceCharacters[surfaceCursor])
        ) {
            surfaceCursor += 1;
        }
        const kanjiEnd = surfaceCursor;
        const readingEnd =
            surfaceCursor < surfaceCharacters.length
                ? findSequence(
                      normalizedReading,
                      normalizedSurface.slice(
                          surfaceCursor,
                          findAnchorEnd(surfaceCharacters, surfaceCursor),
                      ),
                      readingCursor,
                  )
                : normalizedReading.length;
        if (readingEnd < 0 || readingEnd <= readingCursor) return [];

        annotations.push({
            start: surfaceOffsets[kanjiStart],
            end: surfaceOffsets[kanjiEnd],
            reading: reading.slice(readingOffsets[readingCursor], readingOffsets[readingEnd]),
        });
        readingCursor = readingEnd;
    }

    return annotations;
}

function findAnchorEnd(characters: string[], start: number) {
    let end = start;
    while (end < characters.length && !KANJI_PATTERN.test(characters[end])) end += 1;
    return end;
}

function findSequence(haystack: string[], needle: string[], from: number) {
    if (!needle.length) return from;
    for (let index = from; index <= haystack.length - needle.length; index += 1) {
        if (needle.every((character, offset) => haystack[index + offset] === character)) {
            return index;
        }
    }
    return -1;
}

function getCharacterOffsets(characters: string[]) {
    const offsets = [0];
    characters.forEach((character) => offsets.push(offsets[offsets.length - 1] + character.length));
    return offsets;
}

function toHiragana(character: string) {
    const code = character.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6
        ? String.fromCharCode(code - 0x60)
        : character === "ヵ"
          ? "ゕ"
          : character === "ヶ"
            ? "ゖ"
            : character;
}
