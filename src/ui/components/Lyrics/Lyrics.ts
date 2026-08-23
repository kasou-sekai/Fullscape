import { DOM } from "../../elements";
import CFM from "../../../utils/config";
import {
    enhanceWithThirdPartyLyrics,
    getThirdPartyLyricsDebug,
    publishThirdPartyLyricsDebug,
} from "../../../services/third-party-lyrics";
import type {
    EnhancedLyricLine,
    ThirdPartyLyricsDebug,
    TrackInfo,
} from "../../../services/third-party-lyrics";
import {
    consumeSharedManualReset,
    deleteCachedLyrics,
    getCachedLyricsDebug,
    getCachedLyricsFullEntry,
    getEffectiveCacheSource,
    getSharedCachedLyrics,
    setSharedBridgeLease,
    setCachedLyrics,
    syncCachedLyricsToShared,
} from "../../../services/lyrics-cache";
import type { LyricsCacheEntry, LyricsCacheKind } from "../../../services/lyrics-cache";
import { mergeFuriganaAnnotations, parseFuriganaMarkup } from "../../../utils/furigana";
import { fetchDictionaryFurigana } from "../../../services/dictionary-furigana";
import { preloadOfflineFuriganaDictionary } from "../../../services/offline-furigana-dictionary";
import type { FuriganaAnnotation, FuriganaRenderData } from "../../../utils/furigana";
import {
    convertChineseText,
    convertFuriganaRenderData,
    getChineseLyricsPresentation,
} from "../../../utils/chinese-conversion";
import type { LyricsChineseConversion } from "../../../utils/chinese-conversion";

type LyricLine = EnhancedLyricLine;
type LyricsTrack = TrackInfo & {
    uri: string;
};
type TimedLyricLine = {
    index: number;
    time: number;
};
type KaraokeWordRenderState = {
    node: HTMLElement;
    time: number;
    effectiveEnd: number;
    effectiveDuration: number;
    peakGlow: number;
    releaseDuration: number;
    animation: Animation | null;
    visualState: number;
};
type KaraokeFuriganaRenderState = {
    node: HTMLElement;
    time: number;
    duration: number;
    releaseDuration: number;
    animation: Animation | null;
};
type TimedKaraokeSegment = {
    text: string;
    time: number;
    duration: number;
    start: number;
};
type LyricsDiagnostics = {
    total: number;
    timed: number;
    translations: number;
    romanizations: number;
    karaoke: number;
};
type BridgeLease = {
    count: number;
    generation: number;
    timer: ReturnType<typeof setInterval>;
    ready: Promise<boolean>;
};

export class Lyrics {
    private static readonly REQUEST_TIMEOUT_MS = 10000;
    private static readonly RETRY_DELAYS_MS = [0];
    private static readonly REFETCH_DELAYS_MS = [15000, 45000, 120000];
    private static readonly SHARED_SYNC_POLL_MS = 1000;
    private static readonly SHARED_SYNC_MAX_POLL_MS = 5000;
    private static readonly LINE_RENDER_OVERSCAN = 0.5;
    private static readonly QQ_MUSIC_RENDER_ADVANCE_MS = 200;
    private static readonly CACHE_KINDS: LyricsCacheKind[] = [
        "enhanced",
        "enhanced-relaxed",
        "spotify",
    ];
    private static readonly spotifyRequests = new Map<string, Promise<LyricLine[]>>();
    private static readonly enhancedRequests = new Map<string, Promise<LyricLine[]>>();
    private static readonly prefetchedTrackUris = new Set<string>();
    private static container: HTMLElement | null = null;
    private static lyricsRoot: HTMLElement | null = null;
    private static lineNodes: HTMLElement[] = [];
    private static timedLines: TimedLyricLine[] = [];
    private static karaokeWordsByLine: KaraokeWordRenderState[][] = [];
    private static karaokeFuriganaByLine: KaraokeFuriganaRenderState[][] = [];
    private static lineHeights: number[] = [];
    private static containerHeight = 0;
    private static lines: LyricLine[] = [];
    private static dictionaryFurigana: Array<FuriganaRenderData | null> = [];
    private static activeIndex = -1;
    private static lineContentNodes: (HTMLElement | null)[] = [];
    private static updateTimer: ReturnType<typeof setTimeout> | null = null;
    private static updateFrame: number | null = null;
    private static playbackClockProgress: number | null = null;
    private static lastRawPlaybackProgress: number | null = null;
    private static playbackClockDrift = 0;
    private static karaokeAnimationLine = -1;
    private static karaokeAnimationsPlaying = false;
    private static karaokePropertiesRegistered = false;
    private static lastKaraokeProgress: number | null = null;
    private static lastKaraokeClockTime = 0;
    private static resizeObserver: ResizeObserver | null = null;
    private static lastMeasuredFontSize = 0;
    private static isSynced = false;
    private static lastStatus: "synced" | "unsynced" | "unavailable" | "loading" = "unavailable";
    private static diagnostics: LyricsDiagnostics = {
        total: 0,
        timed: 0,
        translations: 0,
        romanizations: 0,
        karaoke: 0,
    };
    private static loadSequence = 0;
    private static currentTrackUri: string | null = null;
    private static refetchAttempt = 0;
    private static refetchTimer: ReturnType<typeof setTimeout> | null = null;
    private static sharedSyncTimer: ReturnType<typeof setTimeout> | null = null;
    private static sharedSyncInFlight = false;
    private static sharedSyncMissCount = 0;
    private static lastSharedSyncSignature: string | null = null;
    private static renderedLyricsSignature: string | null = null;
    private static dictionaryFuriganaRequestSignature: string | null = null;
    private static readonly dictionaryFuriganaRequests = new Map<
        string,
        Promise<FuriganaRenderData[]>
    >();
    private static authoritativeRevision = 0;
    private static bridgeLeaseGeneration = 0;
    private static lyricsInteractionTimer: ReturnType<typeof setTimeout> | null = null;
    private static lyricsInteractionActive = false;
    private static lyricsPointerInside = false;
    private static hoveredLine: HTMLElement | null = null;
    private static manualScrollActive = false;
    private static manualScrollTargetPosition = -1;
    private static manualScrollRenderPosition = -1;
    private static manualScrollFrame: number | null = null;
    private static lineRightSpaces: number[] = [];
    private static readonly bridgeLeases = new Map<string, BridgeLease>();

    static attach(container: HTMLElement) {
        this.container = container;
        void preloadOfflineFuriganaDictionary();
    }

    static teardown() {
        this.stopLoop();
        this.cancelKaraokeAnimations();
        this.resetLyricsInteraction(false);
        this.lines = [];
        this.dictionaryFurigana = [];
        this.lineNodes = [];
        this.lineContentNodes = [];
        this.timedLines = [];
        this.karaokeWordsByLine = [];
        this.karaokeFuriganaByLine = [];
        this.lineHeights = [];
        this.lineRightSpaces = [];
        this.containerHeight = 0;
        this.activeIndex = -1;
        this.stopResizeObserver();
        this.lastMeasuredFontSize = 0;
        this.lyricsRoot = null;
        this.container = null;
        this.isSynced = false;
        this.lastStatus = "unavailable";
        this.resetDiagnostics();
        this.currentTrackUri = null;
        this.clearRefetch();
        this.stopSharedCacheSync();
        this.stopAllBridgeLeases();
        this.renderedLyricsSignature = null;
        this.dictionaryFuriganaRequestSignature = null;
        this.prefetchedTrackUris.clear();
        this.spotifyRequests.clear();
        this.enhancedRequests.clear();
        this.dictionaryFuriganaRequests.clear();
        this.authoritativeRevision += 1;
        this.loadSequence += 1;
    }

    static toggleLyrics() {
        DOM.container.classList.toggle("lyrics-hide-force");
    }

    static async refreshCurrentLyrics() {
        const trackUri = Spicetify.Player.data?.item?.uri;
        if (!trackUri) return false;
        if (this.getRefreshBlockedReason()) return false;
        await this.loadLyrics(trackUri, "all");
        return this.lastStatus === "synced" || this.lastStatus === "unsynced";
    }

    static refreshRenderedFurigana() {
        if (!this.container || !this.lines.length) return;
        this.dictionaryFurigana = [];
        this.dictionaryFuriganaRequestSignature = null;
        this.renderLines();
    }

    static getRefreshBlockedReason() {
        const trackUri = Spicetify.Player.data?.item?.uri;
        if (!trackUri) return null;
        const kinds: LyricsCacheKind[] = ["spotify", "enhanced", "enhanced-relaxed"];
        return kinds.some(
            (kind) =>
                getEffectiveCacheSource(getCachedLyricsFullEntry(trackUri, kind)) === "manual",
        )
            ? "manual-selection"
            : null;
    }

    static async loadLyrics(trackUri?: string, force: "none" | "enhanced" | "all" = "none") {
        if (trackUri !== this.currentTrackUri) {
            this.clearRefetch();
            this.refetchAttempt = 0;
            this.currentTrackUri = trackUri ?? null;
            this.lastSharedSyncSignature = null;
        }
        const sequence = ++this.loadSequence;
        if (!CFM.get("lyricsDisplay") || !trackUri) {
            this.stopSharedCacheSync();
            this.renderStatus("Lyrics unavailable", true);
            return;
        }
        const bypassAutomaticSharedCache = force !== "none";
        if (bypassAutomaticSharedCache) this.stopSharedCacheSync();
        else this.startSharedCacheSync();
        if (force !== "none") {
            deleteCachedLyrics(
                trackUri,
                force === "enhanced" ? this.getEnhancedCacheKind() : undefined,
            );
        }
        const track = this.getCurrentTrack(trackUri);
        const cachedLines = this.getPreparedLyricsFromCache(track);
        if (cachedLines !== null) {
            if (cachedLines.length) this.applyLines(cachedLines);
            else {
                this.renderStatus("Lyrics unavailable", true);
                this.scheduleRefetch(trackUri, "all");
            }
            if (
                cachedLines.length &&
                CFM.get("thirdPartyLyrics") &&
                this.shouldRetryThirdParty(getThirdPartyLyricsDebug())
            ) {
                this.scheduleRefetch(trackUri, "enhanced");
            }
            return;
        }
        this.lastStatus = "loading";
        this.renderStatus("Loading lyrics…", false);
        const releaseLease = await this.beginBridgeLease(trackUri);
        try {
            // One bounded bridge read before external requests avoids issuing
            // Spotify/provider requests when Shiori already has a selection.
            const shared = await this.bestSharedPreferredEntry(track);
            if (!this.isCurrentLoad(sequence)) return;
            const shouldUseShared =
                shared &&
                (!bypassAutomaticSharedCache || getEffectiveCacheSource(shared) === "manual");
            if (shouldUseShared) {
                this.rememberSharedSignature(trackUri, shared);
                this.applySharedLyricsEntry(trackUri, shared);
                return;
            }
            const lines = await this.getPreparedLyrics(track, true, bypassAutomaticSharedCache);
            if (!this.isCurrentLoad(sequence)) return;
            if (!lines.length) {
                this.renderStatus("Lyrics unavailable", true);
                this.scheduleRefetch(trackUri, "all");
                return;
            }
            this.applyLines(lines);
            if (
                CFM.get("thirdPartyLyrics") &&
                this.shouldRetryThirdParty(getThirdPartyLyricsDebug())
            ) {
                this.scheduleRefetch(trackUri, "enhanced");
            } else {
                this.clearRefetch();
                this.refetchAttempt = 0;
            }
        } catch {
            if (!this.isCurrentLoad(sequence)) return;
            this.renderStatus("Lyrics unavailable", true);
            this.scheduleRefetch(trackUri, "all");
        } finally {
            releaseLease();
            if (bypassAutomaticSharedCache && this.isCurrentTrack(trackUri)) {
                this.startSharedCacheSync();
            }
        }
    }

    static prefetchNextLyrics() {
        if (!CFM.get("lyricsDisplay")) return;
        if (Spicetify.Player.getRepeat() === 2) return;

        const nextTrack = this.getNextTrack();
        const currentUri = Spicetify.Player.data?.item?.uri;
        if (!nextTrack || nextTrack.uri === currentUri) return;
        if (this.prefetchedTrackUris.has(nextTrack.uri)) return;
        // An already-prepared extension entry needs no bridge round trip.
        if (this.getPreparedLyricsFromCache(nextTrack) !== null) return;
        this.prefetchedTrackUris.add(nextTrack.uri);
        void this.prefetchNextLyricsFromBestSource(nextTrack).catch((err) => {
            this.prefetchedTrackUris.delete(nextTrack.uri);
            console.debug("Unable to prefetch next track lyrics", err);
        });
    }

    static syncPlaybackProgress() {
        if (!this.isSynced || !this.container) return;
        this.updateActive(this.getSynchronizedPlaybackProgress());
    }

    private static async prefetchNextLyricsFromBestSource(track: LyricsTrack) {
        // Prefetching happens while the current track is still playing, so it
        // can wait briefly for LyricShiori before issuing external requests.
        // This avoids fetching Spotify/third-party lyrics when Shiori already
        // has a manual or plugin-quality entry for the upcoming track.
        const shared = await this.bestSharedPreferredEntry(track);
        if (shared) {
            setCachedLyrics(
                track.uri,
                shared.kind,
                shared.lines,
                shared.debug,
                false,
                this.cacheEntryMetadata(shared),
            );
            return;
        }
        await this.getPreparedLyrics(track, false);
    }

    // ---- internal helpers ----

    private static getPreparedLyricsFromCache(track: LyricsTrack) {
        const kind: LyricsCacheKind = CFM.get("thirdPartyLyrics")
            ? this.getEnhancedCacheKind()
            : "spotify";
        const cached = getCachedLyricsFullEntry(track.uri, kind);
        return cached && this.isPreferredCacheEntry(cached) ? this.linesForEntry(cached) : null;
    }

    private static async getPreparedLyrics(
        track: LyricsTrack,
        publishDebug: boolean,
        waitForEnhancement = false,
    ) {
        const authorityRevision = this.authoritativeRevision;
        const thirdPartyEnabled = Boolean(CFM.get("thirdPartyLyrics"));
        const relaxedMatching = Boolean(CFM.get("relaxedLyricsMatching"));
        const kind: LyricsCacheKind = thirdPartyEnabled ? this.getEnhancedCacheKind() : "spotify";
        let automaticFallback: LyricsCacheEntry | null = null;
        if (kind !== "spotify") {
            const cached = getCachedLyricsFullEntry(track.uri, kind);
            const selected = this.selectBestCachedLyrics(null, cached, false);
            if (selected !== null && this.isPreferredCacheEntry(selected.entry)) {
                if (publishDebug) {
                    this.publishCachedDebug(track.uri);
                }
                return this.linesForEntry(selected.entry);
            }
            automaticFallback = this.selectBestCachedLyrics(null, cached, true)?.entry ?? null;
        }
        const cached = getCachedLyricsFullEntry(track.uri, kind);
        if (cached !== null && this.isPreferredCacheEntry(cached)) {
            if (publishDebug && kind !== "spotify") this.publishCachedDebug(track.uri);
            return this.linesForEntry(cached);
        }
        const spotifyLines = await this.getSpotifyLyrics(track);
        if (
            this.authoritativeRevision !== authorityRevision &&
            (this.currentTrackUri === null || this.isCurrentTrack(track.uri))
        )
            return [];
        if (
            !thirdPartyEnabled ||
            !track.title ||
            !track.duration ||
            (!track.artists && !track.album)
        ) {
            return spotifyLines;
        }

        const enhancedCached = getCachedLyricsFullEntry(track.uri, kind);
        if (enhancedCached !== null && this.isPreferredCacheEntry(enhancedCached)) {
            if (publishDebug) this.publishCachedDebug(track.uri);
            return this.linesForEntry(enhancedCached);
        }
        const requestKey = `${kind}:${track.uri}`;
        const pending = this.enhancedRequests.get(requestKey);
        if (pending) {
            if (spotifyLines.length && !waitForEnhancement) return spotifyLines;
            const lines = await pending;
            if (publishDebug) this.publishCachedDebug(track.uri);
            return lines;
        }

        let debugSnapshot: ThirdPartyLyricsDebug | undefined;
        const releaseLease = await this.beginBridgeLease(track.uri);
        const request = enhanceWithThirdPartyLyrics(
            spotifyLines,
            track,
            relaxedMatching,
            publishDebug,
            (debug) => {
                debugSnapshot = debug;
            },
        )
            .then((lines) => {
                const sourceName = this.thirdPartySourceName(debugSnapshot);
                const resolvedLines =
                    lines.length || !automaticFallback
                        ? this.applySourceTimingCorrection(lines, sourceName)
                        : this.linesForEntry(automaticFallback);
                const canPublish =
                    !this.isCurrentTrack(track.uri) ||
                    this.authoritativeRevision === authorityRevision;
                if (canPublish && !this.shouldRetryThirdParty(debugSnapshot)) {
                    setCachedLyrics(track.uri, kind, lines, debugSnapshot, true, {
                        source: "plugin",
                        cacheSource: "plugin",
                        sourceName,
                        isManualSelection: false,
                        cachedWithoutPlugin: false,
                        metadata: this.cacheMetadataForTrack(track),
                        offsetMilliseconds: 0,
                        timingOffsetApplied: false,
                    });
                }
                // Third-party enrichment can take several seconds. Keep the base Spotify
                // lyrics visible, then replace them in place once richer data is ready.
                if (
                    this.isCurrentTrack(track.uri) &&
                    canPublish &&
                    resolvedLines.length &&
                    (!this.lines.length ||
                        this.compareLyricsQuality(resolvedLines, this.lines) >= 0)
                ) {
                    this.applyLines(resolvedLines);
                }
                return resolvedLines;
            })
            .finally(() => {
                if (this.enhancedRequests.get(requestKey) === request) {
                    this.enhancedRequests.delete(requestKey);
                }
                releaseLease();
            });
        this.enhancedRequests.set(requestKey, request);
        return spotifyLines.length && !waitForEnhancement ? spotifyLines : request;
    }

    private static publishCachedDebug(trackUri: string) {
        const debug = getCachedLyricsDebug(trackUri, this.getEnhancedCacheKind());
        if (debug) publishThirdPartyLyricsDebug(debug, true);
    }

    private static thirdPartySourceName(debug?: ThirdPartyLyricsDebug) {
        if (debug?.matchedSong?.startsWith("网易云")) return "NetEase";
        if (debug?.matchedSong?.startsWith("QQ 音乐")) return "QQMusic";
        return "Spotify";
    }

    private static async bestSharedPreferredEntry(track: LyricsTrack) {
        // LyricShiori converts its current local selection to the requested
        // kind, so one request is sufficient for both replacement and offset
        // updates. Querying every cache kind would triple synchronous LRCS I/O.
        const kind = CFM.get("thirdPartyLyrics") ? this.getEnhancedCacheKind() : "spotify";
        const entry = await getSharedCachedLyrics(
            track.uri,
            kind,
            false,
            this.cacheMetadataForTrack(track),
        );
        if (entry && consumeSharedManualReset(entry)) {
            if (this.isCurrentTrack(track.uri)) {
                this.authoritativeRevision += 1;
                this.loadSequence += 1;
                this.renderStatus("Loading lyrics…", false);
                void this.loadLyrics(track.uri, "none");
            }
            return null;
        }
        return entry && this.isPreferredCacheEntry(entry) ? entry : null;
    }

    private static isPreferredCacheEntry(entry: LyricsCacheEntry) {
        const source = getEffectiveCacheSource(entry);
        if (source === "manual") return true;
        if (source !== "plugin") return false;
        if (entry.kind === "spotify") return true;

        // LyricShiori can expose the Spotify base entry under the requested
        // enhanced cache kind. It is a useful fallback, but it must not be
        // treated as completed enrichment or the provider request is skipped.
        const sourceName = entry.sourceName?.trim().toLowerCase();
        return entry.debug?.status === "matched" || Boolean(sourceName && sourceName !== "spotify");
    }

    private static selectBestCachedLyrics(
        shared: LyricsCacheEntry | null,
        cached: LyricsCacheEntry | null,
        allowAutomatic: boolean,
    ) {
        const candidates = [
            shared ? { source: "shared" as const, entry: shared } : null,
            cached ? { source: "cached" as const, entry: cached } : null,
        ].filter(Boolean) as Array<{ source: "shared" | "cached"; entry: LyricsCacheEntry }>;
        const manual = candidates.filter(
            (candidate) => getEffectiveCacheSource(candidate.entry) === "manual",
        );
        if (manual.length) return this.bestEntry(manual);
        const plugin = candidates.filter(
            (candidate) => getEffectiveCacheSource(candidate.entry) === "plugin",
        );
        if (plugin.length) return this.bestEntry(plugin);
        if (!allowAutomatic) return null;
        return this.bestEntry(candidates);
    }

    private static bestEntry(
        candidates: Array<{ source: "shared" | "cached"; entry: LyricsCacheEntry }>,
    ) {
        return (
            candidates.sort((first, second) => {
                const sourcePriority =
                    this.cacheSourcePriority(first.entry) - this.cacheSourcePriority(second.entry);
                if (sourcePriority !== 0) return sourcePriority;
                const quality = this.compareLyricsQuality(second.entry.lines, first.entry.lines);
                if (quality !== 0) return quality;
                const kindPriority =
                    this.cacheKindPriority(first.entry.kind) -
                    this.cacheKindPriority(second.entry.kind);
                if (kindPriority !== 0) return kindPriority;
                return (second.entry.cachedAt ?? 0) - (first.entry.cachedAt ?? 0);
            })[0] ?? null
        );
    }

    private static cacheSourcePriority(entry: LyricsCacheEntry) {
        switch (getEffectiveCacheSource(entry)) {
            case "manual":
                return 0;
            case "plugin":
                return 1;
            case "without-plugin":
                return 2;
        }
    }

    private static cacheKindPriority(kind: LyricsCacheKind) {
        const preferred = CFM.get("thirdPartyLyrics") ? this.getEnhancedCacheKind() : "spotify";
        return [
            preferred,
            ...this.CACHE_KINDS.filter((candidate) => candidate !== preferred),
        ].indexOf(kind);
    }

    private static linesForEntry(entry: LyricsCacheEntry): LyricLine[] {
        const configuredOffset = Number(entry.offsetMilliseconds ?? 0);
        const manualOffset =
            !entry.timingOffsetApplied && Number.isFinite(configuredOffset) ? configuredOffset : 0;
        const providerOffset = this.sourceTimingCorrection(entry.sourceName);
        return this.applyTimingOffset(entry.lines, manualOffset + providerOffset);
    }

    private static applySourceTimingCorrection(lines: LyricLine[], sourceName?: string) {
        return this.applyTimingOffset(lines, this.sourceTimingCorrection(sourceName));
    }

    private static sourceTimingCorrection(sourceName?: string) {
        return sourceName?.trim().toLowerCase() === "qqmusic" ? this.QQ_MUSIC_RENDER_ADVANCE_MS : 0;
    }

    private static applyTimingOffset(lines: LyricLine[], offset: number) {
        if (!Number.isFinite(offset) || offset === 0) return lines;
        return lines.map((line) => ({
            ...line,
            time: typeof line.time === "number" ? Math.max(0, line.time - offset) : line.time,
            words: line.words?.map((word) => ({
                ...word,
                time: Math.max(0, word.time - offset),
            })),
        }));
    }

    private static cacheEntryMetadata(entry: LyricsCacheEntry) {
        return {
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
        };
    }

    private static startSharedCacheSync() {
        if (!CFM.get("sharedLyricsBridge") || this.sharedSyncTimer) return;
        const poll = () => {
            this.sharedSyncTimer = null;
            void this.syncSharedCacheForCurrentTrack().finally(() => {
                if (!CFM.get("sharedLyricsBridge") || !this.currentTrackUri) return;
                const delay = Math.min(
                    this.SHARED_SYNC_POLL_MS * 2 ** this.sharedSyncMissCount,
                    this.SHARED_SYNC_MAX_POLL_MS,
                );
                this.sharedSyncTimer = setTimeout(poll, delay);
            });
        };
        this.sharedSyncTimer = setTimeout(poll, 0);
    }

    private static stopSharedCacheSync() {
        if (this.sharedSyncTimer) {
            clearTimeout(this.sharedSyncTimer);
            this.sharedSyncTimer = null;
        }
        this.sharedSyncInFlight = false;
        this.sharedSyncMissCount = 0;
        this.lastSharedSyncSignature = null;
    }

    private static async syncSharedCacheForCurrentTrack() {
        if (
            this.sharedSyncInFlight ||
            !CFM.get("lyricsDisplay") ||
            !CFM.get("sharedLyricsBridge")
        ) {
            return;
        }
        const trackUri = this.currentTrackUri;
        if (!trackUri || !this.isCurrentTrack(trackUri)) return;
        this.sharedSyncInFlight = true;
        try {
            const track = this.getCurrentTrack(trackUri);
            const entry = await this.bestSharedPreferredEntry(track);
            if (!this.isCurrentTrack(trackUri)) return;
            const signature = entry ? this.cacheEntrySignature(entry) : null;
            if (!signature) {
                // Only publish local state after the bridge read has had a
                // chance to deliver a Shiori reset tombstone. This both keeps
                // warm plugin caches available to a newly started Shiori and
                // prevents stale manual entries from racing a reset.
                const kind = CFM.get("thirdPartyLyrics") ? this.getEnhancedCacheKind() : "spotify";
                const local = getCachedLyricsFullEntry(trackUri, kind);
                if (local && this.isPreferredCacheEntry(local)) {
                    syncCachedLyricsToShared(local);
                }
                this.sharedSyncMissCount = Math.min(this.sharedSyncMissCount + 1, 3);
                this.lastSharedSyncSignature = null;
                return;
            }
            if (signature === this.lastSharedSyncSignature) {
                this.sharedSyncMissCount = Math.min(this.sharedSyncMissCount + 1, 3);
                return;
            }
            this.sharedSyncMissCount = 0;
            this.lastSharedSyncSignature = signature;
            this.applySharedLyricsEntry(trackUri, entry);
        } finally {
            this.sharedSyncInFlight = false;
        }
    }

    private static cacheEntrySignature(entry: LyricsCacheEntry) {
        const colors = entry.desktopLyricsColors;
        const colorSignature = colors
            ? [
                  colors.preset ?? "",
                  colors.unplayedColor,
                  colors.playedColor,
                  colors.outlineColor,
              ].join(",")
            : "";
        return [
            entry.kind,
            getEffectiveCacheSource(entry),
            entry.source ?? "",
            entry.sourceName ?? "",
            entry.cachedAt,
            entry.expiresAt,
            entry.offsetMilliseconds ?? 0,
            entry.timingOffsetApplied === true ? "applied" : "pending",
            entry.hidden === true ? "hidden" : "visible",
            entry.manualResetAt ?? 0,
            colorSignature,
            this.linesSignature(this.linesForEntry(entry)),
        ].join("|");
    }

    private static rememberSharedSignature(trackUri: string, entry: LyricsCacheEntry) {
        if (this.currentTrackUri === trackUri) {
            this.lastSharedSyncSignature = this.cacheEntrySignature(entry);
        }
    }

    private static applySharedLyricsEntry(trackUri: string, entry: LyricsCacheEntry) {
        if (!this.isCurrentTrack(trackUri)) return;
        const lines = this.linesForEntry(entry);
        if (entry.hidden === true) {
            // A Shiori hide action is always authoritative and must cancel any
            // in-flight fetch that could otherwise make lyrics visible again.
            this.authoritativeRevision += 1;
            this.loadSequence += 1;
            setCachedLyrics(
                trackUri,
                entry.kind,
                entry.lines,
                entry.debug,
                false,
                this.cacheEntryMetadata(entry),
            );
            this.renderStatus("Lyrics unavailable", true);
            this.clearRefetch();
            this.refetchAttempt = 0;
            return;
        }
        if (!lines.length || !this.shouldApplySharedLyricsEntry(entry, lines)) return;
        if (getEffectiveCacheSource(entry) === "manual") {
            // Only an explicit manual choice may invalidate an in-flight local
            // enrichment request. Automatic bridge entries can render in the
            // meantime, but the richer provider result must still be allowed
            // to replace them when it arrives.
            this.authoritativeRevision += 1;
            this.loadSequence += 1;
        }
        setCachedLyrics(
            trackUri,
            entry.kind,
            entry.lines,
            entry.debug,
            false,
            this.cacheEntryMetadata(entry),
        );
        if (entry.debug) publishThirdPartyLyricsDebug(entry.debug, true);
        this.applyLines(lines);
        this.clearRefetch();
        this.refetchAttempt = 0;
    }

    private static shouldApplySharedLyricsEntry(entry: LyricsCacheEntry, lines: LyricLine[]) {
        // A manual Shiori selection (including an offset adjustment) always
        // wins. Plugin entries, however, can briefly lag behind the local
        // third-party enrichment pipeline; do not let that stale base version
        // downgrade the currently rendered rich lyrics.
        if (getEffectiveCacheSource(entry) === "manual" || !this.lines.length) return true;
        return this.compareLyricsQuality(lines, this.lines) >= 0;
    }

    private static lineSignature(line: LyricLine) {
        return [
            line.time ?? "",
            line.duration ?? "",
            line.text,
            line.translation ?? "",
            line.romanization ?? "",
            line.furigana ?? "",
            ...(line.words ?? []).map((word) => [word.time, word.duration, word.text].join(",")),
        ].join("\u001f");
    }

    private static linesSignature(lines: LyricLine[]) {
        return [lines.length, ...lines.map((line) => this.lineSignature(line))].join("|");
    }

    private static cacheMetadataForTrack(track: LyricsTrack) {
        return {
            title: track.title,
            artist: track.artists,
            album: track.album,
            duration: track.duration,
            translationLanguages: [],
        };
    }

    private static compareLyricsQuality(first: LyricLine[], second: LyricLine[]) {
        const left = this.lyricsQualityScore(first);
        const right = this.lyricsQualityScore(second);
        for (let i = 0; i < left.length; i += 1) {
            if (left[i] !== right[i]) return left[i] - right[i];
        }
        return 0;
    }

    private static lyricsQualityScore(lines: LyricLine[]) {
        const meaningful = lines.filter((line) => line.text.trim()).length;
        const timed = lines.filter((line) => line.time !== null).length;
        const karaoke = lines.filter((line) => this.hasKaraokeText(line)).length;
        const furigana = lines.filter((line) => Boolean(line.furigana?.trim())).length;
        const translation = lines.filter((line) => Boolean(line.translation?.trim())).length;
        const romanization = lines.filter((line) => Boolean(line.romanization?.trim())).length;
        return [
            Number(karaoke > 0),
            Number(furigana > 0),
            Number(translation > 0),
            karaoke,
            furigana,
            translation,
            romanization,
            timed,
            meaningful,
        ];
    }

    private static getEnhancedCacheKind(): LyricsCacheKind {
        return CFM.get("relaxedLyricsMatching") ? "enhanced-relaxed" : "enhanced";
    }

    private static hasKaraokeText(line: LyricLine) {
        return Boolean(line.words?.some((word) => word.text.trim()));
    }

    private static shouldRetryThirdParty(debug?: ThirdPartyLyricsDebug) {
        return debug?.status === "error" && !debug.matchedSong;
    }

    private static async getSpotifyLyrics(track: LyricsTrack) {
        const cached = getCachedLyricsFullEntry(track.uri, "spotify");
        if (cached !== null && this.isPreferredCacheEntry(cached))
            return this.linesForEntry(cached);
        const automaticFallback = cached;
        const pending = this.spotifyRequests.get(track.uri);
        if (pending) return pending;

        const trackId = track.uri.split(":").pop();
        if (!trackId) return [];
        const releaseLease = await this.beginBridgeLease(track.uri);
        const requestStartedAt = Date.now();
        const request = this.getLyricsWithRetry(trackId)
            .then((response) => this.normalizeLines(response?.lyrics?.lines))
            .catch(() => [])
            .then((lines) => {
                const authoritative = getCachedLyricsFullEntry(track.uri, "spotify");
                if (
                    authoritative &&
                    this.isPreferredCacheEntry(authoritative) &&
                    authoritative.cachedAt > requestStartedAt
                ) {
                    return this.linesForEntry(authoritative);
                }
                setCachedLyrics(track.uri, "spotify", lines, undefined, true, {
                    source: "plugin",
                    cacheSource: "plugin",
                    sourceName: "Spotify",
                    isManualSelection: false,
                    cachedWithoutPlugin: false,
                    metadata: this.cacheMetadataForTrack(track),
                    offsetMilliseconds: 0,
                    timingOffsetApplied: false,
                });
                return lines.length || !automaticFallback
                    ? lines
                    : this.linesForEntry(automaticFallback);
            })
            .finally(() => {
                if (this.spotifyRequests.get(track.uri) === request) {
                    this.spotifyRequests.delete(track.uri);
                }
                releaseLease();
            });
        this.spotifyRequests.set(track.uri, request);
        return request;
    }

    private static async getLyricsWithRetry(trackId: string) {
        const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&market=from_token`;
        let lastError: unknown;

        for (let attempt = 0; attempt < this.RETRY_DELAYS_MS.length; attempt++) {
            const delay = this.RETRY_DELAYS_MS[attempt];
            if (delay) await this.sleep(delay);

            try {
                return await this.withTimeout(
                    Spicetify.CosmosAsync.get(url),
                    this.REQUEST_TIMEOUT_MS,
                );
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError;
    }

    private static getCurrentTrack(uri: string): LyricsTrack {
        const metadata = (Spicetify.Player.data?.item?.metadata ?? {}) as Partial<
            Record<string, string>
        >;
        return this.createTrack(
            uri,
            metadata,
            Spicetify.Player.data?.duration ?? Number(metadata.duration ?? 0),
        );
    }

    private static getNextTrack(): LyricsTrack | null {
        const queued = Spicetify.Queue?.nextTracks?.[0];
        if (!queued) return null;
        const contextTrack = queued.contextTrack ?? queued;
        const metadata = contextTrack.metadata ?? queued.metadata ?? {};
        const uri =
            contextTrack.uri ??
            contextTrack.link ??
            queued.uri ??
            metadata.uri ??
            metadata.track_uri;
        if (!uri || typeof uri !== "string") return null;
        const duration = Number(contextTrack.duration ?? queued.duration ?? metadata.duration ?? 0);
        return this.createTrack(uri, metadata, duration);
    }

    private static createTrack(
        uri: string,
        metadata: Partial<Record<string, unknown>>,
        duration: number,
    ): LyricsTrack {
        const title = `${metadata.title ?? ""}`.trim();
        const artists = Object.keys(metadata)
            .filter((key) => key.startsWith("artist_name"))
            .sort()
            .map((key) => metadata[key])
            .filter(Boolean)
            .join(", ");
        const album = `${metadata.album_title ?? metadata.album_name ?? ""}`.trim();
        return {
            uri,
            title,
            artists,
            album,
            duration: Number.isFinite(duration) ? duration : 0,
        };
    }

    private static withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(
                () => reject(new Error("Lyrics request timed out")),
                timeoutMs,
            );
            promise.then(
                (value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                },
            );
        });
    }

    private static sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private static scheduleRefetch(trackUri: string, force: "enhanced" | "all") {
        if (this.refetchTimer || this.refetchAttempt >= this.REFETCH_DELAYS_MS.length) return;
        const delay = this.REFETCH_DELAYS_MS[this.refetchAttempt++];
        this.refetchTimer = setTimeout(() => {
            this.refetchTimer = null;
            if (
                this.currentTrackUri !== trackUri ||
                Spicetify.Player.data?.item?.uri !== trackUri
            ) {
                return;
            }
            void this.loadLyrics(trackUri, force);
        }, delay);
    }

    private static clearRefetch() {
        if (this.refetchTimer) {
            clearTimeout(this.refetchTimer);
            this.refetchTimer = null;
        }
    }

    private static async beginBridgeLease(trackUri: string) {
        if (!CFM.get("sharedLyricsBridge")) return () => {};
        let state = this.bridgeLeases.get(trackUri);
        if (state) {
            state.count += 1;
        } else {
            const generation = ++this.bridgeLeaseGeneration;
            const ready = setSharedBridgeLease(trackUri, true);
            const timer = setInterval(() => {
                if (this.bridgeLeases.get(trackUri)?.generation !== generation) return;
                void setSharedBridgeLease(trackUri, true);
            }, 5_000);
            state = { count: 1, generation, timer, ready };
            this.bridgeLeases.set(trackUri, state);
        }
        await state.ready;
        const generation = state.generation;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const current = this.bridgeLeases.get(trackUri);
            if (!current || current.generation !== generation) return;
            current.count = Math.max(current.count - 1, 0);
            if (current.count > 0) return;
            this.bridgeLeases.delete(trackUri);
            clearInterval(current.timer);
            void setSharedBridgeLease(trackUri, false);
        };
    }

    private static stopAllBridgeLeases() {
        for (const [trackUri, state] of this.bridgeLeases) {
            clearInterval(state.timer);
            this.bridgeLeases.delete(trackUri);
            void setSharedBridgeLease(trackUri, false);
        }
    }

    private static isCurrentLoad(sequence: number) {
        return sequence === this.loadSequence;
    }

    private static isCurrentTrack(trackUri: string) {
        return this.currentTrackUri === trackUri && Spicetify.Player.data?.item?.uri === trackUri;
    }

    private static renderStatus(text: string, unavailable: boolean) {
        if (!this.container) return;
        this.stopResizeObserver();
        this.cancelKaraokeAnimations();
        this.resetLyricsInteraction(false);
        this.lines = [];
        this.dictionaryFurigana = [];
        this.lineNodes = [];
        this.lineContentNodes = [];
        this.timedLines = [];
        this.karaokeWordsByLine = [];
        this.karaokeFuriganaByLine = [];
        this.lineHeights = [];
        this.lineRightSpaces = [];
        this.containerHeight = 0;
        this.activeIndex = -1;
        this.lastMeasuredFontSize = 0;
        this.lyricsRoot = null;
        this.renderedLyricsSignature = null;
        this.dictionaryFuriganaRequestSignature = null;
        this.isSynced = false;
        this.lastStatus = unavailable ? "unavailable" : "loading";
        this.resetDiagnostics();
        if (unavailable) DOM.container.classList.add("lyrics-unavailable");
        else DOM.container.classList.remove("lyrics-unavailable");
        this.stopLoop();
        this.container.innerHTML = `<div class="lyrics-wrapper"><div class="lyrics-status">${this.escapeHtml(text)}</div></div>`;
    }

    private static applyLines(lines: LyricLine[]) {
        const signature = this.linesSignature(lines);
        if (signature === this.renderedLyricsSignature && this.lyricsRoot?.isConnected) {
            return;
        }
        const timingShift = this.uniformTimingShift(this.lines, lines);
        const timeValues = lines.map((line) => line.time).filter((t): t is number => t !== null);
        const lastTime = timeValues.length ? timeValues[timeValues.length - 1] : null;
        const hasNonZero = timeValues.some((t) => t > 0);
        const wasSynced = this.isSynced;
        const nextIsSynced = Boolean(timeValues.length && hasNonZero && (lastTime ?? 0) > 0);
        const canUpdateTimingInPlace =
            wasSynced &&
            nextIsSynced &&
            timingShift !== null &&
            this.lyricsRoot?.isConnected &&
            this.lineNodes.length === lines.length;
        this.stopLoop();
        this.isSynced = nextIsSynced;
        this.lines = lines;
        this.dictionaryFurigana = [];
        this.renderedLyricsSignature = signature;
        this.dictionaryFuriganaRequestSignature = null;
        this.timedLines = lines.flatMap((line, index) =>
            line.time === null ? [] : [{ index, time: line.time }],
        );
        this.lastStatus = this.isSynced ? "synced" : "unsynced";
        this.diagnostics = {
            total: lines.length,
            timed: timeValues.length,
            translations: lines.filter((line) => Boolean(line.translation)).length,
            romanizations: lines.filter((line) => Boolean(line.romanization)).length,
            karaoke: lines.filter((line) => this.hasKaraokeText(line)).length,
        };
        DOM.container.classList.remove("lyrics-unavailable");
        this.container?.classList.toggle("lyrics-unsynced", !this.isSynced);
        if (canUpdateTimingInPlace) {
            this.updateTimingInPlace(lines, timingShift);
            this.startLoop();
            return;
        }
        this.activeIndex = this.isSynced ? -1 : 0;
        this.renderLines();
        if (this.isSynced) this.startLoop();
    }

    private static uniformTimingShift(previous: LyricLine[], next: LyricLine[]) {
        if (previous.length !== next.length || !previous.length) return null;
        let shift: number | null = null;
        const compareTime = (before: number | null, after: number | null) => {
            if (before === null || after === null) return before === after;
            const difference = after - before;
            if (shift === null) shift = difference;
            return Math.abs(difference - shift) < 0.5;
        };
        for (let index = 0; index < previous.length; index += 1) {
            const before = previous[index];
            const after = next[index];
            if (
                before.text !== after.text ||
                before.translation !== after.translation ||
                before.romanization !== after.romanization ||
                before.furigana !== after.furigana ||
                before.duration !== after.duration ||
                !compareTime(before.time, after.time)
            ) {
                return null;
            }
            const beforeWords = before.words ?? [];
            const afterWords = after.words ?? [];
            if (beforeWords.length !== afterWords.length) return null;
            for (let wordIndex = 0; wordIndex < beforeWords.length; wordIndex += 1) {
                const beforeWord = beforeWords[wordIndex];
                const afterWord = afterWords[wordIndex];
                if (
                    beforeWord.text !== afterWord.text ||
                    beforeWord.duration !== afterWord.duration ||
                    !compareTime(beforeWord.time, afterWord.time)
                ) {
                    return null;
                }
            }
        }
        return shift;
    }

    private static updateTimingInPlace(lines: LyricLine[], shift: number) {
        this.cancelKaraokeAnimations();
        this.lineNodes.forEach((node, index) => {
            node.dataset.time = `${lines[index].time ?? ""}`;
        });
        this.lineNodes.forEach((lineNode) => {
            lineNode.querySelectorAll<HTMLElement>(".rnp-karaoke-word").forEach((wordNode) => {
                const previousTime = Number(wordNode.dataset.time);
                if (Number.isFinite(previousTime)) {
                    wordNode.dataset.time = `${previousTime + shift}`;
                }
                wordNode.classList.remove("active", "finished", "glowing");
                wordNode.style.removeProperty("--karaoke-progress");
                wordNode.style.removeProperty("--karaoke-lift");
                wordNode.style.removeProperty("--karaoke-scale");
                wordNode.style.removeProperty("--karaoke-glow");
            });
        });
        this.buildKaraokeWordCache();
    }

    private static renderLines() {
        if (!this.container) return;
        this.resetLyricsInteraction(false);
        this.cancelKaraokeAnimations();
        // Keep karaoke nodes mounted so line changes only update compositor-friendly styles.
        // Replacing nearby line content during playback forces synchronous layout and stalls
        // the background animation as well.
        const chineseConversion = this.getChineseConversion();
        const originalLyricsText = this.lines.map((line) => line.text).join("\n");
        const chinesePresentation = getChineseLyricsPresentation(
            originalLyricsText,
            chineseConversion,
        );
        const chineseScript = chinesePresentation.displayScript;
        const scriptClass = chineseScript ? ` rnp-lyrics-script-${chineseScript}` : "";
        const language =
            chineseScript === "simplified"
                ? ' lang="zh-CN"'
                : chineseScript === "traditional"
                  ? ' lang="zh-TW"'
                  : "";
        const body = this.lines
            .map(
                (line, idx) =>
                    `<div class="rnp-lyrics-line${line.time !== null ? " rnp-lyrics-line-seekable" : ""}" data-index="${idx}" data-time="${line.time ?? ""}">
                        <div class="rnp-lyrics-line-content">
                            ${this.renderLineContent(line, idx, chinesePresentation.conversion)}
                        </div>
                    </div>`,
            )
            .join("");
        this.container.innerHTML = `
            <div class="lyrics-wrapper">
                <div class="rnp-lyrics${scriptClass}"${language}>
                    ${body}
                </div>
            </div>`;
        this.lyricsRoot = this.container.querySelector(".rnp-lyrics") as HTMLElement;
        this.lineNodes = Array.from(
            this.container.querySelectorAll<HTMLElement>(".rnp-lyrics-line"),
        );
        this.lineContentNodes = this.lineNodes.map((node) =>
            node.querySelector<HTMLElement>(".rnp-lyrics-line-content"),
        );
        this.requestDictionaryFurigana(originalLyricsText);
        this.buildKaraokeWordCache();
        this.setupLyricsInteraction();
        if (!this.isSynced) {
            this.stopLoop();
            this.lineNodes.forEach((node, idx) => node.classList.toggle("active", idx === 0));
            return;
        }
        this.stabilizeLineWrapping();
        this.measureHeights();
        this.applyTransforms(true);
        this.setupResizeObserver();
    }

    private static renderLineContent(
        line: LyricLine,
        lineIndex: number,
        chineseConversion: LyricsChineseConversion,
    ) {
        const showKaraoke = Boolean(CFM.get("karaokeLyrics")) && this.hasKaraokeText(line);
        const words = (line.words ?? []).map((word) => ({
            ...word,
            text: convertChineseText(word.text, chineseConversion),
        }));
        const providedFurigana = parseFuriganaMarkup(line.text, line.furigana);
        const dictionaryFurigana = this.dictionaryFurigana[lineIndex];
        const renderFurigana = dictionaryFurigana
            ? {
                  text: providedFurigana.text,
                  annotations: mergeFuriganaAnnotations(
                      providedFurigana.annotations,
                      dictionaryFurigana.annotations,
                  ),
              }
            : providedFurigana;
        const furigana = convertFuriganaRenderData(renderFurigana, chineseConversion);
        const visibleAnnotations = CFM.get("showLyricsFurigana") ? furigana.annotations : [];
        const karaokeText = words.map((word) => word.text).join("");
        const annotations = karaokeText === furigana.text ? visibleAnnotations : [];
        const furiganaClass = annotations.length ? " rnp-lyrics-has-furigana" : "";
        const original = showKaraoke
            ? `<div class="rnp-lyrics-line-karaoke${furiganaClass}">${this.renderKaraokeLine(words, annotations)}</div>`
            : `<div class="rnp-lyrics-line-original${visibleAnnotations.length ? " rnp-lyrics-has-furigana" : ""}">${this.formatLyricText(furigana.text, visibleAnnotations)}</div>`;

        const romanization =
            CFM.get("showLyricsRomanization") && line.romanization
                ? `<div class="rnp-lyrics-line-romaji">${this.escapeHtml(convertChineseText(line.romanization, chineseConversion))}</div>`
                : "";
        const translation =
            CFM.get("showLyricsTranslation") && line.translation && line.translation.trim() !== "//"
                ? `<div class="rnp-lyrics-line-translated">${this.escapeHtml(convertChineseText(line.translation, chineseConversion))}</div>`
                : "";

        return `${original}${romanization}${translation}`;
    }

    private static requestDictionaryFurigana(originalLyricsText: string) {
        if (!CFM.get("showLyricsFurigana")) return;

        const allowOnline = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(originalLyricsText);
        const hasProvidedFurigana = this.lines.some(
            (line) => parseFuriganaMarkup(line.text, line.furigana).annotations.length,
        );
        // Pure Han text cannot be distinguished reliably from Chinese here. If another
        // provider already supplied a reading, it is safe to fill its gaps offline only.
        if (!allowOnline && !hasProvidedFurigana) return;

        const missingLines = this.lines
            .map((line, index) => ({
                index,
                text: line.text,
                parsed: parseFuriganaMarkup(line.text, line.furigana),
            }))
            .filter((line) => this.hasUnannotatedKanji(line.text, line.parsed.annotations));
        if (
            !missingLines.length ||
            this.dictionaryFuriganaRequestSignature === this.renderedLyricsSignature
        ) {
            return;
        }

        const signature = this.renderedLyricsSignature;
        this.dictionaryFuriganaRequestSignature = signature;
        const requestKey = `${Number(allowOnline)}\u001f${missingLines
            .map((line) => line.text)
            .join("\u001e")}`;
        let request = this.dictionaryFuriganaRequests.get(requestKey);
        const applyResults = (results: FuriganaRenderData[]) => {
            if (
                signature !== this.renderedLyricsSignature ||
                this.linesSignature(this.lines) !== signature ||
                !this.lyricsRoot?.isConnected
            ) {
                return;
            }
            const nextFurigana = this.lines.map<FuriganaRenderData | null>(() => null);
            missingLines.forEach((line, index) => {
                nextFurigana[line.index] = results[index] ?? null;
            });
            const changed = nextFurigana.some(
                (line, index) =>
                    !this.sameFuriganaRenderData(line, this.dictionaryFurigana[index] ?? null),
            );
            if (!changed) return;
            this.dictionaryFurigana = nextFurigana;
            if (this.dictionaryFurigana.some((line) => line?.annotations.length)) {
                this.renderLines();
            }
        };
        if (!request) {
            request = fetchDictionaryFurigana(
                missingLines.map((line) => line.text),
                { allowOnline, onOfflineResults: applyResults },
            );
            this.dictionaryFuriganaRequests.set(requestKey, request);
            void request.then(
                () => {
                    if (this.dictionaryFuriganaRequests.get(requestKey) === request) {
                        this.dictionaryFuriganaRequests.delete(requestKey);
                    }
                },
                () => {
                    if (this.dictionaryFuriganaRequests.get(requestKey) === request) {
                        this.dictionaryFuriganaRequests.delete(requestKey);
                    }
                },
            );
        }
        void request.then(applyResults).catch(() => undefined);
    }

    private static sameFuriganaRenderData(
        first: FuriganaRenderData | null,
        second: FuriganaRenderData | null,
    ) {
        if (first === second) return true;
        if (!first || !second || first.text !== second.text) return false;
        return (
            first.annotations.length === second.annotations.length &&
            first.annotations.every((annotation, index) => {
                const candidate = second.annotations[index];
                if (!candidate) return false;
                return (
                    annotation.start === candidate.start &&
                    annotation.end === candidate.end &&
                    annotation.reading === candidate.reading
                );
            })
        );
    }

    private static hasUnannotatedKanji(text: string, annotations: FuriganaAnnotation[]) {
        let offset = 0;
        for (const character of Array.from(text)) {
            if (
                /[\p{Script=Han}々〆ヶ]/u.test(character) &&
                !annotations.some(
                    (annotation) => annotation.start <= offset && offset < annotation.end,
                )
            ) {
                return true;
            }
            offset += character.length;
        }
        return false;
    }

    private static getChineseConversion(): LyricsChineseConversion {
        return CFM.get("lyricsChineseConversion") as LyricsChineseConversion;
    }

    private static renderKaraokeLine(
        words: NonNullable<LyricLine["words"]>,
        annotations: FuriganaAnnotation[],
    ) {
        const text = words.map((word) => word.text).join("");
        const wordStarts = this.getSemanticWordStarts(text);
        annotations.forEach((annotation) => {
            for (const offset of wordStarts) {
                if (offset > annotation.start && offset < annotation.end) {
                    wordStarts.delete(offset);
                }
            }
        });
        const splitOffsets = new Set([
            ...wordStarts,
            ...annotations.flatMap((annotation) => [annotation.start, annotation.end]),
        ]);
        const segments = this.splitKaraokeSegmentsAtOffsets(
            words.flatMap((word) => this.splitTimedKaraokeWord(word)),
            splitOffsets,
        );
        const phraseGroups: string[] = [];
        let phrase = "";
        let semanticWord = "";
        let activeAnnotation: FuriganaAnnotation | null = null;
        let annotationStartTime = 0;
        let annotationEndTime = 0;

        const flushSemanticWord = () => {
            if (!semanticWord) return;
            phrase += `<span class="rnp-lyrics-semantic-word">${semanticWord}</span>`;
            semanticWord = "";
        };
        segments.forEach((segment) => {
            if (this.hasPreferredBreakAtStart(segment.text) && (semanticWord || phrase)) {
                flushSemanticWord();
                phraseGroups.push(phrase);
                phrase = "";
            }
            if (wordStarts.has(segment.start)) flushSemanticWord();
            const annotation = annotations.find((item) => item.start === segment.start);
            if (annotation) {
                activeAnnotation = annotation;
                annotationStartTime = segment.time;
                annotationEndTime = segment.time + segment.duration;
                semanticWord +=
                    '<ruby class="rnp-furigana-ruby rnp-karaoke-ruby"><span class="rnp-furigana-base">';
            }
            if (activeAnnotation) {
                annotationEndTime = Math.max(annotationEndTime, segment.time + segment.duration);
            }
            semanticWord += this.renderKaraokeWordSegment(
                segment.text,
                segment.time,
                segment.duration,
            );
            const segmentEnd = segment.start + segment.text.length;
            if (activeAnnotation && segmentEnd >= activeAnnotation.end) {
                semanticWord += `</span><rt data-time="${annotationStartTime}" data-duration="${Math.max(
                    80,
                    annotationEndTime - annotationStartTime,
                )}">${this.escapeHtml(activeAnnotation.reading)}</rt></ruby>`;
                activeAnnotation = null;
            }
            if (!this.hasPreferredBreakAtEnd(segment.text)) return;
            flushSemanticWord();
            phraseGroups.push(phrase);
            phrase = "";
        });
        flushSemanticWord();
        if (phrase) phraseGroups.push(phrase);
        return phraseGroups
            .map(
                (content) =>
                    `<span class="rnp-lyrics-break-segment rnp-karaoke-break-segment">${content}</span>`,
            )
            .join("<wbr>");
    }

    private static splitTimedKaraokeWord(word: NonNullable<LyricLine["words"]>[number]) {
        const segments = this.splitLyricTextAtPreferredBreaks(word.text);
        const weights = segments.map((segment) => this.getTextTimingWeight(segment));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
        let offset = 0;
        return segments.map((text, idx) => {
            const remaining = Math.max(0, word.duration - offset);
            const duration =
                idx === segments.length - 1
                    ? remaining
                    : (word.duration * weights[idx]) / totalWeight;
            const segment = {
                text,
                time: word.time + offset,
                duration,
            };
            offset += duration;
            return segment;
        });
    }

    private static getSemanticWordStarts(text: string) {
        const starts = new Set<number>();
        if (!("Segmenter" in Intl)) return starts;
        try {
            const segmenter = new Intl.Segmenter(this.getSegmentationLocale(text), {
                granularity: "word",
            });
            let foundFirstWord = false;
            for (const segment of segmenter.segment(text)) {
                if (!segment.isWordLike) continue;
                const followsOpeningQuote = /[“‘「『《〈«‹][\p{White_Space}\u200b\ufeff]*$/u.test(
                    text.slice(0, segment.index),
                );
                if (foundFirstWord && !followsOpeningQuote) starts.add(segment.index);
                foundFirstWord = true;
            }
        } catch {
            // Keep the punctuation-based wrapping fallback on older Chromium builds.
        }
        return starts;
    }

    private static getSegmentationLocale(text: string) {
        if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
        if (/\p{Script=Hangul}/u.test(text)) return "ko";
        if (/\p{Script=Thai}/u.test(text)) return "th";
        if (/\p{Script=Han}/u.test(text)) return "zh";
        return undefined;
    }

    private static splitKaraokeSegmentsAtOffsets(
        segments: Array<Omit<TimedKaraokeSegment, "start">>,
        splitOffsets: Set<number>,
    ) {
        const result: TimedKaraokeSegment[] = [];
        let globalOffset = 0;

        segments.forEach((segment) => {
            const segmentStart = globalOffset;
            const segmentEnd = segmentStart + segment.text.length;
            const localOffsets = Array.from(splitOffsets)
                .filter((offset) => offset > segmentStart && offset < segmentEnd)
                .map((offset) => offset - segmentStart)
                .sort((first, second) => first - second);
            const boundaries = [0, ...localOffsets, segment.text.length];
            const texts = boundaries
                .slice(0, -1)
                .map((start, index) => segment.text.slice(start, boundaries[index + 1]))
                .filter(Boolean);
            const weights = texts.map((text) => this.getTextTimingWeight(text));
            const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
            let timeOffset = 0;
            let textOffset = 0;

            texts.forEach((text, index) => {
                const remaining = Math.max(0, segment.duration - timeOffset);
                const duration =
                    index === texts.length - 1
                        ? remaining
                        : (segment.duration * weights[index]) / totalWeight;
                result.push({
                    text,
                    time: segment.time + timeOffset,
                    duration,
                    start: segmentStart + textOffset,
                });
                timeOffset += duration;
                textOffset += text.length;
            });
            globalOffset = segmentEnd;
        });
        return result;
    }

    private static hasPreferredBreakAtEnd(text: string) {
        return /(?:[\p{White_Space}\u200b\ufeff]|[,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉])$/u.test(
            text,
        );
    }

    private static hasPreferredBreakAtStart(text: string) {
        return /^[“‘「『《〈«‹]/u.test(text);
    }

    private static renderKaraokeWordSegment(text: string, time: number, duration: number) {
        return `<span class="rnp-karaoke-word" data-time="${time}" data-duration="${duration}"><span>${this.formatLyricText(text)}</span></span>`;
    }

    private static splitLyricTextAtPreferredBreaks(text: string) {
        const trailingBreakSegments = text
            .match(
                /.*?(?:[\p{White_Space}\u200b\ufeff]+|[,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉]+|$)/gu,
            )
            ?.filter(Boolean) ?? [text];
        return trailingBreakSegments.flatMap((segment) =>
            segment.split(/(?=[“‘「『《〈«‹])/u).filter(Boolean),
        );
    }

    private static getTextTimingWeight(text: string) {
        return Math.max(
            1,
            Array.from(text).filter((char) => !/^[\p{White_Space}\u200b\ufeff]+$/u.test(char))
                .length,
        );
    }

    private static escapeHtml(text: string) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private static formatLyricText(text: string, annotations: FuriganaAnnotation[] = []) {
        return this.formatPlainLyricText(text, annotations);
    }

    private static formatPlainLyricText(text: string, annotations: FuriganaAnnotation[] = []) {
        const wordStarts = this.getSemanticWordStarts(text);
        annotations.forEach((annotation) => {
            for (const offset of wordStarts) {
                if (offset > annotation.start && offset < annotation.end) {
                    wordStarts.delete(offset);
                }
            }
        });
        let globalOffset = 0;
        return this.splitLyricTextAtPreferredBreaks(text)
            .map((segment) => {
                const segmentStart = globalOffset;
                const segmentEnd = segmentStart + segment.length;
                const localStarts = Array.from(wordStarts)
                    .filter((offset) => offset > segmentStart && offset < segmentEnd)
                    .map((offset) => offset - segmentStart)
                    .sort((first, second) => first - second);
                const annotationBoundaries = annotations
                    .flatMap((annotation) => [annotation.start, annotation.end])
                    .filter((offset) => offset > segmentStart && offset < segmentEnd)
                    .map((offset) => offset - segmentStart);
                const boundaries = Array.from(
                    new Set([0, ...localStarts, ...annotationBoundaries, segment.length]),
                ).sort((first, second) => first - second);
                const semanticWords = boundaries
                    .slice(0, -1)
                    .map((start, index) => {
                        const end = boundaries[index + 1];
                        const word = segment.slice(start, end);
                        if (!word) return "";
                        const absoluteStart = segmentStart + start;
                        const absoluteEnd = segmentStart + end;
                        const annotation = annotations.find(
                            (item) => item.start === absoluteStart && item.end === absoluteEnd,
                        );
                        const content = annotation
                            ? `<ruby class="rnp-furigana-ruby"><span class="rnp-furigana-base">${this.escapeHtml(word)}</span><rt>${this.escapeHtml(annotation.reading)}</rt></ruby>`
                            : this.escapeHtml(word);
                        return `<span class="rnp-lyrics-semantic-word">${content}</span>`;
                    })
                    .join("");
                globalOffset = segmentEnd;
                return `<span class="rnp-lyrics-break-segment">${semanticWords}</span>`;
            })
            .join("<wbr>");
    }

    private static startLoop() {
        this.stopLoop();
        const tick = () => {
            if (!this.container || !this.isSynced) return;
            const progress = this.getSynchronizedPlaybackProgress();
            this.updateActive(progress);
            if (Spicetify.Player.isPlaying()) {
                this.updateFrame = requestAnimationFrame(tick);
            } else {
                this.updateTimer = setTimeout(tick, 250);
            }
        };
        tick();
    }

    private static stopLoop() {
        if (this.updateTimer) clearTimeout(this.updateTimer);
        if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame);
        this.updateTimer = null;
        this.updateFrame = null;
        this.resetPlaybackClock();
    }

    private static resetPlaybackClock() {
        this.playbackClockProgress = null;
        this.lastRawPlaybackProgress = null;
        this.playbackClockDrift = 0;
    }

    private static getSynchronizedPlaybackProgress() {
        const rawProgress = Number(Spicetify.Player?.getProgress?.() ?? 0);
        if (!Number.isFinite(rawProgress)) return this.playbackClockProgress ?? 0;
        this.lastRawPlaybackProgress = rawProgress;
        this.playbackClockProgress = rawProgress;
        this.playbackClockDrift = 0;
        return rawProgress;
    }

    private static updateActive(progress: number) {
        if (!this.isSynced) return;
        if (!this.container || !this.lines.length) return;
        const nextIndex = this.findActiveLineIndex(progress);

        if (nextIndex === this.activeIndex) {
            this.updateKaraokeProgress(progress);
            return;
        }

        const previousIndex = this.activeIndex;
        this.activeIndex = nextIndex;
        if (previousIndex !== nextIndex) this.resetKaraokeLine(previousIndex);
        if (this.manualScrollActive) {
            this.lineNodes.forEach((node, index) =>
                node.classList.toggle("active", index === this.activeIndex),
            );
        } else {
            this.applyTransforms();
        }
        this.updateKaraokeProgress(progress);
    }

    private static updateKaraokeProgress(progress: number) {
        if (this.activeIndex < 0 || !CFM.get("karaokeLyrics")) return;
        const words = this.karaokeWordsByLine[this.activeIndex];
        if (!words?.length) return;
        const isPlaying = Boolean(Spicetify.Player.isPlaying());
        const now = performance.now();
        const elapsed = this.lastKaraokeClockTime ? now - this.lastKaraokeClockTime : 0;
        const progressDelta =
            this.lastKaraokeProgress === null ? 0 : progress - this.lastKaraokeProgress;
        const expectedDelta = this.karaokeAnimationsPlaying ? elapsed : 0;
        const playbackJumped =
            this.lastKaraokeProgress !== null && Math.abs(progressDelta - expectedDelta) > 120;
        if (this.karaokeAnimationLine !== this.activeIndex) {
            this.scheduleKaraokeLine(progress, isPlaying);
        } else {
            this.syncKaraokeAnimationClock(progress, isPlaying, playbackJumped);
        }
        this.updateKaraokeWordClasses(words, progress);
        this.lastKaraokeProgress = progress;
        this.lastKaraokeClockTime = now;
    }

    private static findActiveLineIndex(progress: number) {
        let low = 0;
        let high = this.timedLines.length - 1;
        let activeIndex = -1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const line = this.timedLines[middle];
            if (line.time <= progress) {
                activeIndex = line.index;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return activeIndex;
    }

    private static buildKaraokeWordCache() {
        this.karaokeWordsByLine = this.lineNodes.map((lineNode, lineIndex) => {
            const currentLine = this.lines[lineIndex];
            const nextLine = this.lines[lineIndex + 1];
            const lineEndCandidates = [
                currentLine?.time !== null && currentLine?.duration
                    ? currentLine.time + currentLine.duration
                    : null,
                nextLine?.time ?? null,
            ].filter((time): time is number => Number.isFinite(time));
            const lineEnd = lineEndCandidates.length ? Math.min(...lineEndCandidates) : null;
            const nodes = Array.from(lineNode.querySelectorAll<HTMLElement>(".rnp-karaoke-word"));

            return nodes.flatMap((node, wordIndex) => {
                const time = Number(node.dataset.time);
                const duration = Number(node.dataset.duration);
                if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
                    return [];
                }
                const nextWordTime = Number(nodes[wordIndex + 1]?.dataset.time);
                const endCandidates = [
                    time + duration,
                    Number.isFinite(nextWordTime) ? nextWordTime : null,
                    wordIndex === nodes.length - 1 ? lineEnd : null,
                ].filter((end): end is number => Number.isFinite(end) && end > time);
                const effectiveEnd = endCandidates.length
                    ? Math.min(...endCandidates)
                    : time + duration;
                const effectiveDuration = Math.max(80, effectiveEnd - time);
                const peakGlow = Math.min(1, Math.ceil(effectiveDuration / 100) / 10);

                return [
                    {
                        node,
                        time,
                        effectiveEnd,
                        effectiveDuration,
                        peakGlow,
                        releaseDuration: Math.max(700, peakGlow * 1000),
                        animation: null,
                        visualState: 0,
                    },
                ];
            });
        });
        this.karaokeFuriganaByLine = this.lineNodes.map((lineNode) =>
            Array.from(
                lineNode.querySelectorAll<HTMLElement>(".rnp-karaoke-ruby > rt[data-time]"),
            ).flatMap((node) => {
                const time = Number(node.dataset.time);
                const duration = Number(node.dataset.duration);
                if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0)
                    return [];
                return [
                    {
                        node,
                        time,
                        duration,
                        releaseDuration: 420,
                        animation: null,
                    },
                ];
            }),
        );
    }

    private static resetKaraokeLine(lineIndex: number) {
        if (lineIndex < 0) return;
        this.karaokeWordsByLine[lineIndex]?.forEach((word) => {
            word.animation?.cancel();
            word.animation = null;
            word.node.classList.remove("active", "finished", "glowing");
            word.node.style.removeProperty("--karaoke-progress");
            word.node.style.removeProperty("--karaoke-lift");
            word.node.style.removeProperty("--karaoke-scale");
            word.node.style.removeProperty("--karaoke-glow");
            word.visualState = 0;
        });
        this.karaokeFuriganaByLine[lineIndex]?.forEach((furigana) => {
            furigana.animation?.cancel();
            furigana.animation = null;
            furigana.node.style.removeProperty("--furigana-lift");
            furigana.node.style.removeProperty("--furigana-scale");
            furigana.node.style.removeProperty("--furigana-opacity");
        });
        if (this.karaokeAnimationLine === lineIndex) {
            this.karaokeAnimationLine = -1;
            this.karaokeAnimationsPlaying = false;
        }
    }

    private static scheduleKaraokeLine(progress: number, isPlaying: boolean) {
        if (this.karaokeAnimationLine >= 0) {
            this.resetKaraokeLine(this.karaokeAnimationLine);
        }
        const words = this.karaokeWordsByLine[this.activeIndex];
        const lineTime = this.lines[this.activeIndex]?.time;
        if (!words?.length || lineTime === null || lineTime === undefined) return;

        this.ensureKaraokePropertiesRegistered();
        const lineProgress = Math.max(0, progress - lineTime);
        words.forEach((word) => {
            const delay = Math.max(0, word.time - lineTime);
            const animation = word.node.animate(this.buildKaraokeKeyframes(word), {
                delay,
                duration: word.effectiveDuration + word.releaseDuration,
                fill: "both",
                easing: "linear",
            });
            word.animation = animation;
            animation.pause();
            animation.currentTime = lineProgress;
            if (isPlaying) animation.play();
        });
        this.karaokeFuriganaByLine[this.activeIndex]?.forEach((furigana) => {
            const delay = Math.max(0, furigana.time - lineTime);
            const animation = furigana.node.animate(this.buildFuriganaKeyframes(furigana), {
                delay,
                duration: furigana.duration + furigana.releaseDuration,
                fill: "both",
                easing: "linear",
            });
            furigana.animation = animation;
            animation.pause();
            animation.currentTime = lineProgress;
            if (isPlaying) animation.play();
        });
        this.karaokeAnimationLine = this.activeIndex;
        this.karaokeAnimationsPlaying = isPlaying;
    }

    private static syncKaraokeAnimationClock(
        progress: number,
        isPlaying: boolean,
        forceResync: boolean,
    ) {
        const lineTime = this.lines[this.activeIndex]?.time;
        const words = this.karaokeWordsByLine[this.activeIndex];
        if (lineTime === null || lineTime === undefined || !words?.length) return;
        const expectedTime = Math.max(0, progress - lineTime);
        const shouldResync = forceResync || isPlaying !== this.karaokeAnimationsPlaying;
        if (!shouldResync) return;

        words.forEach((word) => {
            const animation = word.animation;
            if (!animation) return;
            animation.pause();
            animation.currentTime = expectedTime;
            if (isPlaying) animation.play();
        });
        this.karaokeFuriganaByLine[this.activeIndex]?.forEach((furigana) => {
            const animation = furigana.animation;
            if (!animation) return;
            animation.pause();
            animation.currentTime = expectedTime;
            if (isPlaying) animation.play();
        });
        this.karaokeAnimationsPlaying = isPlaying;
    }

    private static updateKaraokeWordClasses(words: KaraokeWordRenderState[], progress: number) {
        words.forEach((word) => {
            const active = progress >= word.time && progress < word.effectiveEnd;
            const finished = progress >= word.effectiveEnd;
            const releasing = finished && progress < word.effectiveEnd + word.releaseDuration;
            const visualState =
                (active ? 1 : 0) | (finished ? 2 : 0) | (active || releasing ? 4 : 0);
            const changed = word.visualState ^ visualState;
            if (!changed) return;
            if (changed & 1) word.node.classList.toggle("active", active);
            if (changed & 2) word.node.classList.toggle("finished", finished);
            if (changed & 4) word.node.classList.toggle("glowing", active || releasing);
            word.visualState = visualState;
        });
    }

    private static buildKaraokeKeyframes(word: KaraokeWordRenderState) {
        const totalDuration = word.effectiveDuration + word.releaseDuration;
        const activeOffset = word.effectiveDuration / totalDuration;
        const keyframes = Array.from({ length: 21 }, (_, index) => {
            const progress = index / 20;
            const eased = progress * progress * (3 - 2 * progress);
            const lift = 0.05 + (-0.07 - 0.05) * eased;
            const scale = 0.998 + (1.012 - 0.998) * eased;
            return {
                offset: progress * activeOffset,
                "--karaoke-progress": `${progress * 100}`,
                "--karaoke-lift": `${lift}em`,
                "--karaoke-scale": `${scale}`,
                "--karaoke-glow": `${word.peakGlow * progress}`,
            } as Keyframe;
        });
        for (let index = 1; index <= 10; index++) {
            const releaseProgress = index / 10;
            const eased = releaseProgress * releaseProgress * (3 - 2 * releaseProgress);
            keyframes.push({
                offset: activeOffset + (1 - activeOffset) * releaseProgress,
                "--karaoke-progress": "100",
                "--karaoke-lift": "-0.07em",
                "--karaoke-scale": "1.012",
                "--karaoke-glow": `${word.peakGlow * (1 - eased)}`,
            } as Keyframe);
        }
        return keyframes;
    }

    private static buildFuriganaKeyframes(furigana: KaraokeFuriganaRenderState) {
        const totalDuration = furigana.duration + furigana.releaseDuration;
        const activeOffset = furigana.duration / totalDuration;
        const keyframes = Array.from({ length: 13 }, (_, index) => {
            const progress = index / 12;
            const eased = progress * progress * (3 - 2 * progress);
            return {
                offset: progress * activeOffset,
                "--furigana-lift": `${0.08 + (-0.2 - 0.08) * eased}em`,
                "--furigana-scale": `${0.98 + 0.04 * eased}`,
                "--furigana-opacity": `${0.72 + 0.28 * progress}`,
            } as Keyframe;
        });
        keyframes.push({
            offset: 1,
            "--furigana-lift": "-0.12em",
            "--furigana-scale": "1",
            "--furigana-opacity": "0.88",
        } as Keyframe);
        return keyframes;
    }

    private static ensureKaraokePropertiesRegistered() {
        if (this.karaokePropertiesRegistered) return;
        const registerProperty = (
            CSS as typeof CSS & {
                registerProperty?: (definition: PropertyDefinition) => void;
            }
        ).registerProperty;
        if (!registerProperty) return;
        const definitions: PropertyDefinition[] = [
            { name: "--karaoke-progress", syntax: "<number>", inherits: true, initialValue: "0" },
            { name: "--karaoke-lift", syntax: "<length>", inherits: true, initialValue: "0em" },
            { name: "--karaoke-scale", syntax: "<number>", inherits: true, initialValue: "1" },
            { name: "--karaoke-glow", syntax: "<number>", inherits: true, initialValue: "0" },
            { name: "--furigana-lift", syntax: "<length>", inherits: false, initialValue: "0em" },
            { name: "--furigana-scale", syntax: "<number>", inherits: false, initialValue: "1" },
            {
                name: "--furigana-opacity",
                syntax: "<number>",
                inherits: false,
                initialValue: "0.8",
            },
        ];
        definitions.forEach((definition) => {
            try {
                registerProperty.call(CSS, definition);
            } catch {
                // The property may already be registered by a previous extension reload.
            }
        });
        this.karaokePropertiesRegistered = true;
    }

    private static cancelKaraokeAnimations() {
        const activeWords = this.karaokeWordsByLine[this.karaokeAnimationLine];
        activeWords?.forEach((word) => {
            word.animation?.cancel();
            word.animation = null;
        });
        this.karaokeFuriganaByLine[this.karaokeAnimationLine]?.forEach((furigana) => {
            furigana.animation?.cancel();
            furigana.animation = null;
        });
        this.karaokeAnimationLine = -1;
        this.karaokeAnimationsPlaying = false;
        this.lastKaraokeProgress = null;
        this.lastKaraokeClockTime = 0;
    }

    private static setupLyricsInteraction() {
        if (!this.lyricsRoot) return;
        const lyricsRoot = this.lyricsRoot;
        lyricsRoot.addEventListener("mouseenter", () => {
            this.lyricsPointerInside = true;
            this.beginLyricsInteraction(10_000);
        });
        lyricsRoot.addEventListener("mousemove", (event) => {
            if (!this.lyricsPointerInside) this.lyricsPointerInside = true;
            const currentHoveredLine = this.hoveredLine;
            const currentRect = currentHoveredLine?.getBoundingClientRect();
            const pointerStillOverCurrent = Boolean(
                currentRect &&
                    event.clientX >= currentRect.left &&
                    event.clientX <= currentRect.right &&
                    event.clientY >= currentRect.top &&
                    event.clientY <= currentRect.bottom,
            );
            const hoveredLine = pointerStillOverCurrent
                ? currentHoveredLine
                : (event.target as HTMLElement | null)?.closest<HTMLElement>(
                      ".rnp-lyrics-line-seekable",
                  );
            if (hoveredLine !== this.hoveredLine) {
                this.hoveredLine = hoveredLine;
                if (this.isSynced) this.applyTransforms();
            }
            this.beginLyricsInteraction(10_000);
        });
        lyricsRoot.addEventListener("mouseleave", () => {
            this.lyricsPointerInside = false;
            this.hoveredLine = null;
            if (this.isSynced) this.applyTransforms();
            this.scheduleLyricsInteractionReset(3_000);
        });
        lyricsRoot.addEventListener(
            "wheel",
            (event) => {
                if (!this.isSynced || !this.lineNodes.length) return;
                event.preventDefault();
                if (!this.manualScrollActive) {
                    const startPosition = Math.max(this.activeIndex, 0);
                    this.manualScrollTargetPosition = startPosition;
                    this.manualScrollRenderPosition = startPosition;
                }
                this.manualScrollActive = true;
                this.beginLyricsInteraction(10_000);
                if (event.deltaY === 0) return;
                const fontSize = this.getFontSize();
                const lineDistance = Math.max(64, Math.min(96, fontSize * 3.2));
                const deltaPixels =
                    event.deltaMode === 1
                        ? event.deltaY * fontSize
                        : event.deltaMode === 2
                          ? event.deltaY * (this.containerHeight || lyricsRoot.clientHeight)
                          : event.deltaY;
                this.manualScrollTargetPosition = Math.max(
                    0,
                    Math.min(
                        this.lines.length - 1,
                        this.manualScrollTargetPosition + deltaPixels / lineDistance,
                    ),
                );
                this.scheduleManualScrollRender();
            },
            { passive: false },
        );
        lyricsRoot.addEventListener("click", (event) => {
            const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                ".rnp-lyrics-line-seekable",
            );
            if (!target || !lyricsRoot.contains(target)) return;
            const index = Number(target.dataset.index);
            const time = Number(target.dataset.time);
            if (!Number.isInteger(index) || !Number.isFinite(time) || time < 0) return;
            Spicetify.Player.seek(time);
            this.resetLyricsInteraction();
            this.updateActive(time);
        });
    }

    private static beginLyricsInteraction(resetAfterMs: number) {
        const wasInactive = !this.lyricsInteractionActive;
        this.lyricsInteractionActive = true;
        this.lyricsRoot?.classList.add("rnp-lyrics-interacting");
        this.scheduleLyricsInteractionReset(resetAfterMs);
        if (wasInactive && this.isSynced) this.applyTransforms();
    }

    private static scheduleLyricsInteractionReset(delayMs: number) {
        if (this.lyricsInteractionTimer) clearTimeout(this.lyricsInteractionTimer);
        this.lyricsInteractionTimer = setTimeout(() => {
            this.lyricsInteractionTimer = null;
            this.resetLyricsInteraction();
        }, delayMs);
    }

    private static scheduleManualScrollRender() {
        if (this.manualScrollFrame !== null) return;
        const render = () => {
            this.manualScrollFrame = null;
            if (!this.manualScrollActive || !this.lines.length) return;
            const distance = this.manualScrollTargetPosition - this.manualScrollRenderPosition;
            if (Math.abs(distance) < 0.002) {
                this.manualScrollRenderPosition = this.manualScrollTargetPosition;
                this.applyTransforms();
                return;
            }
            this.manualScrollRenderPosition += distance * 0.28;
            this.applyTransforms();
            this.manualScrollFrame = requestAnimationFrame(render);
        };
        this.manualScrollFrame = requestAnimationFrame(render);
    }

    private static resetLyricsInteraction(apply = true) {
        const wasManualScrollActive = this.manualScrollActive;
        if (this.lyricsInteractionTimer) clearTimeout(this.lyricsInteractionTimer);
        this.lyricsInteractionTimer = null;
        if (this.manualScrollFrame !== null) cancelAnimationFrame(this.manualScrollFrame);
        this.manualScrollFrame = null;
        this.lyricsInteractionActive = false;
        this.lyricsPointerInside = false;
        this.hoveredLine = null;
        this.manualScrollActive = false;
        this.manualScrollTargetPosition = -1;
        this.manualScrollRenderPosition = -1;
        this.lyricsRoot?.classList.remove("rnp-lyrics-interacting");
        if (apply && this.isSynced) this.applyTransforms(!wasManualScrollActive);
    }

    private static applyTransforms(skipAnimation = false) {
        if (!this.isSynced) return;
        if (!this.lyricsRoot || !this.lineNodes.length) return;
        const lyricsRoot = this.lyricsRoot;
        if (!this.lineHeights.length || this.lineHeights.length !== this.lineNodes.length) {
            this.measureHeights();
        }
        this.lineNodes.forEach((node, idx) =>
            node.classList.toggle("active", this.activeIndex >= 0 && idx === this.activeIndex),
        );

        const fontSize = this.getFontSize();
        if (Math.abs(fontSize - this.lastMeasuredFontSize) > 0.5) {
            this.stabilizeLineWrapping();
            this.measureHeights();
        }
        const baseGap = Math.max(22, Math.min(58, fontSize * 1.0));
        const containerHeight = this.containerHeight || lyricsRoot.clientHeight || 1;
        const centerY = containerHeight * 0.38;
        const baseIndent = Math.max(12, Math.min(36, fontSize * 0.8));

        type LyricTransform = {
            top: number;
            scale: number;
            blur: number;
            opacity: number;
            delay: number;
            translate: number;
        };
        const buildTransforms = (layoutActiveIndex: number): LyricTransform[] => {
            const hasActive = layoutActiveIndex >= 0;
            const current = Math.max(
                0,
                Math.min(hasActive ? layoutActiveIndex : 0, this.lineNodes.length - 1),
            );
            const transforms: LyricTransform[] = new Array(this.lineNodes.length).fill(
                null as never,
            );
            const scaleByOffset = (offset: number) => Math.max(0.72, 1 - 0.12 * offset);
            const blurByOffset = (offset: number) =>
                this.manualScrollActive ? 0 : Math.min(4.5, offset * 0.9);
            const opacityByOffset = (offset: number) =>
                this.manualScrollActive ? 1 : Math.max(0.32, 1 - Math.max(0, offset - 1) * 0.22);
            const translateByOffset = (offset: number) => Math.max(0, baseIndent - offset * 6);
            const translateForLine = (index: number, offset: number) => {
                const rightSpace =
                    this.lineRightSpaces[index] ??
                    Math.max(
                        0,
                        lyricsRoot.clientWidth -
                            this.lineNodes[index].offsetLeft -
                            this.lineNodes[index].offsetWidth,
                    );
                return Math.min(translateByOffset(offset), rightSpace);
            };
            const delayByOffset = (offset: number) =>
                this.manualScrollActive ? 0 : Math.min(6, offset) * 45;

            if (!hasActive) {
                const firstHeight = this.lineHeights[0] || fontSize * 1.1;
                const firstScale = scaleByOffset(1);
                let runningTop = centerY + (firstHeight * firstScale) / 2 + baseGap;
                for (let i = 0; i < this.lineNodes.length; i++) {
                    const offset = i + 1;
                    const scale = scaleByOffset(offset);
                    transforms[i] = {
                        top: runningTop,
                        scale,
                        blur: blurByOffset(offset),
                        opacity: opacityByOffset(offset),
                        delay: 0,
                        translate: translateForLine(i, offset),
                    };
                    const h = (this.lineHeights[i] || fontSize) * scale;
                    runningTop += h + baseGap;
                }
                return transforms;
            }

            transforms[current] = {
                top: centerY - this.lineHeights[current] / 2,
                scale: 1,
                blur: 0,
                opacity: 1,
                delay: 0,
                translate: translateForLine(current, 0),
            };

            for (let i = current - 1; i >= 0; i--) {
                const offset = current - i;
                const scale = scaleByOffset(offset);
                const height = this.lineHeights[i] * scale;
                transforms[i] = {
                    top: transforms[i + 1].top - height - baseGap,
                    scale,
                    blur: blurByOffset(offset),
                    opacity: opacityByOffset(offset),
                    delay: delayByOffset(offset),
                    translate: translateForLine(i, offset),
                };
            }

            for (let i = current + 1; i < this.lineNodes.length; i++) {
                const offset = i - current;
                const scale = scaleByOffset(offset);
                const height = this.lineHeights[i - 1] * transforms[i - 1].scale;
                transforms[i] = {
                    top: transforms[i - 1].top + height + baseGap,
                    scale,
                    blur: blurByOffset(offset),
                    opacity: opacityByOffset(offset),
                    delay: delayByOffset(offset),
                    translate: translateForLine(i, offset),
                };
            }
            return transforms;
        };

        let transforms: LyricTransform[];
        if (!this.manualScrollActive) {
            transforms = buildTransforms(this.activeIndex);
        } else {
            const position = Math.max(
                0,
                Math.min(
                    this.lines.length - 1,
                    this.manualScrollRenderPosition >= 0
                        ? this.manualScrollRenderPosition
                        : Math.max(this.activeIndex, 0),
                ),
            );
            const lowerIndex = Math.floor(position);
            const upperIndex = Math.min(this.lines.length - 1, lowerIndex + 1);
            const fraction = position - lowerIndex;
            const from = buildTransforms(lowerIndex);
            const to = buildTransforms(upperIndex);
            transforms = from.map((transform, index) => ({
                top: transform.top + (to[index].top - transform.top) * fraction,
                scale: transform.scale + (to[index].scale - transform.scale) * fraction,
                blur: transform.blur + (to[index].blur - transform.blur) * fraction,
                opacity: transform.opacity + (to[index].opacity - transform.opacity) * fraction,
                delay: 0,
                translate:
                    transform.translate + (to[index].translate - transform.translate) * fraction,
            }));
        }

        this.lineNodes.forEach((node, idx) => {
            const t = transforms[idx];
            if (!t) return;
            const scaledHeight = (this.lineHeights[idx] || fontSize) * t.scale;
            const overscan = containerHeight * this.LINE_RENDER_OVERSCAN;
            const outsideViewport =
                t.top + scaledHeight < -overscan || t.top > containerHeight + overscan;
            const wasOutsideViewport = node.classList.contains("rnp-lyrics-line-outside");
            node.classList.toggle("rnp-lyrics-line-outside", outsideViewport);
            const enteredViewport = wasOutsideViewport && !outsideViewport;
            const duration = skipAnimation || this.manualScrollActive || enteredViewport ? 0 : 520;
            node.style.setProperty("--lyrics-line-transform-duration", `${duration}ms`);
            node.style.setProperty(
                "--lyrics-line-transform-delay",
                `${skipAnimation || this.manualScrollActive ? 0 : t.delay}ms`,
            );
            const isHovered = this.lyricsInteractionActive && node === this.hoveredLine;
            node.style.transformOrigin = "left center";
            node.style.transform = `translate3d(${t.translate}px, ${t.top}px, 0) scale(${t.scale})`;
            node.style.opacity = `${t.opacity}`;
            node.style.filter =
                t.blur && !this.lyricsInteractionActive ? `blur(${t.blur}px)` : "none";
            const contentNode = this.lineContentNodes[idx];
            if (contentNode) {
                contentNode.style.scale = isHovered ? "1.02" : "1";
                contentNode.style.transformOrigin = "center center";
            }
        });
    }

    private static stabilizeLineWrapping() {
        if (!this.lyricsRoot) return;
        const lyricsRoot = this.lyricsRoot;

        this.lineNodes.forEach((node) => {
            node.style.removeProperty("width");
            node.style.removeProperty("max-width");
        });

        const rootWidth = lyricsRoot.clientWidth;
        this.lineNodes.forEach((node) => {
            const defaultWidth = node.offsetWidth;
            const maxWidth = Math.max(defaultWidth, rootWidth - node.offsetLeft);
            const normal = node.cloneNode(true) as HTMLElement;
            const active = node.cloneNode(true) as HTMLElement;
            const prepareClone = (clone: HTMLElement) => {
                clone.classList.remove("rnp-lyrics-line-outside");
                clone.style.position = "absolute";
                clone.style.left = `${node.offsetLeft}px`;
                clone.style.top = "0";
                clone.style.maxWidth = "none";
                clone.style.visibility = "hidden";
                clone.style.pointerEvents = "none";
                clone.style.transition = "none";
                clone.style.transform = "none";
                clone.style.filter = "none";
            };
            prepareClone(normal);
            prepareClone(active);
            normal.classList.remove("active");
            active.classList.add("active");
            lyricsRoot.append(normal, active);

            const hasStableHeight = (width: number) => {
                const measuredWidth = `${width}px`;
                normal.style.width = measuredWidth;
                active.style.width = measuredWidth;
                return normal.offsetHeight === active.offsetHeight;
            };

            let stableWidth = defaultWidth;
            if (!hasStableHeight(defaultWidth)) {
                let found = false;
                for (let width = Math.ceil(defaultWidth) + 1; width <= maxWidth; width += 1) {
                    if (!hasStableHeight(width)) continue;
                    stableWidth = width;
                    found = true;
                    break;
                }
                if (!found) {
                    const minWidth = Math.floor(defaultWidth * 0.72);
                    for (let width = Math.floor(defaultWidth) - 1; width >= minWidth; width -= 1) {
                        if (!hasStableHeight(width)) continue;
                        stableWidth = width;
                        break;
                    }
                }
            }

            normal.remove();
            active.remove();
            if (Math.abs(stableWidth - defaultWidth) < 0.5) return;
            node.style.width = `${stableWidth}px`;
            node.style.maxWidth = `${stableWidth}px`;
        });
    }

    private static measureHeights() {
        const lyricsRoot = this.lyricsRoot;
        if (!lyricsRoot) return;
        this.lineHeights = this.lineNodes.map(
            (node) => node.offsetHeight || node.scrollHeight || 0,
        );
        this.lineRightSpaces = this.lineNodes.map((node) =>
            Math.max(0, lyricsRoot.clientWidth - node.offsetLeft - node.offsetWidth),
        );
        this.containerHeight = lyricsRoot.clientHeight;
        this.lastMeasuredFontSize = this.getFontSize();
    }

    private static setupResizeObserver() {
        if (!this.lyricsRoot || typeof ResizeObserver === "undefined") return;
        this.stopResizeObserver();
        this.resizeObserver = new ResizeObserver(() => {
            if (this.manualScrollActive) this.resetLyricsInteraction(false);
            this.stabilizeLineWrapping();
            this.measureHeights();
            this.applyTransforms(true);
        });
        this.resizeObserver.observe(this.lyricsRoot);
    }

    private static stopResizeObserver() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    private static getFontSize() {
        if (!this.container) return 24;
        const val = window.getComputedStyle(this.container).getPropertyValue("font-size");
        const parsed = Number.parseFloat(val);
        return Number.isFinite(parsed) ? parsed : 24;
    }

    private static normalizeLines(raw: unknown): LyricLine[] {
        if (!raw || !Array.isArray(raw)) return [];
        return raw
            .map((line) => {
                const text = `${line?.words ?? line?.text ?? line?.lyrics ?? ""}`.trim();
                if (!text) return null;
                const timeValue =
                    line?.startTimeMs ??
                    line?.startTime ??
                    line?.time ??
                    line?.t ??
                    line?.offset ??
                    null;
                const parsed =
                    typeof timeValue === "string"
                        ? Number.parseInt(timeValue, 10)
                        : typeof timeValue === "number"
                          ? timeValue
                          : null;
                return {
                    text,
                    time: typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null,
                };
            })
            .filter(Boolean) as LyricLine[];
    }

    private static resetDiagnostics() {
        this.diagnostics = {
            total: 0,
            timed: 0,
            translations: 0,
            romanizations: 0,
            karaoke: 0,
        };
    }

    static getDiagnostics() {
        return {
            status: this.lastStatus,
            playback: {
                rawProgress: this.lastRawPlaybackProgress,
                synchronizedProgress: this.playbackClockProgress,
                driftMilliseconds: this.playbackClockDrift,
            },
            lines: { ...this.diagnostics },
            rendered: this.lines.map((line) => ({
                ...line,
                words: line.words?.map((word) => ({ ...word })),
            })),
            thirdParty: getThirdPartyLyricsDebug(),
        };
    }
}
