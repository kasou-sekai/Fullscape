import { MOTION, prefersReducedMotion } from "../../../utils/motion";
import CFM from "../../../utils/config";
import { applyTextLanguage } from "../../../utils/text-presentation";
import translations from "../../../resources/strings";
import { DOM } from "../../elements";
import Utils from "../../../utils/utils";
import ICONS from "../../../constants";
import { Settings, Config } from "../../../types/fullscape";
import {
    createOverflowScrollAnimation,
    getOverflowScrollTiming,
} from "../../../utils/overflow-scroll";

export class UpNext {
    static upnextTimer: ReturnType<typeof setTimeout>;
    static upNextShown = false;
    private static readonly visibleTransform = "translateX(0px)";
    private static readonly hiddenTransform = "translateX(calc(100% + 40px))";
    private static scrollAnimation: Animation | null = null;
    private static sequence = 0;
    private static scrollKey = "";
    private static artworkLayer: HTMLElement | null = null;
    private static artworkAnimation: Animation | null = null;
    private static showTimer: ReturnType<typeof setTimeout> | null = null;

    static async updateUpNextInfo() {
        const sequence = ++this.sequence;
        const LOCALE = CFM.getGlobal("locale") as Config["locale"];
        DOM.upNextLabel.innerText = translations[LOCALE].upnext.toUpperCase();
        let metadata: Spicetify.Metadata = {};
        const queue_metadata = Spicetify.Queue.nextTracks[0];
        if (queue_metadata) {
            metadata = queue_metadata?.contextTrack?.metadata;
        } else {
            metadata["artist_name"] = "";
            metadata["title"] = "";
        }

        let songName = metadata.title;
        if (CFM.get("trimTitleUpNext") && songName) {
            songName = Utils.trimTitle(songName);
        }
        const artistNameNext = Object.keys(metadata)
            .filter((key) => key.startsWith("artist_name"))
            .sort()
            .map((key) => metadata[key])
            .join(", ");

        let next_artist;
        if (artistNameNext) {
            next_artist = artistNameNext;
        } else {
            next_artist = translations[LOCALE].unknownArtist;
        }
        const next_image = metadata.image_xlarge_url;
        const upnextImage = new Image();
        return new Promise<boolean>((resolve) => {
            let applied = false;
            const apply = (source: string) => {
                if (applied) return;
                applied = true;
                if (sequence !== this.sequence) {
                    resolve(false);
                    return;
                }
                const previous = DOM.upNextCover.style.backgroundImage;
                const next = `url("${source}")`;
                this.clearArtwork();
                DOM.upNextCover.style.backgroundImage = next;
                if (previous && previous !== next && this.upNextShown && !prefersReducedMotion()) {
                    const layer = document.createElement("div");
                    layer.className = "fullscape-artwork-previous";
                    layer.style.backgroundImage = previous;
                    layer.setAttribute("aria-hidden", "true");
                    DOM.upNextCover.append(layer);
                    this.artworkLayer = layer;
                    const animation = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
                        duration: MOTION.content,
                        easing: MOTION.ease,
                        fill: "forwards",
                    });
                    this.artworkAnimation = animation;
                    void animation.finished
                        .catch(() => undefined)
                        .then(() => {
                            if (this.artworkAnimation === animation) this.clearArtwork();
                        });
                }
                DOM.upNextPrimaryText.innerText = (songName || "") + "  •  " + next_artist;
                DOM.upNextSecondaryText.innerText = "";
                applyTextLanguage(DOM.upNextPrimaryText);
                applyTextLanguage(DOM.upNextSecondaryText);
                resolve(true);
            };
            upnextImage.onload = () => apply(upnextImage.src);
            upnextImage.onerror = () => apply(ICONS.OFFLINE_SVG);
            if (next_image) {
                upnextImage.src = next_image;
            } else {
                if (metadata.image_url) upnextImage.src = metadata.image_url;
                else {
                    upnextImage.src = ICONS.OFFLINE_SVG;
                }
            }
            if (upnextImage.complete && upnextImage.naturalWidth > 0) apply(upnextImage.src);
        });
    }

    static async updateUpNext() {
        const nextTrack = Spicetify.Queue?.nextTracks[0]?.contextTrack?.metadata;
        const upnextDisplay = CFM.get("upnextDisplay");

        let shouldShow = false;
        if (nextTrack?.title) {
            if (upnextDisplay === "always") {
                shouldShow = Spicetify.Platform?.PlayerAPI?._state?.repeat !== 2;
            } else if (upnextDisplay === "smart") {
                const timeToShow =
                    (CFM.get("upnextTimeToShow") as Settings["upnextTimeToShow"]) * 1000 + 50;
                const remainingTime =
                    Spicetify.Player.data.duration - Spicetify.Player.getProgress();
                shouldShow =
                    remainingTime <= timeToShow &&
                    Spicetify.Platform?.PlayerAPI?._state?.repeat !== 2;
            }
        }

        if (shouldShow) {
            if (await this.updateUpNextInfo()) this.showUpNext();
        } else {
            this.hideUpNext();
        }
    }

    static showUpNext() {
        DOM.upNextContainer.style.transform = this.visibleTransform;
        DOM.upNextContainer.style.opacity = "1";
        DOM.upNextContainer.style.pointerEvents = "auto";
        this.upNextShown = true;
        this.setupScrollingAnimation();
    }

    static hideUpNext() {
        this.sequence++;
        this.clearArtwork();
        this.upNextShown = false;
        DOM.upNextContainer.style.transform = this.hiddenTransform;
        DOM.upNextContainer.style.opacity = "0";
        DOM.upNextContainer.style.pointerEvents = "none";
        this.resetUpNextAnimation();
    }

    static setupScrollingAnimation() {
        const key = DOM.upNextPrimaryText.innerText + ":" + DOM.upNextTitleViewport.clientWidth;
        if (key === this.scrollKey && this.scrollAnimation) return;
        this.resetUpNextAnimation();
        this.scrollKey = key;
        const overflow = Math.ceil(
            DOM.upNextPrimaryText.offsetWidth - DOM.upNextTitleViewport.clientWidth,
        );
        if (overflow <= 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        this.scrollAnimation = createOverflowScrollAnimation(
            DOM.upNextTitleTrack,
            overflow,
            getOverflowScrollTiming(overflow),
        );
    }

    static resetUpNextAnimation() {
        this.scrollKey = "";
        this.scrollAnimation?.cancel();
        this.scrollAnimation = null;
        DOM.upNextPrimaryText.style.paddingRight = "0px";
        DOM.upNextTitleTrack.style.animation = "none";
        DOM.upNextTitleTrack.style.removeProperty("transform");
        DOM.upNextSecondaryText.innerText = "";
    }

    private static clearArtwork() {
        this.artworkAnimation?.cancel();
        this.artworkAnimation = null;
        this.artworkLayer?.remove();
        this.artworkLayer = null;
    }

    static teardown() {
        this.sequence++;
        if (this.showTimer) clearTimeout(this.showTimer);
        clearTimeout(this.upnextTimer);
        this.showTimer = null;
        this.clearArtwork();
        this.scrollAnimation?.cancel();
        this.scrollAnimation = null;
        this.scrollKey = "";
        this.upNextShown = false;
    }

    static updateUpNextShow() {
        if (CFM.get("upnextDisplay") === "smart") {
            if (this.showTimer) clearTimeout(this.showTimer);
            this.showTimer = setTimeout(() => {
                this.showTimer = null;
                const timetogo = Utils.getShowTime(
                    CFM.get("upnextTimeToShow") as Settings["upnextTimeToShow"],
                );
                if (this.upnextTimer) {
                    clearTimeout(this.upnextTimer);
                }
                if (timetogo < 10) {
                    if (
                        !this.upNextShown ||
                        DOM.upNextContainer.style.transform !== this.visibleTransform
                    ) {
                        this.updateUpNext();
                    }
                } else {
                    this.hideUpNext();
                    if (Spicetify.Player.isPlaying()) {
                        this.upnextTimer = setTimeout(() => {
                            this.updateUpNext();
                        }, timetogo);
                    }
                }
            }, 100);
        } else if (CFM.get("upnextDisplay") === "always" && !this.upNextShown) {
            this.updateUpNext();
        }
    }
}
