import { DOM } from "../../elements";
import CFM from "../../../utils/config";
import {
    EnhancedLyricLine,
    enhanceWithThirdPartyLyrics,
    getThirdPartyLyricsDebug,
} from "../../../services/third-party-lyrics";

type LyricLine = EnhancedLyricLine;

export class Lyrics {
    private static readonly REQUEST_TIMEOUT_MS = 12000;
    private static readonly RETRY_DELAYS_MS = [0, 900, 1800, 3200];
    private static container: HTMLElement | null = null;
    private static lyricsRoot: HTMLElement | null = null;
    private static scrollbarThumb: HTMLElement | null = null;
    private static lineNodes: HTMLElement[] = [];
    private static lineHeights: number[] = [];
    private static containerHeight = 0;
    private static lines: LyricLine[] = [];
    private static activeIndex = -1;
    private static rafId: number | null = null;
    private static resizeObserver: ResizeObserver | null = null;
    private static lastMeasuredFontSize = 0;
    private static isSynced = false;
    private static lastStatus: "synced" | "unsynced" | "unavailable" | "loading" = "unavailable";
    private static lastLines: LyricLine[] = [];
    private static loadSequence = 0;

    static attach(container: HTMLElement) {
        this.container = container;
    }

    static teardown() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
        this.lines = [];
        this.lineNodes = [];
        this.lineHeights = [];
        this.containerHeight = 0;
        this.activeIndex = -1;
        this.stopResizeObserver();
        this.lastMeasuredFontSize = 0;
        this.scrollbarThumb = null;
        this.lyricsRoot = null;
        this.container = null;
        this.isSynced = false;
        this.lastStatus = "unavailable";
        this.lastLines = [];
        this.loadSequence += 1;
    }

    static toggleLyrics() {
        DOM.container.classList.toggle("lyrics-hide-force");
    }

    static async loadLyrics(trackUri?: string) {
        const sequence = ++this.loadSequence;
        if (!CFM.get("lyricsDisplay") || !trackUri) {
            this.renderStatus("Lyrics unavailable", true);
            return;
        }
        this.lastStatus = "loading";
        this.renderStatus("Loading lyrics…", false);
        const trackId = trackUri?.split(":").pop();
        if (!trackId) {
            this.renderStatus("Lyrics unavailable", true);
            return;
        }
        try {
            const response = await this.getLyricsWithRetry(trackId, sequence);
            if (!this.isCurrentLoad(sequence)) return;
            if (CFM.get("thirdPartyLyrics")) {
                const thirdPartyLines = await enhanceWithThirdPartyLyrics(
                    this.normalizeLines(response?.lyrics?.lines),
                );
                if (!this.isCurrentLoad(sequence)) return;
                if (thirdPartyLines.length) {
                    this.applyLines(thirdPartyLines);
                    return;
                }
            }
            const lines = this.normalizeLines(response?.lyrics?.lines);
            if (!lines.length) {
                this.renderStatus("Lyrics unavailable", true);
                return;
            }
            this.applyLines(lines);
        } catch (err) {
            if (!this.isCurrentLoad(sequence)) return;
            if (CFM.get("thirdPartyLyrics")) {
                const thirdPartyLines = await enhanceWithThirdPartyLyrics([]);
                if (!this.isCurrentLoad(sequence)) return;
                if (thirdPartyLines.length) {
                    this.applyLines(thirdPartyLines);
                    return;
                }
            }
            this.renderStatus("Lyrics unavailable", true);
        }
    }

    // ---- internal helpers ----

    private static async getLyricsWithRetry(trackId: string, sequence: number) {
        const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&market=from_token`;
        let lastError: unknown;

        for (let attempt = 0; attempt < this.RETRY_DELAYS_MS.length; attempt++) {
            if (!this.isCurrentLoad(sequence)) throw new Error("Lyrics load superseded");
            const delay = this.RETRY_DELAYS_MS[attempt];
            if (delay) await this.sleep(delay);
            if (!this.isCurrentLoad(sequence)) throw new Error("Lyrics load superseded");

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

    private static isCurrentLoad(sequence: number) {
        return sequence === this.loadSequence;
    }

    private static renderStatus(text: string, unavailable: boolean) {
        if (!this.container) return;
        this.stopResizeObserver();
        this.lines = [];
        this.lineNodes = [];
        this.lineHeights = [];
        this.containerHeight = 0;
        this.activeIndex = -1;
        this.lastMeasuredFontSize = 0;
        this.lyricsRoot = null;
        this.scrollbarThumb = null;
        this.lastLines = [];
        this.isSynced = false;
        this.lastStatus = unavailable ? "unavailable" : "loading";
        if (unavailable) DOM.container.classList.add("lyrics-unavailable");
        else DOM.container.classList.remove("lyrics-unavailable");
        this.stopLoop();
        this.container.innerHTML = `<div class="lyrics-wrapper"><div class="lyrics-status">${text}</div></div>`;
    }

    private static applyLines(lines: LyricLine[]) {
        const timeValues = lines.map((line) => line.time).filter((t): t is number => t !== null);
        const lastTime = timeValues.length ? timeValues[timeValues.length - 1] : null;
        const hasNonZero = timeValues.some((t) => t > 0);
        this.isSynced = Boolean(timeValues.length && hasNonZero && (lastTime ?? 0) > 0);
        this.stopLoop();
        this.lines = lines;
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
                <div class="rnp-lyrics-scrollbar">
                    <div class="rnp-lyrics-scrollbar-thumb"></div>
                </div>
            </div>`;
        this.lyricsRoot = this.container.querySelector(".rnp-lyrics") as HTMLElement;
        this.scrollbarThumb = this.container.querySelector(
            ".rnp-lyrics-scrollbar-thumb",
        ) as HTMLElement;
        this.lineNodes = Array.from(
            this.container.querySelectorAll<HTMLElement>(".rnp-lyrics-line"),
        );
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
        const showKaraoke = CFM.get("karaokeLyrics") && Boolean(line.words?.length);
        const original = showKaraoke
            ? `<div class="rnp-lyrics-line-karaoke">${line
                  .words!.map((word) => this.renderKaraokeWord(word))
                  .join("")}</div>`
            : `<div class="rnp-lyrics-line-original">${this.formatLyricText(line.text)}</div>`;

        const romanization =
            CFM.get("showLyricsRomanization") && line.romanization
                ? `<div class="rnp-lyrics-line-romaji">${this.escapeHtml(line.romanization)}</div>`
                : "";
        const furigana =
            CFM.get("showLyricsFurigana") && line.furigana
                ? `<div class="rnp-lyrics-line-furigana">${this.escapeHtml(line.furigana)}</div>`
                : "";
        const translation =
            CFM.get("showLyricsTranslation") && line.translation
                ? `<div class="rnp-lyrics-line-translated">${this.escapeHtml(line.translation)}</div>`
                : "";

        return `${original}${furigana}${romanization}${translation}`;
    }

    private static renderKaraokeWord(word: NonNullable<LyricLine["words"]>[number]) {
        const segments = this.splitKaraokeText(word.text);
        if (segments.length <= 1) {
            return this.renderKaraokeWordSegment(word.text, word.time, word.duration);
        }

        const weights = segments.map((segment) => this.getTextTimingWeight(segment));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
        let offset = 0;

        return segments
            .map((segment, idx) => {
                const remaining = word.duration - offset;
                const duration =
                    idx === segments.length - 1
                        ? remaining
                        : (word.duration * weights[idx]) / totalWeight;
                const html = this.renderKaraokeWordSegment(segment, word.time + offset, duration);
                offset += duration;
                return html;
            })
            .join("");
    }

    private static renderKaraokeWordSegment(text: string, time: number, duration: number) {
        return `<span class="rnp-karaoke-word" data-time="${time}" data-duration="${duration}"><span>${this.formatLyricText(text)}</span></span>`;
    }

    private static splitKaraokeText(text: string) {
        return (
            text
                .match(
                    /.*?(?:[\t \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉]+|$)/gu,
                )
                ?.filter(Boolean) ?? [text]
        );
    }

    private static getTextTimingWeight(text: string) {
        return Math.max(
            1,
            Array.from(text).filter(
                (char) =>
                    !/^[\t \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/.test(char),
            ).length,
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

    private static formatLyricText(text: string) {
        return this.escapeHtml(text)
            .replace(/([\t \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+)/g, "$1<wbr>")
            .replace(/([,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉]+)/g, "$1<wbr>");
    }

    private static startLoop() {
        this.stopLoop();
        const tick = () => {
            this.updateActive();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    private static stopLoop() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    private static updateActive() {
        if (!this.isSynced) return;
        if (!this.container || !this.lines.length) return;
        const progress = Spicetify.Player?.getProgress?.() ?? 0;
        let nextIndex = -1;

        for (let i = 0; i < this.lines.length; i++) {
            const t = this.lines[i].time;
            if (t === null) continue;
            if (t <= progress) nextIndex = i;
            else break;
        }

        if (nextIndex === this.activeIndex) {
            this.updateKaraokeProgress(progress);
            return;
        }

        this.activeIndex = nextIndex;
        this.applyTransforms();
        this.updateKaraokeProgress(progress);
    }

    private static updateKaraokeProgress(progress: number) {
        if (this.activeIndex < 0 || !CFM.get("karaokeLyrics")) return;
        const activeLine = this.lineNodes[this.activeIndex];
        if (!activeLine) return;

        this.lineNodes.forEach((lineNode, idx) => {
            if (idx === this.activeIndex) return;
            lineNode.querySelectorAll<HTMLElement>(".rnp-karaoke-word").forEach((wordNode) => {
                wordNode.style.setProperty("--karaoke-progress", "0%");
                wordNode.style.setProperty("--karaoke-lift", "0em");
                wordNode.style.setProperty("--karaoke-scale", "1");
                wordNode.style.setProperty("--karaoke-glow", "0");
                wordNode.classList.remove("active", "finished", "glowing");
            });
        });

        const currentLine = this.lines[this.activeIndex];
        const nextLine = this.lines[this.activeIndex + 1];
        const lineEndCandidates = [
            currentLine?.time !== null && currentLine?.duration
                ? currentLine.time + currentLine.duration
                : null,
            nextLine?.time ?? null,
        ].filter((time): time is number => Number.isFinite(time));
        const lineEnd = lineEndCandidates.length ? Math.min(...lineEndCandidates) : null;
        const wordNodes = Array.from(activeLine.querySelectorAll<HTMLElement>(".rnp-karaoke-word"));

        wordNodes.forEach((wordNode, idx) => {
            const time = Number(wordNode.dataset.time);
            const duration = Number(wordNode.dataset.duration);
            if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
            const nextWordTime = Number(wordNodes[idx + 1]?.dataset.time);
            const wordEndCandidates = [
                time + duration,
                Number.isFinite(nextWordTime) ? nextWordTime : null,
                idx === wordNodes.length - 1 ? lineEnd : null,
            ].filter((end): end is number => Number.isFinite(end) && end > time);
            const effectiveEnd = wordEndCandidates.length
                ? Math.min(...wordEndCandidates)
                : time + duration;
            const effectiveDuration = Math.max(80, effectiveEnd - time);
            const percent = Math.max(0, Math.min(1, (progress - time) / effectiveDuration));
            const eased = percent * percent * (3 - 2 * percent);
            const lift = 0.05 + (-0.07 - 0.05) * eased;
            const scale = 0.998 + (1.012 - 0.998) * eased;
            const isActive = progress >= time && progress < effectiveEnd;
            const glowLevelMs = 100;
            const maxGlowLevel = 10;
            const peakGlowLevel = Math.min(
                maxGlowLevel,
                Math.ceil(effectiveDuration / glowLevelMs),
            );
            const activeGlowLevel = Math.min(
                peakGlowLevel,
                Math.max(0, (progress - time) / glowLevelMs),
            );
            const activeGlow = activeGlowLevel / maxGlowLevel;
            const peakGlow = peakGlowLevel / maxGlowLevel;
            const releaseDuration = Math.max(700, peakGlow * 1000);
            const releaseAge = progress - effectiveEnd;
            const isReleasing = releaseAge >= 0 && releaseAge < releaseDuration;
            const releaseProgress = Math.max(0, Math.min(1, releaseAge / releaseDuration));
            const releaseEase = releaseProgress * releaseProgress * (3 - 2 * releaseProgress);
            const glow = progress < time ? 0 : isActive ? activeGlow : peakGlow * (1 - releaseEase);
            wordNode.style.setProperty("--karaoke-progress", `${percent * 100}%`);
            wordNode.style.setProperty("--karaoke-lift", `${lift.toFixed(3)}em`);
            wordNode.style.setProperty("--karaoke-scale", `${scale.toFixed(3)}`);
            wordNode.style.setProperty("--karaoke-glow", `${glow.toFixed(3)}`);
            wordNode.classList.toggle("active", isActive);
            wordNode.classList.toggle("finished", percent >= 1);
            wordNode.classList.toggle("glowing", isActive || isReleasing);
        });
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

        this.updateScrollbar(hasActive ? current : 0, containerHeight);
    }

    private static updateScrollbar(current: number, containerHeight: number) {
        if (!this.scrollbarThumb) return;
        const total = Math.max(1, this.lines.length);
        const thumbHeight = Math.max(containerHeight / total, 28);
        const track = containerHeight - thumbHeight;
        const perStep = total > 1 ? track / (total - 1) : 0;
        this.scrollbarThumb.style.height = `${thumbHeight}px`;
        this.scrollbarThumb.style.top = `${Math.max(0, Math.min(track, perStep * current))}px`;
        this.scrollbarThumb.classList.toggle("no-scroll", total <= 1);
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

    private static normalizeLines(raw: any): LyricLine[] {
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
                return { text, time: Number.isFinite(parsed ?? NaN) ? parsed! : null };
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
