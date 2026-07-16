import CFM from "../../../utils/config";
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

    static async updateUpNextInfo() {
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
        if (next_image) {
            upnextImage.src = next_image;
        } else {
            if (metadata.image_url) upnextImage.src = metadata.image_url;
            else {
                upnextImage.src = ICONS.OFFLINE_SVG;
            }
        }
        return new Promise<void>((resolve) => {
            upnextImage.onload = () => {
                DOM.upNextCover.style.backgroundImage = `url("${upnextImage.src}")`;
                DOM.upNextPrimaryText.innerText = songName + "  •  " + next_artist;
                DOM.upNextSecondaryText.innerText = songName + "  •  " + next_artist;
                resolve();
            };
            upnextImage.onerror = () => {
                DOM.upNextCover.style.backgroundImage = `url("${ICONS.OFFLINE_SVG}")`;
                DOM.upNextPrimaryText.innerText = songName + "  •  " + next_artist;
                DOM.upNextSecondaryText.innerText = songName + "  •  " + next_artist;
                resolve();
            };
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
            await this.updateUpNextInfo();
            this.showUpNext();
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
        this.upNextShown = false;
        DOM.upNextContainer.style.transform = this.hiddenTransform;
        DOM.upNextContainer.style.opacity = "0";
        DOM.upNextContainer.style.pointerEvents = "none";
        this.resetUpNextAnimation();
    }

    static setupScrollingAnimation() {
        this.resetUpNextAnimation();
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
        this.scrollAnimation?.cancel();
        this.scrollAnimation = null;
        DOM.upNextPrimaryText.style.paddingRight = "0px";
        DOM.upNextTitleTrack.style.animation = "none";
        DOM.upNextTitleTrack.style.removeProperty("transform");
        DOM.upNextSecondaryText.innerText = "";
    }

    static updateUpNextShow() {
        if (CFM.get("upnextDisplay") === "smart") {
            setTimeout(() => {
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
                    this.upNextShown = true;
                } else {
                    this.hideUpNext();
                    if (Spicetify.Player.isPlaying()) {
                        this.upnextTimer = setTimeout(() => {
                            this.updateUpNext();
                            this.upNextShown = true;
                        }, timetogo);
                    }
                }
            }, 100);
        } else if (CFM.get("upnextDisplay") === "always" && !this.upNextShown) {
            this.updateUpNext();
            this.upNextShown = true;
        }
    }
}
