const INSTRUMENTAL_NOTICE =
    /^此歌曲[为為][没沒]有填[词詞]的[纯純]音[乐樂][请請]您欣[赏賞]$/u;

export function isInstrumentalNotice(lines: readonly { text: string }[]) {
    const text = lines.map((line) => line.text).join("").normalize("NFKC");
    return INSTRUMENTAL_NOTICE.test(text.replace(/[\s\p{P}\p{Cf}]+/gu, ""));
}
