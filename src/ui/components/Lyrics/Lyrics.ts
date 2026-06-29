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
    deleteCachedLyrics,
    getCachedLyrics,
    getCachedLyricsDebug,
    setCachedLyrics,
} from "../../../services/lyrics-cache";
import type { LyricsCacheKind } from "../../../services/lyrics-cache";

type LyricLine = EnhancedLyricLine;
type LyricsTrack = TrackInfo & {
    uri: string;
};
type FuriganaContext = {
    readings: string[];
    index: number;
};
type JapaneseReadingPart = {
    text: string;
    type: "kanji" | "kana" | "other";
};
type FuriganaAlignment = {
    kanjiReadings: Record<number, string>;
    score: number;
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
    animations: Animation[];
};
type TimedKaraokeSegment = {
    text: string;
    time: number;
    duration: number;
    start: number;
};

export class Lyrics {
    private static readonly REQUEST_TIMEOUT_MS = 12000;
    private static readonly RETRY_DELAYS_MS = [0, 900, 1800, 3200];
    private static readonly REFETCH_DELAYS_MS = [15000, 45000, 120000];
    private static readonly PREFETCH_WINDOW_MS = 10000;
    private static readonly spotifyRequests = new Map<string, Promise<LyricLine[]>>();
    private static readonly enhancedRequests = new Map<string, Promise<LyricLine[]>>();
    private static container: HTMLElement | null = null;
    private static lyricsRoot: HTMLElement | null = null;
    private static lineNodes: HTMLElement[] = [];
    private static timedLines: TimedLyricLine[] = [];
    private static karaokeWordsByLine: KaraokeWordRenderState[][] = [];
    private static playbackBoundaries: number[] = [];
    private static lineHeights: number[] = [];
    private static containerHeight = 0;
    private static lines: LyricLine[] = [];
    private static activeIndex = -1;
    private static updateTimer: ReturnType<typeof setTimeout> | null = null;
    private static karaokeAnimationLine = -1;
    private static karaokeAnimationsPlaying = false;
    private static karaokePropertiesRegistered = false;
    private static lastKaraokeProgress: number | null = null;
    private static lastKaraokeClockTime = 0;
    private static resizeObserver: ResizeObserver | null = null;
    private static lastMeasuredFontSize = 0;
    private static isSynced = false;
    private static lastStatus: "synced" | "unsynced" | "unavailable" | "loading" = "unavailable";
    private static lastLines: LyricLine[] = [];
    private static loadSequence = 0;
    private static currentTrackUri: string | null = null;
    private static refetchAttempt = 0;
    private static refetchTimer: ReturnType<typeof setTimeout> | null = null;

    static attach(container: HTMLElement) {
        this.container = container;
    }

    static teardown() {
        this.stopLoop();
        this.cancelKaraokeAnimations();
        this.lines = [];
        this.lineNodes = [];
        this.timedLines = [];
        this.karaokeWordsByLine = [];
        this.playbackBoundaries = [];
        this.lineHeights = [];
        this.containerHeight = 0;
        this.activeIndex = -1;
        this.stopResizeObserver();
        this.lastMeasuredFontSize = 0;
        this.lyricsRoot = null;
        this.container = null;
        this.isSynced = false;
        this.lastStatus = "unavailable";
        this.lastLines = [];
        this.currentTrackUri = null;
        this.clearRefetch();
        this.loadSequence += 1;
    }

    static toggleLyrics() {
        DOM.container.classList.toggle("lyrics-hide-force");
    }

    static async refreshCurrentLyrics() {
        const trackUri = Spicetify.Player.data?.item?.uri;
        if (!trackUri) return false;
        await this.loadLyrics(trackUri, "all");
        return this.lastStatus === "synced" || this.lastStatus === "unsynced";
    }

    static async loadLyrics(trackUri?: string, force: "none" | "enhanced" | "all" = "none") {
        if (trackUri !== this.currentTrackUri) {
            this.clearRefetch();
            this.refetchAttempt = 0;
            this.currentTrackUri = trackUri ?? null;
        }
        const sequence = ++this.loadSequence;
        if (!CFM.get("lyricsDisplay") || !trackUri) {
            this.renderStatus("Lyrics unavailable", true);
            return;
        }
        if (force !== "none") {
            deleteCachedLyrics(trackUri, force === "enhanced" ? "enhanced" : undefined);
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
                getThirdPartyLyricsDebug().status === "error"
            ) {
                this.scheduleRefetch(trackUri, "enhanced");
            }
            return;
        }
        this.lastStatus = "loading";
        this.renderStatus("Loading lyrics…", false);
        try {
            const lines = await this.getPreparedLyrics(track, true);
            if (!this.isCurrentLoad(sequence)) return;
            if (!lines.length) {
                this.renderStatus("Lyrics unavailable", true);
                this.scheduleRefetch(trackUri, "all");
                return;
            }
            this.applyLines(lines);
            if (
                CFM.get("thirdPartyLyrics") &&
                getThirdPartyLyricsDebug().status === "error"
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
        }
    }

    static prefetchNextLyrics() {
        if (!CFM.get("lyricsDisplay")) return;
        const duration = Spicetify.Player.data?.duration ?? Spicetify.Player.getDuration();
        if (!duration || duration <= 0) return;
        const remaining = duration - Spicetify.Player.getProgress();
        if (remaining > this.PREFETCH_WINDOW_MS) return;
        if (Spicetify.Player.getRepeat() === 2) return;

        const nextTrack = this.getNextTrack();
        const currentUri = Spicetify.Player.data?.item?.uri;
        if (!nextTrack || nextTrack.uri === currentUri) return;
        void this.getPreparedLyrics(nextTrack, false).catch((err) => {
            console.debug("Unable to prefetch next track lyrics", err);
        });
    }

    // ---- internal helpers ----

    private static getPreparedLyricsFromCache(track: LyricsTrack) {
        const kind: LyricsCacheKind = CFM.get("thirdPartyLyrics") ? "enhanced" : "spotify";
        const cached = getCachedLyrics(track.uri, kind);
        if (cached !== null && kind === "enhanced") {
            this.publishCachedDebug(track.uri);
        }
        return cached;
    }

    private static async getPreparedLyrics(track: LyricsTrack, publishDebug: boolean) {
        const thirdPartyEnabled = Boolean(CFM.get("thirdPartyLyrics"));
        const kind: LyricsCacheKind = thirdPartyEnabled ? "enhanced" : "spotify";
        const cached = getCachedLyrics(track.uri, kind);
        if (cached !== null) {
            if (publishDebug && kind === "enhanced") this.publishCachedDebug(track.uri);
            return cached;
        }

        const spotifyLines = await this.getSpotifyLyrics(track);
        if (
            !thirdPartyEnabled ||
            !track.title ||
            !track.duration ||
            (!track.artists && !track.album)
        ) {
            return spotifyLines;
        }

        const enhancedCached = getCachedLyrics(track.uri, "enhanced");
        if (enhancedCached !== null) {
            if (publishDebug) this.publishCachedDebug(track.uri);
            return enhancedCached;
        }
        const pending = this.enhancedRequests.get(track.uri);
        if (pending) {
            const lines = await pending;
            if (publishDebug) this.publishCachedDebug(track.uri);
            return lines;
        }

        let debugSnapshot: ThirdPartyLyricsDebug | undefined;
        const request = enhanceWithThirdPartyLyrics(spotifyLines, track, publishDebug, (debug) => {
            debugSnapshot = debug;
        })
            .then((lines) => {
                if (debugSnapshot?.status !== "error") {
                    setCachedLyrics(track.uri, "enhanced", lines, debugSnapshot);
                }
                return lines;
            })
            .finally(() => {
                this.enhancedRequests.delete(track.uri);
            });
        this.enhancedRequests.set(track.uri, request);
        return request;
    }

    private static publishCachedDebug(trackUri: string) {
        const debug = getCachedLyricsDebug(trackUri);
        if (debug) publishThirdPartyLyricsDebug(debug, true);
    }

    private static async getSpotifyLyrics(track: LyricsTrack) {
        const cached = getCachedLyrics(track.uri, "spotify");
        if (cached !== null) return cached;
        const pending = this.spotifyRequests.get(track.uri);
        if (pending) return pending;

        const trackId = track.uri.split(":").pop();
        if (!trackId) return [];
        const request = this.getLyricsWithRetry(trackId)
            .then((response) => this.normalizeLines(response?.lyrics?.lines))
            .catch(() => [])
            .then((lines) => {
                setCachedLyrics(track.uri, "spotify", lines);
                return lines;
            })
            .finally(() => {
                this.spotifyRequests.delete(track.uri);
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

    private static isCurrentLoad(sequence: number) {
        return sequence === this.loadSequence;
    }

    private static renderStatus(text: string, unavailable: boolean) {
        if (!this.container) return;
        this.stopResizeObserver();
        this.cancelKaraokeAnimations();
        this.lines = [];
        this.lineNodes = [];
        this.timedLines = [];
        this.karaokeWordsByLine = [];
        this.playbackBoundaries = [];
        this.lineHeights = [];
        this.containerHeight = 0;
        this.activeIndex = -1;
        this.lastMeasuredFontSize = 0;
        this.lyricsRoot = null;
        this.lastLines = [];
        this.isSynced = false;
        this.lastStatus = unavailable ? "unavailable" : "loading";
        if (unavailable) DOM.container.classList.add("lyrics-unavailable");
        else DOM.container.classList.remove("lyrics-unavailable");
        this.stopLoop();
        this.container.innerHTML = `<div class="lyrics-wrapper"><div class="lyrics-status">${this.escapeHtml(text)}</div></div>`;
    }

    private static applyLines(lines: LyricLine[]) {
        const timeValues = lines.map((line) => line.time).filter((t): t is number => t !== null);
        const lastTime = timeValues.length ? timeValues[timeValues.length - 1] : null;
        const hasNonZero = timeValues.some((t) => t > 0);
        this.isSynced = Boolean(timeValues.length && hasNonZero && (lastTime ?? 0) > 0);
        this.stopLoop();
        this.lines = lines;
        this.timedLines = lines.flatMap((line, index) =>
            line.time === null ? [] : [{ index, time: line.time }],
        );
        this.lastLines = lines;
        this.lastStatus = this.isSynced ? "synced" : "unsynced";
        this.activeIndex = this.isSynced ? -1 : 0;
        DOM.container.classList.remove("lyrics-unavailable");
        this.container?.classList.toggle("lyrics-unsynced", !this.isSynced);
        this.renderLines();
        if (this.isSynced) this.startLoop();
    }

    private static renderLines() {
        if (!this.container) return;
        this.cancelKaraokeAnimations();
        const body = this.lines
            .map(
                (line, idx) =>
                    `<div class="rnp-lyrics-line" data-index="${idx}" data-time="${line.time ?? ""}">
                        ${this.renderLineContent(line)}
                    </div>`,
            )
            .join("");
        this.container.innerHTML = `
            <div class="lyrics-wrapper">
                <div class="rnp-lyrics">
                    ${body}
                </div>
            </div>`;
        this.lyricsRoot = this.container.querySelector(".rnp-lyrics") as HTMLElement;
        this.lineNodes = Array.from(
            this.container.querySelectorAll<HTMLElement>(".rnp-lyrics-line"),
        );
        this.buildKaraokeWordCache();
        this.buildPlaybackBoundaries();
        if (!this.isSynced) {
            this.stopLoop();
            this.lineNodes.forEach((node, idx) => node.classList.toggle("active", idx === 0));
            return;
        }
        this.measureHeights();
        this.applyTransforms(true);
        this.setupResizeObserver();
    }

    private static renderLineContent(line: LyricLine) {
        const showKaraoke = Boolean(CFM.get("karaokeLyrics")) && Boolean(line.words?.length);
        const showFurigana = Boolean(CFM.get("showLyricsFurigana"));
        const furiganaContext = this.createFuriganaContext(line.romanization);
        const words = line.words ?? [];
        const original = showKaraoke
            ? `<div class="rnp-lyrics-line-karaoke">${this.renderKaraokeLine(
                  words,
                  showFurigana,
                  furiganaContext,
              )}</div>`
            : `<div class="rnp-lyrics-line-original">${this.formatLyricText(
                  line.text,
                  showFurigana,
                  furiganaContext,
              )}</div>`;

        const romanization =
            CFM.get("showLyricsRomanization") && line.romanization
                ? `<div class="rnp-lyrics-line-romaji">${this.escapeHtml(line.romanization)}</div>`
                : "";
        const translation =
            CFM.get("showLyricsTranslation") && line.translation
                ? `<div class="rnp-lyrics-line-translated">${this.escapeHtml(line.translation)}</div>`
                : "";

        return `${original}${romanization}${translation}`;
    }

    private static renderKaraokeLine(
        words: NonNullable<LyricLine["words"]>,
        showFurigana: boolean,
        furiganaContext?: FuriganaContext | null,
    ) {
        const text = words.map((word) => word.text).join("");
        const wordStarts = this.getSemanticWordStarts(text);
        const segments = this.splitKaraokeSegmentsAtOffsets(
            words.flatMap((word) => this.splitTimedKaraokeWord(word)),
            wordStarts,
        );
        const phraseGroups: string[] = [];
        let phrase = "";
        let semanticWord = "";

        const flushSemanticWord = () => {
            if (!semanticWord) return;
            phrase += `<span class="rnp-karaoke-semantic-word">${semanticWord}</span>`;
            semanticWord = "";
        };
        segments.forEach((segment) => {
            if (wordStarts.has(segment.start)) flushSemanticWord();
            semanticWord += this.renderKaraokeWordSegment(
                segment.text,
                segment.time,
                segment.duration,
                showFurigana,
                furiganaContext,
            );
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
                if (foundFirstWord) starts.add(segment.index);
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

    private static renderKaraokeWordSegment(
        text: string,
        time: number,
        duration: number,
        showFurigana: boolean,
        furiganaContext?: FuriganaContext | null,
    ) {
        return `<span class="rnp-karaoke-word" data-time="${time}" data-duration="${duration}"><span>${this.formatLyricText(text, showFurigana, furiganaContext)}</span></span>`;
    }

    private static splitLyricTextAtPreferredBreaks(text: string) {
        return (
            text
                .match(
                    /.*?(?:[\p{White_Space}\u200b\ufeff]+|[,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉]+|$)/gu,
                )
                ?.filter(Boolean) ?? [text]
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

    private static formatLyricText(
        text: string,
        showFurigana = false,
        furiganaContext?: FuriganaContext | null,
    ) {
        return showFurigana
            ? this.renderAutoFurigana(text, furiganaContext)
            : this.stripInlineFurigana(text);
    }

    private static formatPlainLyricText(text: string) {
        return this.splitLyricTextAtPreferredBreaks(text)
            .map(
                (segment) =>
                    `<span class="rnp-lyrics-break-segment">${this.escapeHtml(segment)}</span>`,
            )
            .join("<wbr>");
    }

    private static renderAutoFurigana(text: string, furiganaContext?: FuriganaContext | null) {
        return this.replaceInlineFurigana(
            text,
            (base, reading) => {
                this.consumeFuriganaReadingsForText(base, furiganaContext);
                return this.renderRuby(base, reading);
            },
            (segment) => this.renderGeneratedFurigana(segment, furiganaContext),
        );
    }

    private static stripInlineFurigana(text: string) {
        return this.replaceInlineFurigana(text, (base) => this.formatPlainLyricText(base));
    }

    private static replaceInlineFurigana(
        text: string,
        render: (base: string, reading: string) => string,
        renderPlain?: (plain: string) => string,
    ) {
        const renderPlainText =
            renderPlain ?? ((plain: string) => this.formatPlainLyricText(plain));
        const patterns = [
            /｜([^《》]+?)《([ぁ-ゖァ-ヺーゝゞヽヾ]+?)》/gu,
            /([一-龯々〆ヶ]+)《([ぁ-ゖァ-ヺーゝゞヽヾ]+?)》/gu,
            /([一-龯々〆ヶ]+)[（(]([ぁ-ゖァ-ヺーゝゞヽヾ]+?)[）)]/gu,
        ];
        let output = "";
        let cursor = 0;

        while (cursor < text.length) {
            let next: {
                index: number;
                length: number;
                base: string;
                reading: string;
            } | null = null;

            for (const pattern of patterns) {
                pattern.lastIndex = cursor;
                const match = pattern.exec(text);
                if (!match) continue;
                if (!next || match.index < next.index) {
                    next = {
                        index: match.index,
                        length: match[0].length,
                        base: match[1],
                        reading: match[2],
                    };
                }
            }

            if (!next) {
                output += renderPlainText(text.slice(cursor));
                break;
            }

            output += renderPlainText(text.slice(cursor, next.index));
            output += render(next.base, next.reading);
            cursor = next.index + next.length;
        }

        return output;
    }

    private static renderGeneratedFurigana(text: string, furiganaContext?: FuriganaContext | null) {
        let output = "";
        const japaneseToken = /[一-龯々〆ヶぁ-ゖァ-ヺー]+/gu;
        let cursor = 0;
        let match: RegExpExecArray | null;

        while ((match = japaneseToken.exec(text))) {
            output += this.formatPlainLyricText(text.slice(cursor, match.index));
            output += this.renderGeneratedFuriganaToken(match[0], furiganaContext);
            cursor = match.index + match[0].length;
        }

        output += this.formatPlainLyricText(text.slice(cursor));
        return output;
    }

    private static renderGeneratedFuriganaToken(
        token: string,
        furiganaContext?: FuriganaContext | null,
    ) {
        const reading = this.consumeFuriganaReadingsForText(token, furiganaContext);
        if (!this.hasKanji(token)) return this.formatPlainLyricText(token);
        if (reading) return this.renderTokenWithReading(token, reading);
        return this.formatPlainLyricText(token);
    }

    private static createFuriganaContext(romanization?: string): FuriganaContext | null {
        if (!romanization) return null;
        const readings = romanization
            .split(/[\s·・,.;:!?，。！？、；：~～\-‐‑‒–—―/\\|()[\]{}"“”‘’「」『』]+/u)
            .map((part) => this.romanizationToHiragana(part))
            .filter(Boolean);
        return readings.length ? { readings, index: 0 } : null;
    }

    private static consumeFuriganaReadingsForText(text: string, context?: FuriganaContext | null) {
        if (!context || context.index >= context.readings.length) return null;
        const plainText = this.stripInlineFurigana(text).replace(/<wbr>/g, "");
        const token = this.normalizeKana(
            plainText.replace(/[^\p{Script=Hiragana}\p{Script=Katakana}一-龯々〆ヶ]/gu, ""),
        );
        if (!token) return null;

        if (!this.hasKanji(token)) {
            const consumed = this.consumeKanaToken(token, context);
            return consumed ? "" : null;
        }

        const parts = this.splitJapaneseReadingParts(token);
        if (!parts.some((part) => part.type === "kana")) return null;

        const remaining = context.readings.length - context.index;
        let best: { parts: number; reading: string; alignment: FuriganaAlignment } | null = null;

        for (let count = 1; count <= remaining; count++) {
            const reading = context.readings.slice(context.index, context.index + count).join("");
            const alignment = this.alignTokenWithReading(parts, reading);
            if (!alignment) continue;
            if (
                !best ||
                alignment.score > best.alignment.score ||
                (alignment.score === best.alignment.score && count > best.parts)
            ) {
                best = { parts: count, reading, alignment };
            }
        }

        if (!best) return null;
        context.index += best.parts;
        return best.reading;
    }

    private static consumeKanaToken(token: string, context: FuriganaContext) {
        const pronounced = this.pronouncedKana(token);
        const remaining = context.readings.length - context.index;
        for (let count = 1; count <= remaining; count++) {
            const reading = context.readings.slice(context.index, context.index + count).join("");
            if (reading !== pronounced) continue;
            context.index += count;
            return true;
        }
        return false;
    }

    private static renderTokenWithReading(token: string, reading: string) {
        const parts = this.splitJapaneseReadingParts(token);
        const alignment = this.alignTokenWithReading(parts, reading);
        if (!alignment) return this.formatPlainLyricText(token);

        return parts
            .map((part, idx) => {
                if (part.type === "kana") return this.formatPlainLyricText(part.text);
                const rubyReading = alignment.kanjiReadings[idx];
                return rubyReading
                    ? this.renderRuby(part.text, rubyReading)
                    : this.formatPlainLyricText(part.text);
            })
            .join("");
    }

    private static splitJapaneseReadingParts(text: string): JapaneseReadingPart[] {
        const matches =
            text.match(/[一-龯々〆ヶ]+|[ぁ-ゖァ-ヺー]+|[^一-龯々〆ヶぁ-ゖァ-ヺー]+/gu) ?? [];
        return matches.map(
            (part): JapaneseReadingPart => ({
                text: part,
                type: this.hasKanji(part)
                    ? "kanji"
                    : /^[ぁ-ゖァ-ヺー]+$/u.test(part)
                      ? "kana"
                      : "other",
            }),
        );
    }

    private static alignTokenWithReading(
        parts: JapaneseReadingPart[],
        reading: string,
    ): FuriganaAlignment | null {
        if (!reading) return null;
        let cursor = 0;
        const kanjiReadings: Record<number, string> = {};
        let score = 0;

        for (let idx = 0; idx < parts.length; idx++) {
            const part = parts[idx];
            if (part.type !== "kana") continue;

            const previousKanjiIndex = this.findPreviousKanjiPartIndex(parts, idx);
            const options = this.kanaPronunciationOptions(part.text);
            const match = this.findEarliestKanaMatch(reading, options, cursor);
            if (!match) return null;

            if (previousKanjiIndex !== null) {
                const inferred = reading.slice(cursor, match.index);
                if (!inferred) return null;
                kanjiReadings[previousKanjiIndex] = inferred;
            } else if (match.index !== cursor) {
                return null;
            }

            cursor = match.index + match.length;
            score += 80;
        }

        const trailingKanjiIndex = this.findTrailingKanjiPartIndex(parts);
        if (trailingKanjiIndex !== null) {
            const inferred = reading.slice(cursor);
            if (!inferred) return null;
            kanjiReadings[trailingKanjiIndex] = inferred;
            cursor = reading.length;
            score += 60;
        } else if (cursor !== reading.length) {
            return null;
        }

        const annotatedLength = Object.values(kanjiReadings).reduce(
            (sum, value) => sum + value.length,
            0,
        );
        if (!annotatedLength) return null;
        score += annotatedLength;
        return { kanjiReadings, score };
    }

    private static findPreviousKanjiPartIndex(parts: JapaneseReadingPart[], kanaIndex: number) {
        for (let idx = kanaIndex - 1; idx >= 0; idx--) {
            if (parts[idx].type === "kanji") return idx;
            if (parts[idx].type === "kana") return null;
        }
        return null;
    }

    private static findTrailingKanjiPartIndex(parts: JapaneseReadingPart[]) {
        for (let idx = parts.length - 1; idx >= 0; idx--) {
            if (parts[idx].type === "kanji") return idx;
            if (parts[idx].type === "kana") return null;
        }
        return null;
    }

    private static findEarliestKanaMatch(reading: string, options: string[], start: number) {
        let best: { index: number; length: number } | null = null;
        for (const option of options) {
            const index = reading.indexOf(option, start);
            if (index === -1) continue;
            if (
                !best ||
                index < best.index ||
                (index === best.index && option.length > best.length)
            ) {
                best = { index, length: option.length };
            }
        }
        return best;
    }

    private static romanizationToHiragana(text: string) {
        const kanaText = this.normalizeKana(text);
        if (/^[ぁ-ゖー]+$/u.test(kanaText)) return kanaText;

        let romaji = text
            .toLowerCase()
            .replace(/ā/g, "aa")
            .replace(/ī/g, "ii")
            .replace(/ū/g, "uu")
            .replace(/ē/g, "ee")
            .replace(/[ōô]/g, "ou")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z']/g, "");
        let output = "";

        const table: Record<string, string> = {
            kya: "きゃ",
            kyu: "きゅ",
            kyo: "きょ",
            gya: "ぎゃ",
            gyu: "ぎゅ",
            gyo: "ぎょ",
            sha: "しゃ",
            shu: "しゅ",
            sho: "しょ",
            sya: "しゃ",
            syu: "しゅ",
            syo: "しょ",
            ja: "じゃ",
            ju: "じゅ",
            jo: "じょ",
            jya: "じゃ",
            jyu: "じゅ",
            jyo: "じょ",
            cha: "ちゃ",
            chu: "ちゅ",
            cho: "ちょ",
            cya: "ちゃ",
            cyu: "ちゅ",
            cyo: "ちょ",
            nya: "にゃ",
            nyu: "にゅ",
            nyo: "にょ",
            hya: "ひゃ",
            hyu: "ひゅ",
            hyo: "ひょ",
            bya: "びゃ",
            byu: "びゅ",
            byo: "びょ",
            pya: "ぴゃ",
            pyu: "ぴゅ",
            pyo: "ぴょ",
            mya: "みゃ",
            myu: "みゅ",
            myo: "みょ",
            rya: "りゃ",
            ryu: "りゅ",
            ryo: "りょ",
            fa: "ふぁ",
            fi: "ふぃ",
            fe: "ふぇ",
            fo: "ふぉ",
            va: "ゔぁ",
            vi: "ゔぃ",
            vu: "ゔ",
            ve: "ゔぇ",
            vo: "ゔぉ",
            shi: "し",
            chi: "ち",
            tsu: "つ",
            fu: "ふ",
            ji: "じ",
            a: "あ",
            i: "い",
            u: "う",
            e: "え",
            o: "お",
            ka: "か",
            ki: "き",
            ku: "く",
            ke: "け",
            ko: "こ",
            ga: "が",
            gi: "ぎ",
            gu: "ぐ",
            ge: "げ",
            go: "ご",
            sa: "さ",
            si: "し",
            su: "す",
            se: "せ",
            so: "そ",
            za: "ざ",
            zi: "じ",
            zu: "ず",
            ze: "ぜ",
            zo: "ぞ",
            ta: "た",
            ti: "ち",
            tu: "つ",
            te: "て",
            to: "と",
            da: "だ",
            di: "ぢ",
            du: "づ",
            de: "で",
            do: "ど",
            na: "な",
            ni: "に",
            nu: "ぬ",
            ne: "ね",
            no: "の",
            ha: "は",
            hi: "ひ",
            hu: "ふ",
            he: "へ",
            ho: "ほ",
            ba: "ば",
            bi: "び",
            bu: "ぶ",
            be: "べ",
            bo: "ぼ",
            pa: "ぱ",
            pi: "ぴ",
            pu: "ぷ",
            pe: "ぺ",
            po: "ぽ",
            ma: "ま",
            mi: "み",
            mu: "む",
            me: "め",
            mo: "も",
            ya: "や",
            yu: "ゆ",
            yo: "よ",
            ra: "ら",
            ri: "り",
            ru: "る",
            re: "れ",
            ro: "ろ",
            wa: "わ",
            wi: "うぃ",
            we: "うぇ",
            wo: "を",
        };

        while (romaji) {
            if (/^([bcdfghjklmpqrstvwxyz])\1/.test(romaji) && !romaji.startsWith("nn")) {
                output += "っ";
                romaji = romaji.slice(1);
                continue;
            }
            if (romaji.startsWith("n'") || /^n($|[^aeiouy])/.test(romaji)) {
                output += "ん";
                romaji = romaji.startsWith("n'") ? romaji.slice(2) : romaji.slice(1);
                continue;
            }

            let matched = false;
            for (const length of [3, 2, 1]) {
                const key = romaji.slice(0, length);
                const kana = table[key];
                if (!kana) continue;
                output += kana;
                romaji = romaji.slice(length);
                matched = true;
                break;
            }
            if (!matched) romaji = romaji.slice(1);
        }

        return output;
    }

    private static normalizeKana(text: string) {
        return Array.from(text.normalize("NFKC"))
            .map((char) => {
                const code = char.charCodeAt(0);
                if (code >= 0x30a1 && code <= 0x30f6) {
                    return String.fromCharCode(code - 0x60);
                }
                return char;
            })
            .join("");
    }

    private static pronouncedKana(text: string) {
        return this.normalizeKana(text)
            .replace(/は/g, "わ")
            .replace(/へ/g, "え")
            .replace(/を/g, "お");
    }

    private static kanaPronunciationOptions(text: string) {
        const normalized = this.normalizeKana(text);
        const pronounced = this.pronouncedKana(normalized);
        return normalized === pronounced ? [normalized] : [normalized, pronounced];
    }

    private static renderRuby(base: string, reading: string) {
        return `<ruby><rb>${this.formatPlainLyricText(base)}</rb><rt>${this.escapeHtml(reading)}</rt></ruby>`;
    }

    private static hasKanji(text: string) {
        return /[一-龯々〆ヶ]/u.test(text);
    }

    private static startLoop() {
        this.stopLoop();
        const tick = () => {
            if (!this.container || !this.isSynced) return;
            const progress = Spicetify.Player?.getProgress?.() ?? 0;
            this.updateActive(progress);
            const delay = Spicetify.Player.isPlaying() ? this.getNextPlaybackDelay(progress) : 250;
            this.updateTimer = setTimeout(tick, delay);
        };
        tick();
    }

    private static stopLoop() {
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = null;
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
        this.applyTransforms();
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
                        animations: [],
                    },
                ];
            });
        });
    }

    private static buildPlaybackBoundaries() {
        const boundaries = this.timedLines.map((line) => line.time);
        this.karaokeWordsByLine.forEach((words) => {
            words.forEach((word) => {
                boundaries.push(
                    word.time,
                    word.effectiveEnd,
                    word.effectiveEnd + word.releaseDuration,
                );
            });
        });
        this.playbackBoundaries = Array.from(new Set(boundaries))
            .filter((time) => Number.isFinite(time) && time >= 0)
            .sort((a, b) => a - b);
    }

    private static getNextPlaybackDelay(progress: number) {
        let low = 0;
        let high = this.playbackBoundaries.length - 1;
        let nextBoundary: number | null = null;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const boundary = this.playbackBoundaries[middle];
            if (boundary > progress + 2) {
                nextBoundary = boundary;
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }
        if (nextBoundary === null) return 250;
        return Math.max(12, Math.min(250, nextBoundary - progress));
    }

    private static resetKaraokeLine(lineIndex: number) {
        if (lineIndex < 0) return;
        this.karaokeWordsByLine[lineIndex]?.forEach((word) => {
            word.animations.forEach((animation) => animation.cancel());
            word.animations = [];
            word.node.classList.remove("active", "finished", "glowing");
            word.node.style.removeProperty("--karaoke-progress");
            word.node.style.removeProperty("--karaoke-lift");
            word.node.style.removeProperty("--karaoke-scale");
            word.node.style.removeProperty("--karaoke-glow");
        });
        if (this.karaokeAnimationLine === lineIndex) {
            this.karaokeAnimationLine = -1;
            this.karaokeAnimationsPlaying = false;
        }
    }

    private static scheduleKaraokeLine(progress: number, isPlaying: boolean) {
        this.cancelKaraokeAnimations();
        const words = this.karaokeWordsByLine[this.activeIndex];
        const lineTime = this.lines[this.activeIndex]?.time;
        if (!words?.length || lineTime === null || lineTime === undefined) return;

        this.ensureKaraokePropertiesRegistered();
        const lineProgress = Math.max(0, progress - lineTime);
        words.forEach((word) => {
            const delay = Math.max(0, word.time - lineTime);
            const motion = word.node.animate(this.buildKaraokeMotionKeyframes(), {
                delay,
                duration: word.effectiveDuration,
                fill: "both",
                easing: "linear",
            });
            const glow = word.node.animate(this.buildKaraokeGlowKeyframes(word), {
                delay,
                duration: word.effectiveDuration + word.releaseDuration,
                fill: "both",
                easing: "linear",
            });
            word.animations = [motion, glow];
            word.animations.forEach((animation) => {
                animation.pause();
                animation.currentTime = lineProgress;
                if (isPlaying) animation.play();
            });
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
            word.animations.forEach((animation) => {
                animation.pause();
                animation.currentTime = expectedTime;
                if (isPlaying) animation.play();
            });
        });
        this.karaokeAnimationsPlaying = isPlaying;
    }

    private static updateKaraokeWordClasses(words: KaraokeWordRenderState[], progress: number) {
        words.forEach((word) => {
            const active = progress >= word.time && progress < word.effectiveEnd;
            const releasing =
                progress >= word.effectiveEnd &&
                progress < word.effectiveEnd + word.releaseDuration;
            word.node.classList.toggle("active", active);
            word.node.classList.toggle("finished", progress >= word.effectiveEnd);
            word.node.classList.toggle("glowing", active || releasing);
        });
    }

    private static buildKaraokeMotionKeyframes() {
        return Array.from({ length: 21 }, (_, index) => {
            const progress = index / 20;
            const eased = progress * progress * (3 - 2 * progress);
            const lift = 0.05 + (-0.07 - 0.05) * eased;
            const scale = 0.998 + (1.012 - 0.998) * eased;
            return {
                offset: progress,
                "--karaoke-progress": `${progress * 100}`,
                "--karaoke-lift": `${lift}em`,
                "--karaoke-scale": `${scale}`,
            } as Keyframe;
        });
    }

    private static buildKaraokeGlowKeyframes(word: KaraokeWordRenderState) {
        const totalDuration = word.effectiveDuration + word.releaseDuration;
        const activeOffset = word.effectiveDuration / totalDuration;
        const keyframes: Keyframe[] = [
            {
                offset: 0,
                "--karaoke-glow": "0",
            } as Keyframe,
            {
                offset: activeOffset,
                "--karaoke-glow": `${word.peakGlow}`,
            } as Keyframe,
        ];
        for (let index = 1; index <= 10; index++) {
            const releaseProgress = index / 10;
            const eased = releaseProgress * releaseProgress * (3 - 2 * releaseProgress);
            keyframes.push({
                offset: activeOffset + (1 - activeOffset) * releaseProgress,
                "--karaoke-glow": `${word.peakGlow * (1 - eased)}`,
            } as Keyframe);
        }
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
        this.karaokeWordsByLine.forEach((words) => {
            words.forEach((word) => {
                word.animations.forEach((animation) => animation.cancel());
                word.animations = [];
            });
        });
        this.karaokeAnimationLine = -1;
        this.karaokeAnimationsPlaying = false;
        this.lastKaraokeProgress = null;
        this.lastKaraokeClockTime = 0;
    }

    private static applyTransforms(skipAnimation = false) {
        if (!this.isSynced) return;
        if (!this.lyricsRoot || !this.lineNodes.length) return;
        if (!this.lineHeights.length || this.lineHeights.length !== this.lineNodes.length) {
            this.measureHeights();
        }
        const hasActive = this.activeIndex >= 0;
        const current = Math.max(
            0,
            Math.min(hasActive ? this.activeIndex : 0, this.lineNodes.length - 1),
        );
        this.lineNodes.forEach((node, idx) =>
            node.classList.toggle("active", hasActive && idx === current),
        );

        const fontSize = this.getFontSize();
        if (Math.abs(fontSize - this.lastMeasuredFontSize) > 0.5) {
            this.measureHeights();
        }
        const baseGap = Math.max(22, Math.min(58, fontSize * 1.0));
        const containerHeight = this.containerHeight || this.lyricsRoot.clientHeight || 1;
        const centerY = containerHeight * 0.38;
        const baseIndent = Math.max(12, Math.min(36, fontSize * 0.8));

        const transforms: {
            top: number;
            scale: number;
            blur: number;
            opacity: number;
            delay: number;
            translate: number;
        }[] = new Array(this.lineNodes.length).fill(null as never);

        const scaleByOffset = (offset: number) => Math.max(0.72, 1 - 0.12 * offset);
        const blurByOffset = (offset: number) => Math.min(4.5, offset * 0.9);
        const opacityByOffset = (offset: number) =>
            Math.max(0.32, 1 - Math.max(0, offset - 1) * 0.22);
        const translateByOffset = (offset: number) => Math.max(0, baseIndent - offset * 6);
        const delayByOffset = (offset: number) => Math.min(6, offset) * 45;

        if (!hasActive) {
            const firstHeight = this.lineHeights[0] || fontSize * 1.1;
            const firstScale = scaleByOffset(1);
            let runningTop = centerY + (firstHeight * firstScale) / 2 + baseGap;
            for (let i = 0; i < this.lineNodes.length; i++) {
                const offset = i + 1;
                const scale = scaleByOffset(offset);
                const blur = blurByOffset(offset);
                const opacity = opacityByOffset(offset);
                transforms[i] = {
                    top: runningTop,
                    scale,
                    blur,
                    opacity,
                    delay: 0,
                    translate: translateByOffset(offset),
                };
                const h = (this.lineHeights[i] || fontSize) * scale;
                runningTop += h + baseGap;
            }
        } else {
            transforms[current] = {
                top: centerY - this.lineHeights[current] / 2,
                scale: 1,
                blur: 0,
                opacity: 1,
                delay: 0,
                translate: translateByOffset(0),
            };

            for (let i = current - 1; i >= 0; i--) {
                const offset = current - i;
                const scale = scaleByOffset(offset);
                const height = this.lineHeights[i] * scale;
                const top = transforms[i + 1].top - height - baseGap;
                transforms[i] = {
                    top,
                    scale,
                    blur: blurByOffset(offset),
                    opacity: opacityByOffset(offset),
                    delay: delayByOffset(offset),
                    translate: translateByOffset(offset),
                };
            }

            for (let i = current + 1; i < this.lineNodes.length; i++) {
                const offset = i - current;
                const scale = scaleByOffset(offset);
                const height = this.lineHeights[i - 1] * transforms[i - 1].scale;
                const top = transforms[i - 1].top + height + baseGap;
                transforms[i] = {
                    top,
                    scale,
                    blur: blurByOffset(offset),
                    opacity: opacityByOffset(offset),
                    delay: delayByOffset(offset),
                    translate: translateByOffset(offset),
                };
            }
        }

        this.lineNodes.forEach((node, idx) => {
            const t = transforms[idx];
            if (!t) return;
            const duration = skipAnimation ? 0 : 520;
            node.style.transitionDuration = `${duration}ms`;
            node.style.transitionDelay = `${skipAnimation ? 0 : t.delay}ms`;
            node.style.transitionTimingFunction = "var(--lyric-timing-function, ease)";
            node.style.transform = `translate3d(${t.translate}px, ${t.top}px, 0) scale(${t.scale})`;
            node.style.opacity = `${t.opacity}`;
            node.style.filter = t.blur ? `blur(${t.blur}px)` : "none";
        });
    }

    private static measureHeights() {
        if (!this.lyricsRoot) return;
        this.lineHeights = this.lineNodes.map(
            (node) => node.offsetHeight || node.scrollHeight || 0,
        );
        this.containerHeight = this.lyricsRoot.clientHeight;
        this.lastMeasuredFontSize = this.getFontSize();
    }

    private static setupResizeObserver() {
        if (!this.lyricsRoot || typeof ResizeObserver === "undefined") return;
        this.stopResizeObserver();
        this.resizeObserver = new ResizeObserver(() => {
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

    static getDebugInfo() {
        return {
            status: this.lastStatus,
            isSynced: this.isSynced,
            lines: this.lastLines,
            thirdParty: getThirdPartyLyricsDebug(),
        };
    }
}
