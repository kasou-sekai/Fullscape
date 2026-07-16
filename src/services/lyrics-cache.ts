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
};

type LyricsCacheStore = {
    version: 1;
    entries: Record<string, LyricsCacheEntry>;
};

const STORAGE_KEY = "fullscape:lyrics-cache-v1";
const CACHE_VERSION = 1;
const READY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 40;
const MAX_SERIALIZED_LENGTH = 1_750_000;
const SHARED_REQUEST_TIMEOUT_MS = 800;
const SHARED_BRIDGE_ORIGIN = "http://127.0.0.1:24887";
const SHARED_CACHE_ENDPOINT = `${SHARED_BRIDGE_ORIGIN}/lyrics-cache`;
const SHARED_PRESENCE_ENDPOINT = `${SHARED_BRIDGE_ORIGIN}/bridge-presence`;
const SHARED_PRESENCE_INTERVAL_MS = 5_000;

let store: LyricsCacheStore | null = null;
let sharedSessionToken: string | null = null;
let sharedPresenceTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Announces that the extension runtime itself is alive. This is intentionally
 * independent of lyric loading: a cached song may need no bridge request at all.
 */
export function startSharedBridgePresence() {
    if (sharedPresenceTimer) return;
    const heartbeat = async () => {
        if (!CFM.get("sharedLyricsBridge")) return;
        try {
            await fetchBridge(SHARED_PRESENCE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client: "fullscape", leaseMilliseconds: 8_000 }),
            });
        } catch {
            // LyricShiori may not be running. The next heartbeat retries quietly.
        }
    };
    void heartbeat();
    sharedPresenceTimer = setInterval(() => void heartbeat(), SHARED_PRESENCE_INTERVAL_MS);
}

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
        const response = await fetchBridge(`${SHARED_CACHE_ENDPOINT}?${params.toString()}`);
        if (response.status === 404) return null;
        if (!response.ok) return null;
        const entry = (await response.json()) as LyricsCacheEntry;
        if (!isValidEntry(entry, trackUri, kind)) return null;
        traceLyricsBridge("bridge.received", entry, "GET shared cache");
        if (cacheLocally) cacheSharedEntry(entry);
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
        return false;
    }
    const existing = cache.entries[key];
    if (existing && entriesEqual(existing, entry)) return false;
    cache.entries[key] = entry;
    trimStore(cache);
    persistStore();
    traceLyricsBridge("cache.saved", entry, syncShared ? "will-post" : "local-only");
    if (syncShared) void setSharedCachedLyrics(entry);
    return true;
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
    try {
        const response = await fetchBridge(SHARED_CACHE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
        });
        if (response.ok) {
            traceLyricsBridge("bridge.posted", entry, "POST shared cache");
            return;
        }
    } catch {
        // LyricShiori may not be running; localStorage remains the fallback.
    }
    traceLyricsBridge("bridge.post-failed", entry);
}

export async function setSharedBridgeLease(trackUri: string, active: boolean) {
    if (!CFM.get("sharedLyricsBridge")) return false;
    try {
        const response = await fetchBridge(`${SHARED_BRIDGE_ORIGIN}/bridge-state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackUri, active, leaseMilliseconds: 8_000 }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function fetchBridge(input: RequestInfo | URL, init: RequestInit = {}) {
    const token = await getSharedSessionToken();
    const headers = new Headers(init.headers);
    headers.set("X-LyricShiori-Token", token);
    let response = await fetchSharedWithTimeout(input, {
        ...init,
        headers,
    });
    if (response.status !== 401) return response;
    sharedSessionToken = null;
    headers.set("X-LyricShiori-Token", await getSharedSessionToken());
    response = await fetchSharedWithTimeout(input, {
        ...init,
        headers,
    });
    return response;
}

async function getSharedSessionToken() {
    if (sharedSessionToken) return sharedSessionToken;
    const response = await fetchSharedWithTimeout(`${SHARED_BRIDGE_ORIGIN}/bridge-session`, {
        headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Bridge session HTTP ${response.status}`);
    const payload = (await response.json()) as { token?: string; protocolVersion?: number };
    if (!payload.token || payload.protocolVersion !== 1) throw new Error("Unsupported bridge session");
    sharedSessionToken = payload.token;
    return payload.token;
}

function cacheSharedEntry(entry: LyricsCacheEntry) {
    const cache = getStore();
    const key = getCacheKey(entry.trackUri, entry.kind);
    if (
        getEffectiveCacheSource(cache.entries[key]) === "manual" &&
        getEffectiveCacheSource(entry) !== "manual"
    ) return;
    cache.entries[key] = entry;
    trimStore(cache);
    persistStore();
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
        JSON.stringify(first.desktopLyricsColors) === JSON.stringify(second.desktopLyricsColors) &&
        JSON.stringify(first.lines) === JSON.stringify(second.lines)
    );
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
