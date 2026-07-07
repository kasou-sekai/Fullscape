export type Config = {
    def: Settings;
    locale: string;
    fsHideOriginal: boolean;
    autoLaunch: "never" | "default";
    activationTypes: "both" | "btns" | "keys";
};

export type BeatResponsePreset = "off" | "low" | "medium" | "high" | "custom";

export type Settings = {
    lyricsDisplay: boolean;
    thirdPartyLyrics: boolean;
    relaxedLyricsMatching: boolean;
    showLyricsTranslation: boolean;
    showLyricsRomanization: boolean;
    showLyricsFurigana: boolean;
    lyricsChineseConversion: "original" | "simplified" | "traditional";
    karaokeLyrics: boolean;
    lyricsSize: number;
    autoHideLyrics: boolean;
    debugMode: boolean;
    progressBarDisplay: "never" | "mousemove" | "always";
    playerControls: "never" | "mousemove" | "always";
    trimTitle: boolean;
    trimTitleUpNext: boolean;
    trimAlbum: boolean;
    showAlbum: "never" | "always" | "date";
    icons: boolean;
    titleMovingIcon: boolean;
    enableFullscreen: boolean;
    upnextDisplay: "always" | "never" | "smart";
    themedButtons: boolean;
    themedIcons: boolean;
    invertColors: "never" | "always" | "auto";
    backAnimationTime: number;
    animationSpeed: number;
    beatBounce: boolean;
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
    verticalMonitorSupport: boolean;
};

export type Colors = Record<string, string>;

export type SeekbarProps = {
    isChanging: boolean;
    data: MouseData | null;
};

export type MouseData = {
    begin: number;
    positionCoord: number;
    beginClient: number;
    sliderDimen: number;
};
