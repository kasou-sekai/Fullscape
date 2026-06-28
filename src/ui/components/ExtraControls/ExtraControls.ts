import CFM from "../../../utils/config";
import { DOM } from "../../elements";
import Utils from "../../../utils/utils";
import ICONS from "../../../constants";
import { UpNext } from "../UpNext/UpNext";

export class ExtraControls {
    static extraControlsTimer: ReturnType<typeof setTimeout>;
    static heartTimer: ReturnType<typeof setTimeout>;
    static prevControlData = {
        shuffle: Spicetify.Platform?.PlayerAPI?._state?.shuffle,
        repeat: Spicetify.Platform?.PlayerAPI?._state?.repeat,
    };
    static prevHeartData = Spicetify.Player?.data?.item?.metadata["collection.in_collection"];
    static INVERTED: Record<string, boolean> = (() => {
        try {
            const value: unknown = JSON.parse(localStorage.getItem("full-screen:inverted") ?? "{}");
            return value && typeof value === "object" && !Array.isArray(value)
                ? (value as Record<string, boolean>)
                : {};
        } catch {
            return {};
        }
    })();

    static updateExtraControls(event: { data?: Spicetify.PlayerState } | null) {
        if (!DOM.repeat?.isConnected || !DOM.shuffle?.isConnected) return;
        const data = event?.data ?? Spicetify.Player.data;
        this.updateHeart();
        if (this.prevControlData?.shuffle !== data?.shuffle) Utils.fadeAnimation(DOM.shuffle);
        if (this.prevControlData?.repeat !== data?.repeat) {
            Utils.fadeAnimation(DOM.repeat);
            UpNext.updateUpNext();
        }
        this.prevControlData = {
            shuffle: data?.shuffle,
            repeat: data?.repeat,
        };
        DOM.repeat.classList.toggle("dot-after", data?.repeat !== 0);
        DOM.repeat.classList.toggle("button-active", data?.repeat !== 0);

        DOM.shuffle.classList.toggle("dot-after", data?.shuffle);
        DOM.shuffle.classList.toggle("button-active", data?.shuffle);
        if (data?.repeat === 2) {
            DOM.repeat.innerHTML = `<svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons["repeat-once"]}</svg>`;
        } else {
            DOM.repeat.innerHTML = `<svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons["repeat"]}</svg>`;
        }
        if (data?.restrictions) {
            DOM.shuffle.classList.toggle("unavailable", !data?.restrictions?.canToggleShuffle);
            DOM.repeat.classList.toggle(
                "unavailable",
                !data?.restrictions?.canToggleRepeatTrack &&
                    !data?.restrictions?.canToggleRepeatContext,
            );
        }
    }

    static updateHeart() {
        if (this.heartTimer) clearTimeout(this.heartTimer);
        this.heartTimer = setTimeout(() => {
            if (!DOM.heart?.isConnected) return;
            const meta = Spicetify.Player?.data?.item;
            DOM.heart.classList.toggle(
                "unavailable",
                meta?.metadata["collection.can_add"] !== "true",
            );
            if (this.prevHeartData !== meta?.metadata["collection.in_collection"])
                Utils.fadeAnimation(DOM.heart);
            this.prevHeartData = meta?.metadata["collection.in_collection"];
            if (
                meta?.metadata["collection.in_collection"] === "true" ||
                Spicetify.Player.getHeart()
            ) {
                DOM.heart.innerHTML = `<svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons["heart-active"]}</svg>`;
                DOM.heart.classList.add("button-active");
            } else {
                DOM.heart.innerHTML = `<svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons["heart"]}</svg>`;
                DOM.heart.classList.remove("button-active");
            }
        }, 200);
    }

    static toggleInvert() {
        Utils.fadeAnimation(DOM.invertButton);
        if (DOM.invertButton.classList.contains("button-active"))
            DOM.invertButton.innerHTML = ICONS.INVERT_ACTIVE;
        else DOM.invertButton.innerHTML = ICONS.INVERT_INACTIVE;
        DOM.invertButton.classList.toggle("button-active");
        if (getComputedStyle(DOM.container).getPropertyValue("--main-color").startsWith("0")) {
            DOM.container.style.setProperty("--main-color", "255,255,255");
            DOM.container.style.setProperty("--contrast-color", "0,0,0");
            const albumId = Spicetify.Player.data.item?.metadata?.album_uri?.split(":")[2];
            if (!CFM.getGlobal("tvMode") && CFM.get("backgroundChoice") === "album_art" && albumId)
                this.INVERTED[albumId] = false;
        } else {
            DOM.container.style.setProperty("--main-color", "0,0,0");
            DOM.container.style.setProperty("--contrast-color", "255,255,255");
            const albumId = Spicetify.Player.data.item?.metadata?.album_uri?.split(":")[2];
            if (!CFM.getGlobal("tvMode") && CFM.get("backgroundChoice") === "album_art" && albumId)
                this.INVERTED[albumId] = true;
        }
        localStorage.setItem("full-screen:inverted", JSON.stringify(this.INVERTED));
    }

    static hideExtraControls() {
        if (this.extraControlsTimer) {
            clearTimeout(this.extraControlsTimer);
        }
        const elements = DOM.container.querySelectorAll(
            ".extra-controls",
        ) as NodeListOf<HTMLElement>;
        elements.forEach((element) => (element.style.opacity = "1"));
        this.extraControlsTimer = setTimeout(() => {
            elements.forEach((element) => (element.style.opacity = "0"));
        }, 3000);
    }
}
