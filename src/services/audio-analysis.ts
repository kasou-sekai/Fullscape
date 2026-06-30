export type AudioAnalysisInterval = {
    start: number;
    duration: number;
    confidence?: number;
};

type AudioAnalysisSection = AudioAnalysisInterval & {
    loudness?: number;
    tempo?: number;
};

type AudioAnalysisTrack = {
    loudness?: number;
    tempo?: number;
};

export type AudioAnalysis = {
    track: AudioAnalysisTrack;
    sections: AudioAnalysisSection[];
    beats: AudioAnalysisInterval[];
};

export type AudioMotion = {
    ambientSpeedMultiplier: number;
    warpPulse: number;
};

const analysisCache = new Map<string, AudioAnalysis | null>();
const inFlightRequests = new Map<string, Promise<AudioAnalysis | null>>();
const MAX_CACHE_ENTRIES = 20;

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function getErrorStatus(error: unknown) {
    if (!error || typeof error !== "object") return undefined;
    const candidate = error as { code?: unknown; status?: unknown };
    if (typeof candidate.status === "number") return candidate.status;
    if (typeof candidate.code === "number") return candidate.code;
    return undefined;
}

function isAudioAnalysis(value: unknown): value is AudioAnalysis {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<AudioAnalysis>;
    return (
        Boolean(candidate.track) &&
        Array.isArray(candidate.sections) &&
        Array.isArray(candidate.beats)
    );
}

function cacheResult(trackId: string, analysis: AudioAnalysis | null) {
    if (analysisCache.size >= MAX_CACHE_ENTRIES) {
        analysisCache.delete(analysisCache.keys().next().value);
    }
    analysisCache.set(trackId, analysis);
}

export async function getAudioAnalysis(trackUri: string): Promise<AudioAnalysis | null> {
    if (!trackUri.startsWith("spotify:track:")) return null;

    const trackId = trackUri.split(":")[2];
    if (!trackId) return null;

    if (analysisCache.has(trackId)) return analysisCache.get(trackId) ?? null;

    const pending = inFlightRequests.get(trackId);
    if (pending) return pending;

    const request = Spicetify.CosmosAsync.get(
        `https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${encodeURIComponent(trackId)}?format=json`,
    )
        .then((response: unknown) => {
            if (!isAudioAnalysis(response)) return null;
            cacheResult(trackId, response);
            return response;
        })
        .catch((error: unknown) => {
            const status = getErrorStatus(error);
            if (status === 404) {
                cacheResult(trackId, null);
            } else if (status !== 429) {
                console.warn("Unable to load Spotify audio analysis:", error);
            }
            return null;
        })
        .finally(() => {
            inFlightRequests.delete(trackId);
        });

    inFlightRequests.set(trackId, request);
    return request;
}

function findActiveInterval<T extends AudioAnalysisInterval>(
    intervals: T[],
    currentTime: number,
): T | null {
    let low = 0;
    let high = intervals.length - 1;
    let candidate: T | null = null;

    while (low <= high) {
        const middle = (low + high) >> 1;
        const interval = intervals[middle];
        if (interval.start <= currentTime) {
            candidate = interval;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    if (!candidate || currentTime >= candidate.start + candidate.duration) return null;
    return candidate;
}

export function getAudioMotion(analysis: AudioAnalysis, currentTime: number): AudioMotion {
    const section = findActiveInterval(analysis.sections, currentTime);
    const tempo = section?.tempo ?? analysis.track.tempo ?? 120;
    const loudness = section?.loudness ?? analysis.track.loudness ?? -18;
    const tempoFactor = clamp(tempo / 120, 0.65, 1.5);
    const loudnessFactor = 0.8 + clamp((loudness + 40) / 40, 0, 1) * 0.4;

    let beatPulse = 0;
    const beat = findActiveInterval(analysis.beats, currentTime);
    const confidence = beat?.confidence ?? 0;
    if (beat && confidence >= 0.35 && beat.duration > 0) {
        const beatProgress = clamp((currentTime - beat.start) / beat.duration, 0, 1);
        beatPulse = Math.exp(-4.5 * beatProgress) * confidence;
    }

    const ambientSpeedMultiplier = clamp(tempoFactor * loudnessFactor, 0.7, 1.65);
    return {
        ambientSpeedMultiplier,
        warpPulse: beatPulse,
    };
}
