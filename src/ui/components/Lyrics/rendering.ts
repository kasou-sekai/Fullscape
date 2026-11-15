import { richRuby } from "../../../services/lyrics-rich-document";
import { mergeFuriganaAnnotations, parseFuriganaMarkup } from "../../../utils/furigana";
import type { FuriganaAnnotation, FuriganaRenderData } from "../../../utils/furigana";
import {
    convertChineseText,
    convertFuriganaRenderData,
    getTranslationPresentation,
} from "../../../utils/chinese-conversion";
import type { LyricsChineseConversion } from "../../../utils/chinese-conversion";
import { escapeHtml } from "../../../utils/escape-html";
import { detectTextLanguage } from "../../../utils/text-language";
import { getTextLanguageTag } from "../../../utils/text-presentation";
import type { EnhancedLyricLine, LyricWord } from "../../../services/third-party-lyrics";

type TimedKaraokeSegment = {
    text: string;
    time: number;
    duration: number;
    start: number;
};

export type LyricRenderOptions = {
    chineseConversion: LyricsChineseConversion;
    translationConversion: LyricsChineseConversion;
    songLanguage: ReturnType<typeof detectTextLanguage>;
    songLanguageTag: string;
    showKaraoke: boolean;
    showFurigana: boolean;
    showRomanization: boolean;
    showTranslation: boolean;
    dictionaryFurigana?: FuriganaRenderData | null;
};

export function renderLyricLineContent(line: EnhancedLyricLine, options: LyricRenderOptions) {
    const detectedLineLanguage = getTextLanguageTag(
        line.text,
        options.songLanguage,
        options.chineseConversion,
    );
    const lineLanguage =
        detectedLineLanguage.startsWith("zh") && options.songLanguageTag.startsWith("zh")
            ? options.songLanguageTag
            : detectedLineLanguage;
    const originalConversion = detectedLineLanguage.startsWith("zh")
        ? options.chineseConversion
        : "original";
    const languageAttributes = `lang="${lineLanguage}" data-text-language="${lineLanguage}"`;
    const showKaraoke =
        options.showKaraoke && Boolean(line.words?.some((word) => word.text.trim()));
    const words = (line.words ?? []).map((word) => ({
        ...word,
        text: convertChineseText(word.text, originalConversion),
    }));
    const providedFurigana = line.presentation
        ? richRuby(line)
        : parseFuriganaMarkup(line.text, line.furigana);
    const renderFurigana = options.dictionaryFurigana
        ? {
              text: providedFurigana.text,
              annotations: mergeFuriganaAnnotations(
                  providedFurigana.annotations,
                  options.dictionaryFurigana.annotations,
              ),
          }
        : providedFurigana;
    const furigana = convertFuriganaRenderData(renderFurigana, originalConversion);
    const visibleAnnotations = options.showFurigana ? furigana.annotations : [];
    const karaokeText = words.map((word) => word.text).join("");
    const karaokeAnnotations = karaokeText === furigana.text ? visibleAnnotations : [];
    const furiganaClass = karaokeAnnotations.length ? " rnp-lyrics-has-furigana" : "";
    const original = showKaraoke
        ? `<div class="rnp-lyrics-line-karaoke${furiganaClass}" ${languageAttributes}>${renderKaraokeLine(words, karaokeAnnotations)}</div>`
        : `<div class="rnp-lyrics-line-original${visibleAnnotations.length ? " rnp-lyrics-has-furigana" : ""}" ${languageAttributes}>${formatLyricText(furigana.text, visibleAnnotations)}</div>`;

    const romanization =
        options.showRomanization && line.romanization
            ? `<div class="rnp-lyrics-line-romaji" lang="en" data-text-language="en">${escapeHtml(convertChineseText(line.romanization, originalConversion))}</div>`
            : "";
    const translated = getTranslationPresentation(
        line.translation ?? "",
        options.translationConversion,
    );
    const translation =
        line.translation && line.translation.trim() !== "//"
            ? `<div ${options.showTranslation ? "" : "hidden"} class="rnp-lyrics-line-translated" lang="${translated.language}" data-text-language="${translated.language}">${escapeHtml(translated.text)}</div>`
            : "";

    return `${original}${romanization}${translation}`;
}

function renderKaraokeLine(words: LyricWord[], annotations: FuriganaAnnotation[]) {
    const text = words.map((word) => word.text).join("");
    const wordStarts = getSemanticWordStarts(text);
    removeBoundariesInsideAnnotations(wordStarts, annotations);
    const splitOffsets = new Set([
        ...wordStarts,
        ...annotations.flatMap((annotation) => [annotation.start, annotation.end]),
    ]);
    const segments = splitKaraokeSegmentsAtOffsets(
        words.flatMap(splitTimedKaraokeWord),
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
        if (hasPreferredBreakAtStart(segment.text) && (semanticWord || phrase)) {
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
        semanticWord += renderKaraokeWordSegment(segment.text, segment.time, segment.duration);
        const segmentEnd = segment.start + segment.text.length;
        if (activeAnnotation && segmentEnd >= activeAnnotation.end) {
            semanticWord += `</span><rt lang="ja" data-time="${annotationStartTime}" data-duration="${Math.max(
                80,
                annotationEndTime - annotationStartTime,
            )}">${escapeHtml(activeAnnotation.reading)}</rt></ruby>`;
            activeAnnotation = null;
        }
        if (!hasPreferredBreakAtEnd(segment.text)) return;
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

function splitTimedKaraokeWord(word: LyricWord) {
    const segments = splitLyricTextAtPreferredBreaks(word.text);
    const durations = allocateDuration(word.duration, segments.map(getTextTimingWeight));
    let offset = 0;
    return segments.map((text, index) => {
        const segment = {
            text,
            time: word.time + offset,
            duration: durations[index],
        };
        offset += segment.duration;
        return segment;
    });
}

function getSemanticWordStarts(text: string) {
    const starts = new Set<number>();
    if (!("Segmenter" in Intl)) return starts;
    try {
        const segmenter = new Intl.Segmenter(getSegmentationLocale(text), {
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

function getSegmentationLocale(text: string) {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
    if (/\p{Script=Hangul}/u.test(text)) return "ko";
    if (/\p{Script=Thai}/u.test(text)) return "th";
    if (/\p{Script=Han}/u.test(text)) return "zh";
    return undefined;
}

function splitKaraokeSegmentsAtOffsets(
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
        const durations = allocateDuration(segment.duration, texts.map(getTextTimingWeight));
        let timeOffset = 0;
        let textOffset = 0;

        texts.forEach((text, index) => {
            const duration = durations[index];
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

function allocateDuration(duration: number, weights: number[]) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let offset = 0;
    return weights.map((weight, index) => {
        const remaining = Math.max(0, duration - offset);
        const allocated =
            index === weights.length - 1 ? remaining : (duration * weight) / totalWeight;
        offset += allocated;
        return allocated;
    });
}

function hasPreferredBreakAtEnd(text: string) {
    return /(?:[\p{White_Space}\u200b\ufeff]|[,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉])$/u.test(
        text,
    );
}

function hasPreferredBreakAtStart(text: string) {
    return /^[“‘「『《〈«‹]/u.test(text);
}

function renderKaraokeWordSegment(text: string, time: number, duration: number) {
    return `<span class="rnp-karaoke-word" data-time="${time}" data-duration="${duration}"><span>${formatLyricText(text)}</span></span>`;
}

function splitLyricTextAtPreferredBreaks(text: string) {
    const trailingBreakSegments = text
        .match(
            /.*?(?:[\p{White_Space}\u200b\ufeff]+|[,.;:!?，。！？、；：…~～\-‐‑‒–—―/\\|)\]）】」』》〉]+|$)/gu,
        )
        ?.filter(Boolean) ?? [text];
    return trailingBreakSegments.flatMap((segment) =>
        segment.split(/(?=[“‘「『《〈«‹])/u).filter(Boolean),
    );
}

function getTextTimingWeight(text: string) {
    return Math.max(
        1,
        Array.from(text).filter((char) => !/^[\p{White_Space}\u200b\ufeff]+$/u.test(char)).length,
    );
}

function formatLyricText(text: string, annotations: FuriganaAnnotation[] = []) {
    const wordStarts = getSemanticWordStarts(text);
    removeBoundariesInsideAnnotations(wordStarts, annotations);
    let globalOffset = 0;
    return splitLyricTextAtPreferredBreaks(text)
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
                        ? `<ruby class="rnp-furigana-ruby"><span class="rnp-furigana-base">${escapeHtml(word)}</span><rt lang="ja">${escapeHtml(annotation.reading)}</rt></ruby>`
                        : escapeHtml(word);
                    return `<span class="rnp-lyrics-semantic-word">${content}</span>`;
                })
                .join("");
            globalOffset = segmentEnd;
            return `<span class="rnp-lyrics-break-segment">${semanticWords}</span>`;
        })
        .join("<wbr>");
}

function removeBoundariesInsideAnnotations(
    wordStarts: Set<number>,
    annotations: FuriganaAnnotation[],
) {
    annotations.forEach((annotation) => {
        for (const offset of wordStarts) {
            if (offset > annotation.start && offset < annotation.end) wordStarts.delete(offset);
        }
    });
}
