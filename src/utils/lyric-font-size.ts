import { DEFAULTS } from "../constants/defaults";

export const MIN_LYRIC_FONT_SIZE = 12;
export const MAX_LYRIC_FONT_SIZE = 99;

export function getLyricFontSize(size: number) {
    if (!Number.isFinite(size)) return DEFAULTS.def.lyricsSize;
    return Math.min(MAX_LYRIC_FONT_SIZE, Math.max(MIN_LYRIC_FONT_SIZE, size));
}
