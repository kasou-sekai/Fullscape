type QueueObject = Record<string, unknown>;

export type QueueEntry = {
    uid: string;
    uri: string;
    title: string;
    artists: string[];
    imageUrl: string;
    isCurrent: boolean;
    hasSpotifyUid: boolean;
};

export type QueueSnapshot = {
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

const getImageUrl = (metadata: QueueObject, track: QueueObject) =>
    getString(metadata, "image_xlarge_url", "image_large_url", "image_url", "imageUrl") ||
    getString(track, "image_xlarge_url", "image_url", "imageUrl");

const createEntry = (value: unknown, index: number): QueueEntry | null => {
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
        imageUrl: getImageUrl(metadata, track),
        isCurrent: false,
        hasSpotifyUid: Boolean(spotifyUid),
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
        const tracks = Array.isArray(queue?.nextTracks) ? queue.nextTracks : [];
        const entries = tracks
            .map((track, index) => createEntry(track, index))
            .filter((entry): entry is QueueEntry => Boolean(entry));

        return {
            next: entries.slice(0, 3),
            later: entries.slice(3),
        };
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
};
