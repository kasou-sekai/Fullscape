import type { LyricsCacheEntry, LyricsCacheKind } from "./lyrics-cache";

export type LyricsBridgeTraceEvent = {
    timestamp: string;
    event: string;
    trackUri: string;
    kind?: LyricsCacheKind;
    source?: string;
    cachedAt?: number;
    lineCount: number;
    translationCount: number;
    romanizationCount: number;
    wordLineCount: number;
    detail?: string;
};

type TraceInput = Pick<LyricsCacheEntry, "trackUri" | "kind" | "cacheSource" | "cachedAt" | "lines">;

const STORAGE_KEY = "full-screen:lyrics-bridge-trace-v1";
const MAX_ENTRIES = 400;
const DEDUPE_WINDOW_MS = 1500;
let lastSignature = "";
let lastRecordedAt = 0;

export function traceLyricsBridge(event: string, entry: TraceInput, detail?: string) {
    const lines = entry.lines;
    const record: LyricsBridgeTraceEvent = {
        timestamp: new Date().toISOString(),
        event,
        trackUri: entry.trackUri,
        kind: entry.kind,
        source: entry.cacheSource,
        cachedAt: entry.cachedAt,
        lineCount: lines.length,
        translationCount: lines.filter((line) => Boolean(line.translation?.trim())).length,
        romanizationCount: lines.filter((line) => Boolean(line.romanization?.trim())).length,
        wordLineCount: lines.filter((line) => Boolean(line.words?.length)).length,
        detail,
    };
    const signature = [event, record.trackUri, record.kind, record.cachedAt, record.lineCount, record.translationCount, record.romanizationCount, record.wordLineCount, detail ?? ""].join("|");
    const now = Date.now();
    if (signature === lastSignature && now - lastRecordedAt < DEDUPE_WINDOW_MS) return;
    lastSignature = signature;
    lastRecordedAt = now;

    try {
        const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        const entries = Array.isArray(previous) ? previous : [];
        entries.push(record);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch {
        // Diagnostics must never affect lyric rendering or cache synchronization.
    }
    console.debug("[Full-Screen lyrics bridge]", record);
}

export function getLyricsBridgeTrace(): LyricsBridgeTraceEvent[] {
    try {
        const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(entries) ? entries : [];
    } catch {
        return [];
    }
}
