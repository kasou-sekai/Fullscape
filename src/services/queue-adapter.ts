type QueueObject = Record<string, unknown>;

export type QueueSource = "manual" | "context" | "recommendation" | "unknown";

export type QueueEntry = {
    uid: string;
    uri: string;
    title: string;
    artists: string[];
    artistUris: string[];
    album: string;
    albumUri: string;
    durationMs: number;
    imageUrl: string;
    source: QueueSource;
    isCurrent: boolean;
    hasSpotifyUid: boolean;
    raw: QueueObject;
};

export type QueueSnapshot = {
    revision: string;
    current: QueueEntry | null;
    next: QueueEntry[];
    later: QueueEntry[];
};

export type QueueMutationResult = {
    ok: boolean;
    reason?: "unavailable" | "unsupported" | "failed";
};

const asObject = (value: unknown): QueueObject =>
    value && typeof value === "object" ? (value as QueueObject) : {};

const getString = (object: QueueObject, ...keys: string[]) => {
    for (const key of keys) {
        const value = object[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
};

const getNumber = (object: QueueObject, ...keys: string[]) => {
    for (const key of keys) {
        const value = object[key];
        const parsed = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 0;
};

const getBoolean = (object: QueueObject, ...keys: string[]) =>
    keys.some((key) => object[key] === true || object[key] === 1 || object[key] === "true");

const getMetadata = (track: QueueObject) =>
    asObject(track.metadata ?? asObject(track.contextTrack).metadata);

const getTrackData = (value: unknown) => {
    const track = asObject(value);
    const contextTrack = asObject(track.contextTrack);
    const metadata = getMetadata(track);
    return {
        track: { ...track, ...contextTrack },
        metadata,
    };
};

const getSource = (track: QueueObject, metadata: QueueObject): QueueSource => {
    const source = [
        getString(track, "queue_source", "queueSource", "queue_origin", "queueOrigin"),
        getString(metadata, "queue_source", "queueSource", "queue_origin", "queueOrigin"),
        getString(track, "reason", "queue_reason", "queueReason", "source"),
        getString(metadata, "reason", "queue_reason", "queueReason", "source"),
    ]
        .join(" ")
        .toLowerCase();

    if (
        source.includes("recommend") ||
        source.includes("smart") ||
        getBoolean(
            track,
            "is_recommendation",
            "isRecommendation",
            "is_smart_shuffle",
            "isSmartShuffle",
        ) ||
        getBoolean(
            metadata,
            "is_recommendation",
            "isRecommendation",
            "is_smart_shuffle",
            "isSmartShuffle",
        )
    ) {
        return "recommendation";
    }
    if (
        source.includes("queue") ||
        source.includes("user") ||
        getBoolean(track, "is_queued", "isQueued") ||
        getBoolean(metadata, "is_queued", "isQueued")
    ) {
        return "manual";
    }

    const contextUri = getString(
        track,
        "context_uri",
        "contextUri",
        "context_uri_string",
        "contextUriString",
    );
    return contextUri || getString(metadata, "context_uri", "contextUri") ? "context" : "unknown";
};

const getArtists = (metadata: QueueObject) => {
    const names = Object.keys(metadata)
        .filter((key) => key.startsWith("artist_name"))
        .sort()
        .map((key) => getString(metadata, key))
        .filter(Boolean);
    if (names.length) return names;
    const artist = getString(metadata, "artist", "artist_name");
    return artist ? [artist] : [];
};

const getArtistUris = (metadata: QueueObject) =>
    Object.keys(metadata)
        .filter((key) => key.startsWith("artist_uri"))
        .sort()
        .map((key) => getString(metadata, key))
        .filter(Boolean);

const getImageUrl = (metadata: QueueObject, track: QueueObject) =>
    getString(metadata, "image_xlarge_url", "image_large_url", "image_url", "imageUrl") ||
    getString(track, "image_xlarge_url", "image_url", "imageUrl");

const createEntry = (value: unknown, index: number, isCurrent = false): QueueEntry | null => {
    const { track, metadata } = getTrackData(value);
    const uri = getString(track, "uri") || getString(metadata, "uri");
    // Internal queue markers (including Spotify's misspelled delimeter) are not media.
    if (!/^spotify:(track|episode|local):.+/.test(uri)) return null;

    const spotifyUid = getString(track, "uid") || getString(metadata, "uid");
    return {
        uid: spotifyUid || `${uri}:${index}`,
        uri,
        title: getString(metadata, "title", "name") || getString(track, "title", "name") || uri,
        artists: getArtists(metadata),
        artistUris: getArtistUris(metadata),
        album: getString(metadata, "album_title", "album", "album_name"),
        albumUri: getString(metadata, "album_uri", "albumUri"),
        durationMs:
            getNumber(metadata, "duration_ms", "durationMs", "duration_milliseconds") ||
            getNumber(asObject(track.duration), "milliseconds", "ms"),
        imageUrl: getImageUrl(metadata, track),
        source: isCurrent ? "context" : getSource(track, metadata),
        isCurrent,
        hasSpotifyUid: Boolean(spotifyUid),
        raw: track,
    };
};

const getApi = () => (Spicetify.Platform?.PlayerAPI ?? null) as QueueObject | null;

const getQueue = () => (Spicetify.Queue ?? null) as QueueObject | null;

const getMutation = (name: string) => {
    const api = getApi();
    const candidate = api?.[name];
    return typeof candidate === "function" ? (candidate as (...args: unknown[]) => unknown) : null;
};

export const QueueAdapter = {
    read(): QueueSnapshot {
        const queue = getQueue();
        const currentValue = Spicetify.Player?.data?.item ?? queue?.track;
        const current = createEntry(currentValue, -1, true);
        const tracks = Array.isArray(queue?.nextTracks) ? queue.nextTracks : [];
        const entries = tracks
            .map((track, index) => createEntry(track, index))
            .filter((entry): entry is QueueEntry => Boolean(entry));
        const revision =
            getString(queue ?? {}, "queueRevision", "queue_revision") ||
            entries.map((entry) => `${entry.uid}:${entry.uri}`).join("|");

        return {
            revision,
            current,
            next: entries.slice(0, 3),
            later: entries.slice(3),
        };
    },

    canRemove(entry: QueueEntry) {
        return Boolean(
            entry.hasSpotifyUid && (getMutation("removeFromQueue") || Spicetify.removeFromQueue),
        );
    },

    async play(entry: QueueEntry): Promise<QueueMutationResult> {
        const api = getApi();
        const skip = getMutation("skipToNext");
        if (!skip) return { ok: false, reason: "unavailable" };
        // Revalidate against the live queue so a stale tile never becomes an arbitrary skip.
        const queue = this.read();
        const matches = [...queue.next, ...queue.later].filter(
            (candidate) =>
                candidate.uri === entry.uri &&
                (!entry.hasSpotifyUid || candidate.uid === entry.uid),
        );
        if (matches.length !== 1) return { ok: false, reason: "unsupported" };
        const target = matches[0];
        try {
            // Same operation and identity used by Spotify's native queue. No playUri fallback:
            // that starts a fresh single-track context and discards the rest of the queue.
            await skip.call(api, {
                uri: target.uri,
                uid: target.hasSpotifyUid ? target.uid : null,
            });
            return { ok: true };
        } catch (error) {
            console.warn("[Fullscape] Unable to play queue entry.", error);
            return { ok: false, reason: "failed" };
        }
    },

    async remove(entry: QueueEntry): Promise<QueueMutationResult> {
        if (!entry.hasSpotifyUid) return { ok: false, reason: "unsupported" };
        const api = getApi();
        const mutation = getMutation("removeFromQueue");
        const fallback = Spicetify.removeFromQueue;
        const remove = mutation ?? (fallback ? fallback.bind(Spicetify) : null);
        if (!remove) return { ok: false, reason: "unavailable" };
        try {
            await remove.call(api, [{ uri: entry.uri, uid: entry.uid }]);
            return { ok: true };
        } catch (error) {
            console.warn("[Fullscape] Unable to remove queue entry.", error);
            return { ok: false, reason: "failed" };
        }
    },

    async clear(): Promise<QueueMutationResult> {
        const api = getApi();
        const clearQueue = getMutation("clearQueue");
        if (!clearQueue) return { ok: false, reason: "unsupported" };
        try {
            await clearQueue.call(api);
            return { ok: true };
        } catch (error) {
            console.warn("[Fullscape] Unable to clear user queue.", error);
            return { ok: false, reason: "failed" };
        }
    },

    /**
     * Spotify's documented PlayerAPI has no reorder operation. Only advertise
     * this capability when the host exposes an explicitly named mutation; the
     * queue is never rebuilt as a fallback because that would destroy context
     * and duplicate-entry identity.
     */
    canReorder() {
        return Boolean(
            getMutation("reorderQueue") ||
                getMutation("moveInQueue") ||
                getMutation("moveQueueItem"),
        );
    },

    async reorder(entry: QueueEntry, targetIndex: number): Promise<QueueMutationResult> {
        const api = getApi();
        const name = ["reorderQueue", "moveInQueue", "moveQueueItem"].find(
            (candidate) => typeof api?.[candidate] === "function",
        );
        if (!name || !api) return { ok: false, reason: "unsupported" };
        try {
            const mutation = api[name] as (...args: unknown[]) => unknown;
            await mutation.call(api, { uid: entry.uid, uri: entry.uri }, targetIndex);
            return { ok: true };
        } catch (error) {
            console.warn("[Fullscape] Unable to reorder queue entry.", error);
            return { ok: false, reason: "failed" };
        }
    },
};
