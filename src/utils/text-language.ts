export type TextLanguage = "zh" | "ja" | "ko" | "en" | "unknown";

/** Script detection for display typography, not a claim about a song's metadata. */
export function detectTextLanguage(text: string, context: TextLanguage = "unknown"): TextLanguage {
    const normalized = text.normalize("NFKC");
    const han = normalized.match(/\p{Script=Han}/gu)?.length ?? 0;
    const kana = normalized.match(/[\p{Script=Hiragana}\p{Script=Katakana}\u30fc]/gu)?.length ?? 0;
    const hangul = normalized.match(/\p{Script=Hangul}/gu)?.length ?? 0;
    const latin = normalized.match(/\p{Script=Latin}/gu)?.length ?? 0;
    const letters = han + kana + hangul + latin;
    const other = (normalized.match(/\p{Letter}/gu)?.length ?? 0) - letters;
    if (!letters || other >= letters) return "unknown";

    // Kana/Hangul are distinctive even in short titles. Weight kana together with
    // kanji, but keep a brief Japanese phrase in mostly Chinese lyrics Chinese.
    if (hangul > 0 && hangul >= kana && hangul * 2 >= han && hangul * 3 >= latin) return "ko";
    if (kana > 0 && kana * 5 >= han && (kana + han) * 3 >= latin) return "ja";
    if (latin > 0 && latin > (han + kana + hangul) * 5) return "en";
    if (han > 0) {
        // Han-only titles/lines are ambiguous; surrounding lyrics resolve them.
        if (!kana && !hangul && (context === "ja" || context === "ko")) return context;
        return "zh";
    }
    if (hangul > 0 && hangul >= kana && hangul >= latin) return "ko";
    if (kana > 0 && kana >= latin) return "ja";
    return latin > 0 ? "en" : "unknown";
}
