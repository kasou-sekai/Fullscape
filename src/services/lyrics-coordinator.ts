import CFM from "../utils/config";
import {
    fetchBridge,
    supportsRichLyricsBridge,
    getCachedLyricsFullEntry,
    getEffectiveCacheSource,
} from "./lyrics-cache";
import type { LyricsCacheEntry } from "./lyrics-cache";
import type { TrackInfo, EnhancedLyricLine } from "./third-party-lyrics";
import { MATCHER_VERSION } from "./lyrics-matcher-version";
import { validRichLines } from "./lyrics-rich-document";

type Track = TrackInfo & { uri: string };
type Reply = {
    status: string;
    trackUri: string;
    generation: number;
    matcherVersion: string;
    entry?: LyricsCacheEntry;
};
const origin = "http://127.0.0.1:24887/lyrics-v2";
const documents = new Map<string, LyricsCacheEntry>();
let database: Promise<IDBDatabase | null> | null = null;
function db() {
    return (database ??= new Promise((resolve) => {
        if (typeof indexedDB === "undefined") {
            resolve(null);
            return;
        }
        const request = indexedDB.open("fullscape-rich-lyrics-v2", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("documents");
        let settled = false;
        const finish = (value: IDBDatabase | null) => {
            if (settled) {
                value?.close();
                return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve(value);
        };
        const timeout = setTimeout(() => finish(null), 1000);
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null);
        request.onblocked = () => finish(null);
    }));
}
async function remember(entry: LyricsCacheEntry) {
    documents.set(entry.trackUri, entry);
    if (documents.size > 40) documents.delete(documents.keys().next().value);
    const database = await db();
    if (!database) return;
    try {
        const tx = database.transaction("documents", "readwrite");
        const store = tx.objectStore("documents");
        store.put(entry, entry.trackUri);
        // Bounded separate storage; never evict ordinary localStorage entries.
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
            keys.result
                .slice(0, Math.max(0, keys.result.length - 40))
                .forEach((key) => store.delete(key));
        };
    } catch {
        /* Quota errors leave the memory entry and ordinary cache intact. */
    }
}
async function stored(uri: string) {
    if (documents.has(uri)) return documents.get(uri);
    const database = await db();
    if (!database) return null;
    return new Promise<LyricsCacheEntry | null>((resolve) => {
        try {
            const request = database.transaction("documents").objectStore("documents").get(uri);
            request.onsuccess = () => {
                if (request.result) documents.set(uri, request.result);
                resolve(request.result ?? null);
            };
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export class LyricsCoordinator {
    private readonly jobs = new Map<string, Promise<Reply | null>>();
    private current: string | null = null;
    private next: string | null = null;
    private generation = 0;
    private interestRevision = 0;
    private currentRevision = 0;
    private nextRevision = 0;
    private readonly sessionId =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    private release(uri: string | null, role: "current" | "next", generation: number) {
        if (!uri) return;
        void supportsRichLyricsBridge()
            .then((supported) =>
                supported
                    ? fetchBridge(`${origin}/release`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                              clientSessionId: this.sessionId,
                              trackUri: uri,
                              role,
                              generation,
                          }),
                      })
                    : null,
            )
            .catch(() => undefined);
    }
    setCurrent(uri: string) {
        if (this.current !== uri) {
            this.release(this.current, "current", this.currentRevision);
            this.currentRevision = ++this.interestRevision;
        }
        this.current = uri;
        this.generation++;
    }
    setNext(uri: string | null) {
        if (this.next !== uri) {
            this.release(this.next, "next", this.nextRevision);
            this.nextRevision = ++this.interestRevision;
        }
        this.next = uri;
    }
    stop() {
        this.release(this.current, "current", this.currentRevision);
        this.release(this.next, "next", this.nextRevision);
        this.current = null;
        this.next = null;
        this.generation++;
    }
    private interested(uri: string) {
        return this.current === uri || this.next === uri;
    }

    private async request(
        track: Track,
        reference: EnhancedLyricLine[],
        known: boolean,
        activate: boolean,
    ): Promise<Reply | null> {
        const policy = CFM.get("lyricsSource") ?? "auto";
        const response = await fetchBridge(`${origin}/${activate ? "activate" : "prepare"}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                trackUri: track.uri,
                title: track.title,
                artists: track.artists,
                album: track.album,
                duration: track.duration || null,
                reference: reference
                    .filter((line) => line.time !== null)
                    .slice(0, 5)
                    .map((line) => ({ time: line.time, text: line.text })),
                referenceKnown: known,
                relaxed: true,
                matcherVersion: MATCHER_VERSION,
                generation: this.generation,
                sourcePolicy: policy,
                clientSessionId: this.sessionId,
                role: this.current === track.uri ? "current" : "next",
                interestRevision:
                    this.current === track.uri ? this.currentRevision : this.nextRevision,
                knownRevision: documents.get(track.uri)?.documentRevision,
            }),
        });
        if (!response.ok) return null;
        const reply = (await response.json()) as Reply;
        if (reply.trackUri !== track.uri || reply.matcherVersion !== MATCHER_VERSION) return null;
        return reply;
    }

    async prepare(track: Track, baseline: () => Promise<EnhancedLyricLine[]>) {
        if (
            !this.interested(track.uri) ||
            CFM.get("lyricsSource") === "standard" ||
            !(await supportsRichLyricsBridge())
        )
            return null;
        const key = `${track.uri}:${CFM.get("lyricsSource")}:${CFM.get("relaxedLyricsMatching")}`;
        if (this.jobs.has(key)) return this.jobs.get(key);
        const work = (async () => {
            let reply = await this.request(track, [], false, false);
            if (reply?.status !== "reference-required") return reply;
            const reference = await baseline();
            const deadline = Date.now() + 120000;
            let delay = 250;
            do {
                if (!this.interested(track.uri)) return null;
                reply = await this.request(track, reference, true, false);
                if (reply?.status !== "pending" && reply?.status !== "busy") return reply;
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay = Math.min(1000, delay * 2);
            } while (Date.now() < deadline);
            return null;
        })()
            .catch(() => null)
            .finally(() => {
                if (this.jobs.get(key) === work) this.jobs.delete(key);
            });
        this.jobs.set(key, work);
        return work;
    }

    async refresh(track: Track, baseline: () => Promise<EnhancedLyricLine[]>) {
        if (!(await supportsRichLyricsBridge())) return null;
        const generation = this.generation;
        const reply = await this.request(track, await baseline(), true, true);
        if (generation !== this.generation || this.current !== track.uri) return null;
        if (reply?.entry) {
            if (
                reply.entry.trackUri !== track.uri ||
                reply.entry.sourceFamily !== "apple-music" ||
                reply.entry.validatedMatcherVersion !== MATCHER_VERSION ||
                !validRichLines(reply.entry.lines)
            )
                return null;
            await remember(reply.entry);
        }
        return reply;
    }

    async activate(
        track: Track,
        baseline: () => Promise<EnhancedLyricLine[]>,
        onLate: (entry: LyricsCacheEntry) => void,
    ) {
        if (CFM.get("lyricsSource") === "standard" || !CFM.get("sharedLyricsBridge")) return null;
        const cachedDocument = await stored(track.uri).catch(() => null);
        if (this.current !== track.uri) return null;
        const generation = this.generation;
        const policy = CFM.get("lyricsSource");
        const valid = () =>
            this.current === track.uri &&
            this.generation === generation &&
            CFM.get("lyricsSource") === policy;
        const offlineCached = () => {
            const ordinary = (["spotify", "enhanced", "enhanced-relaxed"] as const).map((kind) =>
                getCachedLyricsFullEntry(track.uri, kind),
            );
            const pinnedOrdinary = ordinary.some(
                (entry) => getEffectiveCacheSource(entry) === "manual",
            );
            return valid() &&
                !ordinary.some((entry) => entry?.hidden) &&
                cachedDocument?.trackUri === track.uri &&
                cachedDocument?.sourceFamily === "apple-music" &&
                (policy === "apple-music" || !pinnedOrdinary) &&
                cachedDocument?.expiresAt > Date.now() &&
                cachedDocument.validatedMatcherVersion === MATCHER_VERSION &&
                validRichLines(cachedDocument.lines)
                ? cachedDocument
                : null;
        };
        const work = (async () => {
            const prepared = await this.prepare(track, baseline);
            if (prepared === null) return offlineCached();
            if (prepared?.status !== "ready" || !valid()) return null;
            // A fresh activation rechecks manual selection/offset after prefetch.
            const reply = await this.request(track, await baseline(), true, true);
            const entry = reply?.status === "unchanged" ? documents.get(track.uri) : reply?.entry;
            if (
                !valid() ||
                !["ready", "unchanged"].includes(reply?.status) ||
                !entry ||
                entry.trackUri !== track.uri ||
                entry.sourceFamily !== "apple-music" ||
                entry.validatedMatcherVersion !== MATCHER_VERSION ||
                !validRichLines(entry.lines)
            )
                return null;
            await remember(entry);
            return entry;
        })().catch(() => offlineCached());
        let initial = true;
        void work.then((entry) => {
            if (!initial && entry && valid()) onLate(entry);
        });
        const result = await Promise.race([
            work,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        initial = false;
        return result;
    }
}
