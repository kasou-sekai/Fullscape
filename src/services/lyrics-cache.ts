import type { EnhancedLyricLine, ThirdPartyLyricsDebug } from "./third-party-lyrics";
import { traceLyricsBridge } from "./lyrics-bridge-trace";
import { syncCachedLyricsToShared } from "./lyrics-bridge";

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

/** Per-lyric desktop display colours supplied by LyricShiori in LRCS/cache entries. */
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
    manualResetAt?: number;
    sourceFamily?: "standard" | "apple-music";
    documentRevision?: string;
    validatedMatcherVersion?: string;
};

type LyricsCacheStore = {
    version: 1;
    entries: Record<string, LyricsCacheEntry>;
    manualResets?: Record<string, number>;
};

const STORAGE_KEY = "fullscape:lyrics-cache-v1";
const CACHE_VERSION = 1;
const READY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 40;
const MAX_SERIALIZED_LENGTH = 1_750_000;

let store: LyricsCacheStore | null = null;

export function getCachedLyricsDebug(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind)?.debug ?? null;
}

function getCachedLyricsEntry(trackUri: string, kind: LyricsCacheKind) {
    const cache = getStore();
    const key = getCacheKey(trackUri, kind);
    const entry = cache.entries[key];
    if (!entry) return null;
    const failedEnhancement =
        entry.kind !== "spotify" &&
        entry.debug &&
        ["error", "not-matched"].includes(entry.debug.status) &&
        getEffectiveCacheSource(entry) !== "manual";
    const expiresAt = failedEnhancement
        ? Math.min(entry.expiresAt, entry.cachedAt + EMPTY_TTL_MS)
        : entry.expiresAt;
    if (expiresAt <= Date.now()) {
        delete cache.entries[key];
        persistStore();
        return null;
    }
    return entry;
}

export function getCachedLyricsFullEntry(trackUri: string, kind: LyricsCacheKind) {
    return getCachedLyricsEntry(trackUri, kind);
}

export function setCachedLyrics(
    trackUri: string,
    kind: LyricsCacheKind,
    lines: EnhancedLyricLine[],
    debug?: ThirdPartyLyricsDebug,
    syncShared = true,
    metadata: Partial<
        Omit<LyricsCacheEntry, "kind" | "trackUri" | "cachedAt" | "expiresAt" | "lines" | "debug">
    > = {},
) {
    const cache = getStore();
    const now = Date.now();
    const entry: LyricsCacheEntry = {
        kind,
        trackUri,
        cachedAt: now,
        expiresAt:
            now +
            (lines.length &&
            !(
                kind !== "spotify" &&
                debug &&
                ["error", "not-matched"].includes(debug.status) &&
                metadata.cacheSource !== "manual" &&
                !metadata.isManualSelection
            )
                ? READY_TTL_MS
                : EMPTY_TTL_MS),
        lines,
        cacheSource: metadata.cacheSource ?? getEffectiveCacheSource(metadata),
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
        return false;
    }
    const existing = cache.entries[key];
    if (existing && entriesEqual(existing, entry)) return false;
    cache.entries[key] = entry;
    trimStore(cache);
    persistStore();
    traceLyricsBridge("cache.saved", entry, syncShared ? "will-post" : "local-only");
    if (syncShared) syncCachedLyricsToShared(entry);
    return true;
}

export function deleteCachedLyrics(trackUri: string, kind?: LyricsCacheKind) {
    const cache = getStore();
    const kinds: LyricsCacheKind[] = kind ? [kind] : ["spotify", "enhanced", "enhanced-relaxed"];
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

/** Applies a LyricShiori reset even though normal deletion preserves manual entries. */
export function consumeSharedManualReset(entry: LyricsCacheEntry) {
    const resetAt = Number(entry.manualResetAt ?? 0);
    if (!Number.isFinite(resetAt) || resetAt <= 0) return false;
    const cache = getStore();
    const manualResets = cache.manualResets ?? {};
    if ((manualResets[entry.trackUri] ?? 0) >= resetAt) return false;
    manualResets[entry.trackUri] = resetAt;
    cache.manualResets = Object.fromEntries(
        Object.entries(manualResets)
            .sort(([, first], [, second]) => second - first)
            .slice(0, 200),
    );
    for (const kind of ["spotify", "enhanced", "enhanced-relaxed"] as LyricsCacheKind[]) {
        const key = getCacheKey(entry.trackUri, kind);
        if (getEffectiveCacheSource(cache.entries[key]) !== "manual") continue;
        delete cache.entries[key];
    }
    persistStore();
    return true;
}

export function getEffectiveCacheSource(
    entry?: Pick<
        LyricsCacheEntry,
        "cacheSource" | "source" | "isManualSelection" | "cachedWithoutPlugin"
    > | null,
): LyricsCacheSourceKind {
    if (!entry) return "without-plugin";
    if (entry.cacheSource) return entry.cacheSource;
    if (entry.isManualSelection) return "manual";
    if (entry.source === "plugin") return "plugin";
    if (entry.cachedWithoutPlugin) return "without-plugin";
    return entry.source === "lyric-shiori" ? "without-plugin" : "plugin";
}

function getStore(): LyricsCacheStore {
    if (store) return store;
    try {
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
    store = { version: CACHE_VERSION, entries: {}, manualResets: {} };
    return store;
}

function getCacheKey(trackUri: string, kind: LyricsCacheKind) {
    return `${kind}:${trackUri}`;
}

function entriesEqual(first: LyricsCacheEntry, second: LyricsCacheEntry) {
    return (
        first.kind === second.kind &&
        first.trackUri === second.trackUri &&
        getEffectiveCacheSource(first) === getEffectiveCacheSource(second) &&
        first.source === second.source &&
        first.sourceName === second.sourceName &&
        first.offsetMilliseconds === second.offsetMilliseconds &&
        first.timingOffsetApplied === second.timingOffsetApplied &&
        first.hidden === second.hidden &&
        first.manualResetAt === second.manualResetAt &&
        JSON.stringify(first.desktopLyricsColors) === JSON.stringify(second.desktopLyricsColors) &&
        JSON.stringify(first.lines) === JSON.stringify(second.lines)
    );
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
