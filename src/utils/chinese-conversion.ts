import OpenCC from "opencc-js";
import type { ConverterFunction } from "opencc-js";
import type { FuriganaRenderData } from "./furigana";
import { detectTextLanguage } from "./text-language";

export type LyricsChineseConversion = "original" | "simplified" | "traditional";
export type ChineseScript = Exclude<LyricsChineseConversion, "original">;

export interface ChineseLyricsPresentation {
    sourceScript: ChineseScript | null;
    displayScript: ChineseScript | null;
    conversion: LyricsChineseConversion;
}

let simplifiedConverter: ConverterFunction | null = null;
let traditionalConverter: ConverterFunction | null = null;

function getSimplifiedConverter() {
    simplifiedConverter ??= OpenCC.Converter({ from: "t", to: "cn" });
    return simplifiedConverter;
}

function getTraditionalConverter() {
    traditionalConverter ??= OpenCC.Converter({ from: "cn", to: "tw" });
    return traditionalConverter;
}

export function convertChineseText(text: string, target: LyricsChineseConversion) {
    if (!text || target === "original") return text;
    const simplified = getSimplifiedConverter()(text);
    return target === "simplified" ? simplified : getTraditionalConverter()(simplified);
}

export function normalizeChineseForMatch(text: string) {
    return getSimplifiedConverter()(text.normalize("NFKC"));
}

export function isChineseLyrics(text: string) {
    return detectTextLanguage(text) === "zh";
}

export function getTranslationPresentation(text: string, target: LyricsChineseConversion) {
    const conversion = target === "traditional" ? "traditional" : "simplified";
    return {
        text: convertChineseText(text, conversion),
        language: conversion === "traditional" ? "zh-TW" : "zh-CN",
    };
}

export function getChineseLyricsPresentation(
    text: string,
    target: LyricsChineseConversion,
): ChineseLyricsPresentation {
    if (!isChineseLyrics(text)) {
        return { sourceScript: null, displayScript: null, conversion: "original" };
    }

    const sourceScript = detectChineseScript(text);
    const displayScript = target === "original" ? sourceScript : target;
    const conversion = target === "original" || target === sourceScript ? "original" : target;
    return { sourceScript, displayScript, conversion };
}

export function detectChineseScript(text: string): ChineseScript {
    const normalized = text.normalize("NFKC");
    const simplifiedDifference = countTextDifference(
        normalized,
        convertChineseText(normalized, "simplified"),
    );
    const traditionalDifference = countTextDifference(
        normalized,
        convertChineseText(normalized, "traditional"),
    );
    return traditionalDifference < simplifiedDifference ? "traditional" : "simplified";
}

function countTextDifference(first: string, second: string) {
    const firstCharacters = Array.from(first);
    const secondCharacters = Array.from(second);
    const length = Math.max(firstCharacters.length, secondCharacters.length);
    let difference = 0;
    for (let index = 0; index < length; index++) {
        if (firstCharacters[index] !== secondCharacters[index]) difference += 1;
    }
    return difference;
}

export function convertFuriganaRenderData(
    data: FuriganaRenderData,
    target: LyricsChineseConversion,
): FuriganaRenderData {
    if (target === "original" || !data.annotations.length) {
        return {
            text: convertChineseText(data.text, target),
            annotations: data.annotations,
        };
    }

    let cursor = 0;
    let text = "";
    const annotations = data.annotations.map((annotation) => {
        text += convertChineseText(data.text.slice(cursor, annotation.start), target);
        const start = text.length;
        text += convertChineseText(data.text.slice(annotation.start, annotation.end), target);
        cursor = annotation.end;
        return { ...annotation, start, end: text.length };
    });
    text += convertChineseText(data.text.slice(cursor), target);
    return { text, annotations };
}
