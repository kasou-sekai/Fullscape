import { detectChineseScript } from "./chinese-conversion";
import type { LyricsChineseConversion } from "./chinese-conversion";
import { detectTextLanguage } from "./text-language";
import type { TextLanguage } from "./text-language";

export function getTextLanguageTag(
    text: string,
    context: TextLanguage = "unknown",
    conversion: LyricsChineseConversion = "original",
) {
    const language = detectTextLanguage(text, context);
    if (language === "zh") {
        const script = conversion === "original" ? detectChineseScript(text) : conversion;
        return script === "traditional" ? "zh-TW" : "zh-CN";
    }
    return language === "unknown" ? "und" : language;
}

export function applyTextLanguage(element: HTMLElement, context: TextLanguage = "unknown") {
    const language = getTextLanguageTag(element.textContent ?? "", context);
    element.lang = language;
    element.dataset.textLanguage = language;
}
