export type Config = {
    def: Settings;
    locale: string;
    hideSpotifyFullscreenButton: boolean;
    autoLaunch: "never" | "default";
    activationTypes: "both" | "btns" | "keys";
    autoUpdateCheck: boolean;
};

export type BeatResponsePreset = "off" | "low" | "medium" | "high" | "custom";

export type Typography = {
    preset: "default" | "serif" | "custom";
    family: string;
    weight: number;
};

export type Settings = {
    lyricsDisplay: boolean;
    thirdPartyLyrics: boolean;
    sharedLyricsBridge: boolean;
    lyricsSource: "auto" | "standard" | "apple-music";
    relaxedLyricsMatching: boolean;
    showLyricsTranslation: boolean;
    showLyricsRomanization: boolean;
    showLyricsFurigana: boolean;
    lyricsChineseConversion: "original" | "simplified" | "traditional";
    karaokeLyrics: boolean;
    lyricsSize: number;
    typography: Typography;
    debugMode: boolean;
    trimTitle: boolean;
    trimTitleUpNext: boolean;
    trimAlbum: boolean;
    showAlbum: "never" | "always" | "date";
    icons: boolean;
    titleMovingIcon: boolean;
    enableFullscreen: boolean;
    upnextDisplay: "always" | "never" | "smart";
    backAnimationTime: number;
    animationSpeed: number;
    beatResponsePreset: BeatResponsePreset;
    bpmDrivenMotion: boolean;
    beatScaleAmount: number;
    beatWarpAmount: number;
    beatSaturationAmount: number;
    beatSpeedAmount: number;
    beatAttack: number;
    beatRelease: number;
    upnextTimeToShow: number;
    blurSize: number;
    backgroundBrightness: number;
};

export type Colors = Record<string, string>;
