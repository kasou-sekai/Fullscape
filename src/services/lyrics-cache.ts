import type { EnhancedLyricLine, ThirdPartyLyricsDebug } from "./third-party-lyrics";
import CFM from "../utils/config";
import { traceLyricsBridge } from "./lyrics-bridge-trace";

export type LyricsCacheKind = "spotify" | "enhanced" | "enhanced-relaxed";
export type LyricsCacheSource = "plugin" | "lyric-shiori" | "unknown";
export type LyricsCacheSourceKind = "without-plugin" | "plugin" | "manual";

export type LyricsCacheMetadata = {
    title?: string;
    artist?: string;
    album?: string;
    languageCode?: string;
    translationLanguages?: string[];
    duration?: number;
};

/** Per-lyric desktop display colours supplied by LyricShiori in LRCX/cache entries. */
export type DesktopLyricsColors = {
    preset?: string;
    unplayedColor: string;
    playedColor: string;
    outlineColor: string;
};

export type LyricsCacheEntry = {
    kind: LyricsCacheKind;
    trackUri: string;
    cachedAt: number;
    expiresAt: number;
    lines: EnhancedLyricLine[];
    metadata?: LyricsCacheMetadata;
    cacheSource?: LyricsCacheSourceKind;
    source?: LyricsCacheSource;
    sourceName?: string;
    isManualSelection?: boolean;
    cachedWithoutPlugin?: boolean;
    offsetMilliseconds?: number;
    timingOffsetApplied?: boolean;
    hidden?: boolean;
    desktopLyricsColors?: DesktopLyricsColors;
    debug?: ThirdPartyLyricsDebug;
};

type LyricsCacheStore = {
    version: 9;
    entries: Record<string, LyricsCacheEntry>;
};

const STORAGE_KEY = "full-screen:lyrics-cache-v9";
const LEGACY_STORAGE_KEYS = [
    "full-screen:lyrics-cache-v1",
    "full-screen:lyrics-cache-v2",
    "full-screen:lyrics-cache-v3",
    "full-screen:lyrics-cache-v4",
    "full-screen:lyrics-cache-v5",
    "full-screen:lyrics-cache-v6",
    "full-screen:lyrics-cache-v7",
    "full-screen:lyrics-cache-v8",
];
const CACHE_VERSION = 9;
const READY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 40;
const MAX_SERIALIZED_LENGTH = 1_750_000;
const SHARED_REQUEST_TIMEOUT_MS = 800;
const SHARED_CACHE_ENDPOINTS = [
    "http://localhost:24887/lyrics-cache",
    "http://127.0.0.1:24887/lyrics-cache",
    "http://[::1]:24887/lyrics-cache",
];

let store: LyricsCacheStore | null = null;

export function getCachedLyrics(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind)?.lines ?? null;
}

export function getCachedLyricsDebug(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind)?.debug ?? null;
}

export async function getSharedCachedLyrics(
    trackUri: string,
    kind: LyricsCacheKind,
    cacheLocally = true,
    metadata: LyricsCacheMetadata = {},
) {
    if (!CFM.get("sharedLyricsBridge")) return null;
    try {
        const params = new URLSearchParams({ trackUri, kind });
        if (metadata.title) params.set("title", metadata.title);
        if (metadata.artist) params.set("artist", metadata.artist);
        if (metadata.album) params.set("album", metadata.album);
        if (typeof metadata.duration === "number" && Number.isFinite(metadata.duration)) {
            params.set("duration", `${metadata.duration}`);
        }
        for (const endpoint of SHARED_CACHE_ENDPOINTS) {
            try {
                const response = await fetchSharedWithTimeout(`${endpoint}?${params.toString()}`, {
                    headers: { Accept: "application/json" },
                });
                if (!response.ok) continue;
                const entry = (await response.json()) as LyricsCacheEntry;
                if (!isValidEntry(entry, trackUri, kind)) return null;
                traceLyricsBridge("bridge.received", entry, `GET ${endpoint}`);
                if (cacheLocally) {
                    setCachedLyrics(entry.trackUri, entry.kind, entry.lines, entry.debug, false, {
                        metadata: entry.metadata,
                        cacheSource: entry.cacheSource,
                        source: entry.source,
                        sourceName: entry.sourceName,
                        isManualSelection: entry.isManualSelection,
                        cachedWithoutPlugin: entry.cachedWithoutPlugin,
                        offsetMilliseconds: entry.offsetMilliseconds,
                        timingOffsetApplied: entry.timingOffsetApplied,
                        hidden: entry.hidden,
                        desktopLyricsColors: entry.desktopLyricsColors,
                    });
                }
                return entry;
            } catch {
                continue;
            }
        }
        return null;
    } catch {
        return null;
    }
}

function getCachedLyricsEntry(trackUri: string, kind: LyricsCacheKind) {
    const cache = getStore();
    const key = getCacheKey(trackUri, kind);
    const entry = cache.entries[key];
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        delete cache.entries[key];
        persistStore();
        return null;
    }
    return entry;
}

export function getCachedLyricsFullEntry(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind);
}

export function syncCachedLyricsToShared(entry: LyricsCacheEntry) {
    void setSharedCachedLyrics(entry);
}

export function setCachedLyrics(
    trackUri: string,
    kind: LyricsCacheKind,
    lines: EnhancedLyricLine[],
    debug?: ThirdPartyLyricsDebug,
    syncShared = true,
    metadata: Partial<Omit<LyricsCacheEntry, "kind" | "trackUri" | "cachedAt" | "expiresAt" | "lines" | "debug">> = {},
) {
    const cache = getStore();
    const now = Date.now();
    const entry: LyricsCacheEntry = {
        kind,
        trackUri,
        cachedAt: now,
        expiresAt: now + (lines.length ? READY_TTL_MS : EMPTY_TTL_MS),
        lines,
        cacheSource: metadata.cacheSource ?? inferCacheSource(metadata),
        source: metadata.source ?? "plugin",
        sourceName: metadata.sourceName,
        isManualSelection: metadata.isManualSelection ?? false,
        cachedWithoutPlugin: metadata.cachedWithoutPlugin ?? false,
        offsetMilliseconds: metadata.offsetMilliseconds,
        timingOffsetApplied: metadata.timingOffsetApplied ?? false,
        hidden: metadata.hidden ?? false,
        desktopLyricsColors: metadata.desktopLyricsColors,
        metadata: metadata.metadata,
        debug,
    };
    const key = getCacheKey(trackUri, kind);
    if (
        getEffectiveCacheSource(cache.entries[key]) === "manual" &&
        getEffectiveCacheSource(entry) !== "manual"
    ) {
        return;
    }
    cache.entries[key] = entry;
    trimStore(cache);
    persistStore();
    traceLyricsBridge("cache.saved", entry, syncShared ? "will-post" : "local-only");
    if (syncShared) void setSharedCachedLyrics(entry);
}

export function deleteCachedLyrics(trackUri: string, kind?: LyricsCacheKind) {
    const cache = getStore();
    const kinds: LyricsCacheKind[] = kind
        ? [kind]
        : ["spotify", "enhanced", "enhanced-relaxed"];
    let changed = false;
    kinds.forEach((cacheKind) => {
        const key = getCacheKey(trackUri, cacheKind);
        if (!(key in cache.entries)) return;
        if (getEffectiveCacheSource(cache.entries[key]) === "manual") return;
        delete cache.entries[key];
        changed = true;
    });
    if (changed) persistStore();
}

export function getEffectiveCacheSource(entry?: Pick<LyricsCacheEntry, "cacheSource" | "source" | "isManualSelection" | "cachedWithoutPlugin"> | null): LyricsCacheSourceKind {
    if (!entry) return "without-plugin";
    if (entry.cacheSource) return entry.cacheSource;
    if (entry.isManualSelection) return "manual";
    if (entry.source === "plugin") return "plugin";
    if (entry.cachedWithoutPlugin) return "without-plugin";
    return entry.source === "lyric-shiori" ? "without-plugin" : "plugin";
}

function inferCacheSource(metadata: Partial<Pick<LyricsCacheEntry, "cacheSource" | "source" | "isManualSelection" | "cachedWithoutPlugin">>): LyricsCacheSourceKind {
    return getEffectiveCacheSource(metadata);
}

function getStore(): LyricsCacheStore {
    if (store) return store;
    try {
        LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
        if (
            parsed?.version === CACHE_VERSION &&
            parsed.entries &&
            typeof parsed.entries === "object"
        ) {
            store = parsed as LyricsCacheStore;
            removeExpiredEntries(store);
            return store;
        }
    } catch {
        // Start with a clean cache when stored data is unavailable or malformed.
    }
    store = { version: CACHE_VERSION, entries: {} };
    return store;
}

function getCacheKey(trackUri: string, kind: LyricsCacheKind) {
    return `${kind}:${trackUri}`;
}

function isValidEntry(entry: LyricsCacheEntry, trackUri: string, kind: LyricsCacheKind) {
    return (
        entry?.trackUri === trackUri &&
        entry.kind === kind &&
        Array.isArray(entry.lines) &&
        Number(entry.expiresAt) > Date.now()
    );
}

async function setSharedCachedLyrics(entry: LyricsCacheEntry) {
    for (const endpoint of SHARED_CACHE_ENDPOINTS) {
        try {
            const response = await fetchSharedWithTimeout(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entry),
            });
            if (response.ok) {
                traceLyricsBridge("bridge.posted", entry, `POST ${endpoint}`);
                return;
            }
        } catch {
            continue;
        }
    }
    traceLyricsBridge("bridge.post-failed", entry);
    // LyricShiori may not be running; localStorage remains the source of truth.
}

function fetchSharedWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SHARED_REQUEST_TIMEOUT_MS);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
        clearTimeout(timeoutId);
    });
}

function removeExpiredEntries(cache: LyricsCacheStore) {
    const now = Date.now();
    for (const [key, entry] of Object.entries(cache.entries)) {
        if (
            !entry ||
            entry.expiresAt <= now ||
            !Array.isArray(entry.lines) ||
            entry.trackUri.length === 0
        ) {
            delete cache.entries[key];
        }
    }
}

function trimStore(cache: LyricsCacheStore) {
    removeExpiredEntries(cache);
    const entries = Object.entries(cache.entries).sort(
        ([, first], [, second]) => second.cachedAt - first.cachedAt,
    );
    cache.entries = Object.fromEntries(entries.slice(0, MAX_ENTRIES));

    while (
        Object.keys(cache.entries).length > 1 &&
        JSON.stringify(cache).length > MAX_SERIALIZED_LENGTH
    ) {
        const oldestKey = Object.entries(cache.entries).sort(
            ([, first], [, second]) => first.cachedAt - second.cachedAt,
        )[0]?.[0];
        if (!oldestKey) break;
        delete cache.entries[oldestKey];
    }
}

function persistStore() {
    if (!store) return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        const oldestKey = Object.entries(store.entries).sort(
            ([, first], [, second]) => first.cachedAt - second.cachedAt,
        )[0]?.[0];
        if (!oldestKey) return;
        delete store.entries[oldestKey];
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch {
            // Keep the in-memory cache when browser storage is full or unavailable.
        }
    }
}
