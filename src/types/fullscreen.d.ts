export type Config = {
    def: Settings;
    locale: string;
    fsHideOriginal: boolean;
    autoLaunch: "never" | "default";
    activationTypes: "both" | "btns" | "keys";
};

export type Settings = {
    lyricsDisplay: boolean;
    thirdPartyLyrics: boolean;
    showLyricsTranslation: boolean;
    showLyricsRomanization: boolean;
    karaokeLyrics: boolean;
    lyricsSize: number;
    autoHideLyrics: boolean;
    progressBarDisplay: "never" | "mousemove" | "always";
    playerControls: "never" | "mousemove" | "always";
    trimTitle: boolean;
    trimTitleUpNext: boolean;
    trimAlbum: boolean;
    showAlbum: "never" | "always" | "date";
    icons: boolean;
    titleMovingIcon: boolean;
    enableFullscreen: boolean;
    backgroundChoice:
        | "static_color"
        | "dynamic_color"
        | "album_art"
        | "artist_art"
        | "animated_album";
    upnextDisplay: "always" | "never" | "smart";
    themedButtons: boolean;
    themedIcons: boolean;
    invertColors: "never" | "always" | "auto";
    backAnimationTime: number;
    animationSpeed: number;
    upnextTimeToShow: number;
    coloredBackChoice: string;
    staticBackChoice: string;
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
