import CFM from "../utils/config";
import { fetchWithTimeout } from "../utils/async";
import { traceLyricsBridge } from "./lyrics-bridge-trace";
import type { LyricsCacheEntry, LyricsCacheKind, LyricsCacheMetadata } from "./lyrics-cache";

const SHARED_REQUEST_TIMEOUT_MS = 2_000;
export const LYRICS_BRIDGE_ORIGIN = "http://127.0.0.1:24887";
const SHARED_CACHE_ENDPOINT = `${LYRICS_BRIDGE_ORIGIN}/lyrics-cache`;
const SHARED_PRESENCE_ENDPOINT = `${LYRICS_BRIDGE_ORIGIN}/bridge-presence`;
const SHARED_PRESENCE_INTERVAL_MS = 5_000;
const SHARED_LEASE_MS = 8_000;

let sharedSessionToken: string | null = null;
let richBridgeSupported = false;
let sharedSessionRequest: Promise<string> | null = null;
let sharedPresenceTimer: ReturnType<typeof setInterval> | null = null;
const bridgeStateUpdates = new Map<string, Promise<boolean>>();

/** Announces that the extension runtime itself is alive, even without lyric requests. */
export function startSharedBridgePresence() {
    if (sharedPresenceTimer) return;
    const heartbeat = async () => {
        if (!CFM.get("sharedLyricsBridge")) return;
        try {
            await fetchBridge(SHARED_PRESENCE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client: "fullscape", leaseMilliseconds: SHARED_LEASE_MS }),
            });
        } catch {
            // LyricShiori may not be running. The next heartbeat retries quietly.
        }
    };
    void heartbeat();
    sharedPresenceTimer = setInterval(() => void heartbeat(), SHARED_PRESENCE_INTERVAL_MS);
}

export async function getSharedCachedLyrics(
    trackUri: string,
    kind: LyricsCacheKind,
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
        return entry;
    } catch {
        return null;
    }
}

export function syncCachedLyricsToShared(entry: LyricsCacheEntry) {
    void setSharedCachedLyrics(entry);
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

function isValidEntry(entry: LyricsCacheEntry, trackUri: string, kind: LyricsCacheKind) {
    return (
        entry?.trackUri === trackUri &&
        entry.kind === kind &&
        Array.isArray(entry.lines) &&
        Number(entry.expiresAt) > Date.now()
    );
}

export async function setSharedBridgeLease(trackUri: string, active: boolean) {
    if (!CFM.get("sharedLyricsBridge")) return false;
    const previous = bridgeStateUpdates.get(trackUri) ?? Promise.resolve(true);
    const update = previous
        .catch(() => false)
        .then(async () => {
            try {
                const response = await fetchBridge(`${LYRICS_BRIDGE_ORIGIN}/bridge-state`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ trackUri, active, leaseMilliseconds: SHARED_LEASE_MS }),
                });
                return response.ok;
            } catch {
                return false;
            }
        });
    bridgeStateUpdates.set(trackUri, update);
    try {
        return await update;
    } finally {
        if (bridgeStateUpdates.get(trackUri) === update) {
            bridgeStateUpdates.delete(trackUri);
        }
    }
}

export async function fetchBridge(input: RequestInfo | URL, init: RequestInit = {}) {
    const token = await getSharedSessionToken();
    const headers = new Headers(init.headers);
    headers.set("X-LyricShiori-Token", token);
    let response = await fetchWithTimeout(input, { ...init, headers }, SHARED_REQUEST_TIMEOUT_MS);
    if (response.status !== 401) return response;
    sharedSessionToken = null;
    headers.set("X-LyricShiori-Token", await getSharedSessionToken());
    response = await fetchWithTimeout(input, { ...init, headers }, SHARED_REQUEST_TIMEOUT_MS);
    return response;
}

async function getSharedSessionToken() {
    if (sharedSessionToken) return sharedSessionToken;
    if (sharedSessionRequest) return sharedSessionRequest;
    const pending = fetchSharedSessionToken().finally(() => {
        if (sharedSessionRequest === pending) sharedSessionRequest = null;
    });
    sharedSessionRequest = pending;
    return pending;
}

async function fetchSharedSessionToken() {
    const response = await fetchWithTimeout(
        `${LYRICS_BRIDGE_ORIGIN}/bridge-session`,
        { headers: { Accept: "application/json" } },
        SHARED_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`Bridge session HTTP ${response.status}`);
    const payload = (await response.json()) as {
        token?: string;
        protocolVersion?: number;
        capabilities?: string[];
    };
    if (!payload.token || payload.protocolVersion !== 1)
        throw new Error("Unsupported bridge session");
    richBridgeSupported =
        Array.isArray(payload.capabilities) && payload.capabilities.includes("apple-music-v2");
    sharedSessionToken = payload.token;
    return payload.token;
}

export async function supportsRichLyricsBridge() {
    if (!CFM.get("sharedLyricsBridge")) return false;
    try {
        await getSharedSessionToken();
        return richBridgeSupported;
    } catch {
        return false;
    }
}
