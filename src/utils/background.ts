import CFM from "./config";
import { Settings } from "../types/fullscreen";
import Utils from "./utils";
import { DOM } from "../ui/elements";
import ColorExtractor from "./colors";
import WebAPI from "../services/web-api";
import {
    animateCanvas,
    animateColor,
    animatedRotatedCanvas,
    modifyIsAnimationRunning,
} from "./animation";

export class Background {
    private static updateSequence = 0;

    static stop() {
        this.updateSequence += 1;
        modifyIsAnimationRunning(false);
    }

    static async updateBackground(meta: Partial<Record<string, unknown>> = {}, fromResize = false) {
        const sequence = ++this.updateSequence;
        const previousImg = DOM.backgroundImg.cloneNode() as HTMLImageElement;
        const settingValue = CFM.get("backgroundChoice") as Settings["backgroundChoice"];

        DOM.back.classList.toggle("animated", settingValue === "animated_album");
        modifyIsAnimationRunning(settingValue === "animated_album");

        switch (settingValue) {
            case "dynamic_color": {
                const nextColor = await Utils.getNextColor(
                    CFM.get("coloredBackChoice") as Settings["coloredBackChoice"],
                );
                if (sequence !== this.updateSequence) return;
                const imageUrl = Spicetify.Player.data.item?.metadata.image_xlarge_url;
                void this.updateMainColor(
                    imageUrl,
                    meta as Partial<Record<string, string>>,
                    sequence,
                );
                void this.updateThemeColor(imageUrl, sequence);
                animateColor(nextColor, DOM.back, fromResize);
                break;
            }
            case "static_color": {
                const imageUrl = Spicetify.Player.data.item?.metadata.image_xlarge_url;
                void this.updateMainColor(
                    imageUrl,
                    meta as Partial<Record<string, string>>,
                    sequence,
                );
                void this.updateThemeColor(imageUrl, sequence);
                animateColor(
                    CFM.get("staticBackChoice") as Settings["staticBackChoice"],
                    DOM.back,
                    fromResize,
                );
                break;
            }
            case "artist_art": {
                const imageUrl = await Utils.getImageAndLoad(
                    meta as Partial<Record<string, string>>,
                );
                if (sequence !== this.updateSequence) return;
                this.loadBackgroundImage(
                    imageUrl,
                    previousImg,
                    meta as Partial<Record<string, string>>,
                    sequence,
                    fromResize,
                    false,
                );
                break;
            }
            case "animated_album": {
                this.loadBackgroundImage(
                    meta?.image_xlarge_url as string,
                    previousImg,
                    meta as Partial<Record<string, string>>,
                    sequence,
                    fromResize,
                    true,
                );
                break;
            }
            case "album_art":
            default:
                this.loadBackgroundImage(
                    meta?.image_xlarge_url as string,
                    previousImg,
                    meta as Partial<Record<string, string>>,
                    sequence,
                    fromResize,
                    false,
                );
                break;
        }
    }

    private static loadBackgroundImage(
        imageUrl: string,
        previousImg: HTMLImageElement,
        meta: Spicetify.Metadata,
        sequence: number,
        fromResize: boolean,
        animated: boolean,
    ) {
        if (!imageUrl) return;
        const render = () => {
            if (sequence !== this.updateSequence) return;
            if (!fromResize) {
                void this.updateMainColor(imageUrl, meta, sequence);
                void this.updateThemeColor(imageUrl, sequence);
            }
            if (animated) animatedRotatedCanvas(DOM.back, DOM.backgroundImg);
            else animateCanvas(previousImg, DOM.backgroundImg, DOM.back, fromResize);
        };

        DOM.backgroundImg.onload = render;
        DOM.backgroundImg.onerror = () => {
            if (sequence === this.updateSequence)
                console.warn("Unable to load the selected background image.");
        };
        if (fromResize && DOM.backgroundImg.complete && DOM.backgroundImg.naturalWidth > 0) {
            render();
        } else {
            DOM.backgroundImg.src = imageUrl;
        }
    }

    static async updateMainColor(
        imageURL: string,
        meta: Spicetify.Metadata,
        sequence = this.updateSequence,
    ) {
        switch (CFM.get("invertColors")) {
            case "always":
                if (sequence !== this.updateSequence) return;
                DOM.container.style.setProperty("--main-color", "0,0,0");
                DOM.container.style.setProperty("--contrast-color", "255,255,255");
                break;
            case "auto": {
                const [mainColor, contrastColor] = await ColorExtractor.getMainColor(imageURL);
                if (sequence !== this.updateSequence) return;
                DOM.container.style.setProperty("--main-color", mainColor);
                DOM.container.style.setProperty("--contrast-color", contrastColor);
                break;
            }
            case "never":
            default:
                if (sequence !== this.updateSequence) return;
                DOM.container.style.setProperty("--main-color", "255,255,255");
                DOM.container.style.setProperty("--contrast-color", "0,0,0");
                break;
        }
    }

    //Set main theme color for the display
    static async updateThemeColor(imageURL: string, sequence = this.updateSequence) {
        if (
            !(
                CFM.get("backgroundChoice") == "dynamic_color" &&
                CFM.get("coloredBackChoice") == "VIBRANT"
            ) &&
            (CFM.get("themedButtons") || CFM.get("themedIcons"))
        ) {
            DOM.container.classList.toggle("themed-buttons", Boolean(CFM.get("themedButtons")));
            DOM.container.classList.toggle("themed-icons", Boolean(CFM.get("themedIcons")));
            let themeVibrantColor;
            const artColors = await WebAPI.colorExtractor(imageURL).catch((err) => {
                console.warn(err);
                return undefined;
            });
            if (sequence !== this.updateSequence) return;
            if (!artColors?.VIBRANT) themeVibrantColor = "175,175,175";
            else themeVibrantColor = Utils.hexToRgb(artColors.VIBRANT);
            DOM.container.style.setProperty("--theme-color", themeVibrantColor);
        } else {
            DOM.container.classList.remove("themed-buttons", "themed-icons");
            DOM.container.style.setProperty("--theme-color", "175,175,175");
        }
    }
}
