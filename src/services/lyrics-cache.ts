import type { EnhancedLyricLine, ThirdPartyLyricsDebug } from "./third-party-lyrics";
import CFM from "../utils/config";

export type LyricsCacheKind = "spotify" | "enhanced" | "enhanced-relaxed";

type LyricsCacheEntry = {
    kind: LyricsCacheKind;
    trackUri: string;
    cachedAt: number;
    expiresAt: number;
    lines: EnhancedLyricLine[];
    debug?: ThirdPartyLyricsDebug;
};

type LyricsCacheStore = {
    version: 6;
    entries: Record<string, LyricsCacheEntry>;
};

const STORAGE_KEY = "full-screen:lyrics-cache-v6";
const LEGACY_STORAGE_KEYS = [
    "full-screen:lyrics-cache-v1",
    "full-screen:lyrics-cache-v2",
    "full-screen:lyrics-cache-v3",
    "full-screen:lyrics-cache-v4",
    "full-screen:lyrics-cache-v5",
];
const CACHE_VERSION = 6;
const READY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 40;
const MAX_SERIALIZED_LENGTH = 1_750_000;
const SHARED_CACHE_ENDPOINT = "http://127.0.0.1:24887/lyrics-cache";

let store: LyricsCacheStore | null = null;

export function getCachedLyrics(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind)?.lines ?? null;
}

export function getCachedLyricsDebug(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind)?.debug ?? null;
}

export async function getSharedCachedLyrics(trackUri: string, kind: LyricsCacheKind) {
    if (!CFM.get("sharedLyricsBridge")) return null;
    try {
        const params = new URLSearchParams({ trackUri, kind });
        const response = await fetch(`${SHARED_CACHE_ENDPOINT}?${params.toString()}`, {
            headers: { Accept: "application/json" },
        });
        if (!response.ok) return null;
        const entry = (await response.json()) as LyricsCacheEntry;
        if (!isValidEntry(entry, trackUri, kind)) return null;
        setCachedLyrics(entry.trackUri, entry.kind, entry.lines, entry.debug, false);
        return entry;
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

export function setCachedLyrics(
    trackUri: string,
    kind: LyricsCacheKind,
    lines: EnhancedLyricLine[],
    debug?: ThirdPartyLyricsDebug,
    syncShared = true,
) {
    const cache = getStore();
    const now = Date.now();
    const entry = {
        kind,
        trackUri,
        cachedAt: now,
        expiresAt: now + (lines.length ? READY_TTL_MS : EMPTY_TTL_MS),
        lines,
        debug,
    };
    cache.entries[getCacheKey(trackUri, kind)] = entry;
    trimStore(cache);
    persistStore();
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
        delete cache.entries[key];
        changed = true;
    });
    if (changed) persistStore();
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
    if (!CFM.get("sharedLyricsBridge")) return;
    try {
        await fetch(SHARED_CACHE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
        });
    } catch {
        // LyricShiori may not be running; localStorage remains the source of truth.
    }
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
