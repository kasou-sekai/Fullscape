import HtmlSelectors from "./selectors";
import WebAPI from "../services/web-api";

let wasQueuePanelEnabled: boolean | null = null;
let queuePanelSequence = 0;

class Utils {
    static allNotExist() {
        const extraBar = HtmlSelectors.getExtraBarSelector();

        const entriesToVerify = {
            "Extra Bar Component": extraBar,
            "Spicetify CosmosAsync": Spicetify.CosmosAsync,
            "Spicetify Mousetrap": Spicetify.Mousetrap,
            "Spicetify Player": Spicetify.Player,
            "Spicetify Platform": Spicetify.Platform,
        };

        return Object.entries(entriesToVerify).filter(([, val]) => !val);
    }

    static printNotExistings(entriesNotPresent: [string, unknown][]) {
        entriesNotPresent.forEach((entry: [string, unknown]) => {
            console.error(
                `${entry[0]} not available. Report issue on GitHub or run Spicetify.test() to test.`,
            );
            Spicetify.showNotification(
                `Error initializing "fullscreen.js" extension. ${entry[0]} not available. Report issue on GitHub.`,
                true,
            );
        });
        console.log("Retries exceeded. Aborting.");
    }

    static fullScreenOn() {
        if (!document.fullscreenElement) return document.documentElement.requestFullscreen();
    }

    static fullScreenOff() {
        if (document.fullscreenElement) return document.exitFullscreen();
    }

    /**
     * Add fade animation on button click
     * @param element The element to add fade animation
     * @param animClass Fade animation type class
     */
    static fadeAnimation(element: HTMLElement, animClass = "fade-do") {
        element.classList.remove(animClass);
        element.classList.add(animClass);
        setTimeout(() => {
            element.classList.remove(animClass);
        }, 800);
    }

    // Utility function to add a observer with wait for element support
    static addObserver(
        observer: MutationObserver,
        selector: string,
        options: MutationObserverInit,
    ) {
        const ele = document.querySelector(selector);
        if (!ele) {
            setTimeout(() => {
                if (Utils.isModeActivated()) Utils.addObserver(observer, selector, options);
            }, 2000);
            return;
        }
        observer.observe(ele, options);
    }

    // Converting hex to rgb
    static hexToRgb(hex: string) {
        // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, function (m, r, g, b) {
            return r + r + g + g + b + b;
        });
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`
            : null;
    }

    // converting rgb to hex
    static rgbToHex(color: { r: number; g: number; b: number }): string {
        return (
            "#" +
            ((1 << 24) + (color.r << 16) + (color.g << 8) + color.b)
                .toString(16)
                .slice(1)
                .toUpperCase()
        );
    }

    static trimTitle(title: string) {
        const trimmedTitle = title
            .replace(/\(.+?\)/g, "")
            .replace(/\[.+?\]/g, "")
            .replace(/\s-\s.+?$/, "")
            .trim();
        if (!trimmedTitle) return title;
        return trimmedTitle;
    }

    static async getAlbumReleaseDate(albumURI: string, locale: string) {
        const albumInfo = await WebAPI.getAlbumInfo(albumURI.replace("spotify:album:", "")).catch(
            (err) => console.error(err),
        );
        if (!albumInfo?.release_date) return "";
        const albumDate = new Date(albumInfo.release_date);
        const recentDate = new Date();
        recentDate.setMonth(recentDate.getMonth() - 18);
        const dateStr = albumDate.toLocaleString(
            locale,
            albumDate > recentDate ? { year: "numeric", month: "short" } : { year: "numeric" },
        );
        return " • " + dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }
    static async getImageAndLoad(meta: Spicetify.Metadata) {
        if (meta.artist_uri == null) return meta.image_xlarge_url;
        let arUri = meta.artist_uri.split(":")[2];
        if (meta.artist_uri.split(":")[1] === "local") {
            const res = await WebAPI.searchArt(meta.artist_name ?? "").catch((err) =>
                console.error(err),
            );
            arUri = res?.artists?.items?.[0]?.id ?? "";
        }
        if (!arUri) return meta.image_xlarge_url;
        const artistInfo = await WebAPI.getArtistInfo(arUri).catch((err) => console.error(err));
        return artistInfo?.visuals?.headerImage?.sources[0].url ?? meta.image_xlarge_url;
    }

    static async getNextColor(colorChoice: string) {
        let nextColor = "#444444";
        const imageColors = await WebAPI.colorExtractor(
            Spicetify.Player.data.item?.metadata.image_xlarge_url ?? "",
        ).catch((err) => console.warn(err));
        if (imageColors && imageColors[colorChoice]) nextColor = imageColors[colorChoice];
        return nextColor;
    }

    // Return the total time left to show the upnext timer
    static getShowTime(upnextTime: number) {
        const showBefore = upnextTime * 1000;
        const dur = Spicetify.Player.data.duration;
        const curProg = Spicetify.Player.getProgress();

        if (dur - curProg <= showBefore) return -1;
        else return dur - showBefore - curProg;
    }

    static isModeActivated(): boolean {
        return document.body.classList.contains("fsd-activated");
    }

    static overlayBack(hideBackground = true) {
        const overlay = document.querySelector("body > generic-modal > div");
        if (overlay) {
            overlay.classList.toggle("transparent-bg", hideBackground);
        }
    }

    // Translation string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static getAvailableLanguages(translations: Record<string, any>) {
        const languages: Record<string, string> = {};
        for (const lang in translations) {
            languages[lang] = translations[lang].langName;
        }
        return languages;
    }

    static toggleQueuePanel(myQueueButton: HTMLElement | null, enabled: boolean) {
        const sequence = ++queuePanelSequence;
        const originalQueueButton = HtmlSelectors.getOriginalQueueButton();
        const rightPanel = HtmlSelectors.getRightPanel();
        if (enabled) {
            setTimeout(() => {
                if (sequence !== queuePanelSequence || !Utils.isModeActivated()) return;
                if (!originalQueueButton?.classList.contains("main-genericButton-buttonActive")) {
                    originalQueueButton?.click();
                    wasQueuePanelEnabled = false;
                } else {
                    wasQueuePanelEnabled = true;
                }
                setTimeout(() => {
                    if (sequence !== queuePanelSequence || !Utils.isModeActivated()) return;
                    rightPanel?.classList.add("fsd-queue-panel");
                    setTimeout(() => {
                        if (sequence !== queuePanelSequence || !Utils.isModeActivated()) return;
                        rightPanel?.classList.add("fsd-transform-animation");
                    }, 100);
                }, 300);
            }, 600);
        } else {
            if (wasQueuePanelEnabled != null && !wasQueuePanelEnabled) {
                originalQueueButton?.click();
            }
            rightPanel?.style.setProperty("--queue-panel-x", "1000px");
            wasQueuePanelEnabled = null;
            myQueueButton?.classList.remove("button-active", "dot-after");
            rightPanel?.classList.remove("fsd-queue-panel", "fsd-transform-animation");
            document.body.classList.remove("fsd-queue-panel-active");
        }
    }

    static toggleQueue(queueButton: HTMLElement | null) {
        const rightPanel = HtmlSelectors.getRightPanel();

        if (document.body.classList.contains("fsd-queue-panel-active")) {
            rightPanel?.style.setProperty("--queue-panel-x", "1000px");
            queueButton?.classList.remove("button-active", "dot-after");
            document.body.classList.remove("fsd-queue-panel-active");
        } else {
            rightPanel?.style.setProperty("--queue-panel-x", "0px");
            queueButton?.classList.add("button-active", "dot-after");
            document.body.classList.add("fsd-queue-panel-active");
        }
    }

    static getTimeFormatted() {
        const now = new Date();
        return now.toLocaleString(navigator.language, {
            hour: "numeric",
            minute: "numeric",
            hour12: undefined,
        });
    }
}

export default Utils;
