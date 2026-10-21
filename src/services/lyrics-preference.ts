import { hasAuthoredRichWordTiming } from "./lyrics-rich-document";
import { detectTextLanguage } from "../utils/text-language";
import type { EnhancedLyricLine } from "./third-party-lyrics";
import type { TimedTextElement } from "./lyrics-rich-document";

export type LyricsFamily = "apple-music" | "standard";

function styled(node?: TimedTextElement): boolean {
    if (!node) return false;
    return (
        Object.entries(node.attributes).some(
            ([name, value]) =>
                ["ruby", "fontSize"].includes(name.split(":").pop()) ||
                (name.split(":").pop() === "role" && value === "x-bg"),
        ) || node.children.some(styled)
    );
}

export function hasRichArrangement(lines: EnhancedLyricLine[]) {
    if (
        lines.some(
            (line) =>
                line.presentation?.isBackground ||
                line.backgrounds?.length ||
                line.presentation?.alignment === "right" ||
                styled(line.presentation?.element),
        )
    )
        return true;
    const main = lines
        .filter((line) => !line.presentation?.isBackground && line.time !== null)
        .slice()
        .sort((a, b) => a.time - b.time);
    let authoredEnd = -Infinity;
    const voiceEnds = new Map<string, number>();
    for (const line of main) {
        const authored = hasAuthoredRichWordTiming(line);
        if (authored && authoredEnd - line.time > 1) return true;
        const agent = line.presentation?.agent;
        if (
            agent &&
            Array.from(voiceEnds).some(([voice, end]) => voice !== agent && end - line.time > 1)
        )
            return true;
        const end = (line.presentation?.end ?? 0) * 1000;
        if (authored) authoredEnd = Math.max(authoredEnd, end);
        if (agent) voiceEnds.set(agent, Math.max(voiceEnds.get(agent) ?? -Infinity, end));
    }
    return false;
}

/** Source-independent automatic order. Explicit manual choices bypass it. */
export function lyricsPreferenceScore(
    lines: EnhancedLyricLine[],
    family: LyricsFamily = "standard",
    languageCode?: string,
) {
    const main = lines.filter((line) => !line.presentation?.isBackground && line.text.trim());
    if (!main.length) return [0, 0, 0, 0, 0];
    const language = languageCode?.startsWith("zh")
        ? "zh"
        : detectTextLanguage(
              main.map((line) => line.text).join("\n"),
              languageCode?.startsWith("ja") ? "ja" : "unknown",
          );
    const karaoke = main.filter(
        (line) => hasAuthoredRichWordTiming(line) && line.words?.some((word) => word.text.trim()),
    ).length;
    const translated = main.filter(
        (line) =>
            line.translation?.trim() &&
            line.translation.trim() !== "//" &&
            detectTextLanguage(line.translation) === "zh",
    ).length;
    const timed = main.filter((line) => line.time !== null).length;
    const apple = family === "apple-music";
    const tier =
        apple && language === "zh"
            ? 60
            : apple && hasRichArrangement(lines)
              ? 50
              : karaoke && translated
                ? 40
                : karaoke
                  ? 30
                  : translated
                    ? 20
                    : timed
                      ? 10
                      : 5;
    return [tier, translated, karaoke, timed, main.length];
}

export function compareLyricsPreference(
    a: EnhancedLyricLine[],
    b: EnhancedLyricLine[],
    aFamily: LyricsFamily = "standard",
    bFamily: LyricsFamily = "standard",
) {
    const left = lyricsPreferenceScore(a, aFamily),
        right = lyricsPreferenceScore(b, bFamily);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return 0;
}
