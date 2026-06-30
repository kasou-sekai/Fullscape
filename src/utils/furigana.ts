export type FuriganaAnnotation = {
    start: number;
    end: number;
    reading: string;
};

export type FuriganaRenderData = {
    text: string;
    annotations: FuriganaAnnotation[];
};

const FURIGANA_PATTERN =
    /｜([^《》]+?)《([ぁ-ゖァ-ヺーゝゞヽヾ]+?)》|([一-龯々〆ヶ]+)《([ぁ-ゖァ-ヺーゝゞヽヾ]+?)》|([一-龯々〆ヶ]+)[（(]([ぁ-ゖァ-ヺーゝゞヽヾ]+?)[）)]/gu;

export function parseFuriganaMarkup(text: string, furigana?: string): FuriganaRenderData {
    const source = furigana || text;
    const annotations: FuriganaAnnotation[] = [];
    let plainText = "";
    let cursor = 0;

    for (const match of source.matchAll(FURIGANA_PATTERN)) {
        const matchIndex = match.index ?? 0;
        plainText += source.slice(cursor, matchIndex);
        const base = match[1] ?? match[3] ?? match[5] ?? "";
        const reading = match[2] ?? match[4] ?? match[6] ?? "";
        const start = plainText.length;
        plainText += base;
        annotations.push({ start, end: plainText.length, reading });
        cursor = matchIndex + match[0].length;
    }
    plainText += source.slice(cursor);

    if (!annotations.length) {
        return { text, annotations: [] };
    }
    if (furigana && plainText !== text) {
        return { text, annotations: [] };
    }
    return { text: plainText, annotations };
}
