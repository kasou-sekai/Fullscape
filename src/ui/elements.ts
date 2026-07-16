export class DOM {
    static container: HTMLDivElement;
    static style: HTMLStyleElement;
    static cover: HTMLElement;
    static back: HTMLCanvasElement;
    static fluidBack: HTMLCanvasElement;
    static title: HTMLElement;
    static artist: HTMLElement;
    static album: HTMLElement;
    static play: HTMLElement;
    static upNextContainer: HTMLElement;
    static upNextCover: HTMLElement;
    static upNextLabel: HTMLElement;
    static upNextTitleViewport: HTMLElement;
    static upNextTitleTrack: HTMLElement;
    static upNextPrimaryText: HTMLElement;
    static upNextSecondaryText: HTMLElement;
    static playingIcon: HTMLElement;
    static pausedIcon: HTMLElement;
    static nextControl: HTMLElement;
    static backControl: HTMLElement;
    static queue: HTMLElement | null;
    static lyrics: HTMLElement;
    static coverImg = new Image();
    static backgroundImg = new Image();

    static init() {
        this.style = document.createElement("style");
        this.container = document.createElement("div");
        this.container.id = "fullscape-display";
        this.container.classList.add("Video", "VideoPlayer--fullscreen", "VideoPlayer--landscape");
    }
}
