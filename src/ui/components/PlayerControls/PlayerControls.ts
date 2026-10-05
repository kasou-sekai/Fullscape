import CFM from "../../../utils/config";
import { DOM } from "../../elements";
import Utils from "../../../utils/utils";
import ICONS from "../../../constants";

export class PlayerControls {
    static toolsTimer: ReturnType<typeof setTimeout>;

    static showLyricsTools() {
        clearTimeout(this.toolsTimer);
        const tools = DOM.container.querySelector(".fullscape-lyrics-tools");
        tools?.classList.add("is-visible");
        this.toolsTimer = setTimeout(() => tools?.classList.remove("is-visible"), 3000);
    }

    static playerControlsTimer: ReturnType<typeof setTimeout>;

    static updatePlayerControls(evt: { data: { is_paused?: boolean; isPaused?: boolean } }) {
        if (CFM.get("playerControls") === "mousemove") this.hidePlayerControls();
        Utils.fadeAnimation(DOM.play);
        if (evt.data.is_paused || evt.data.isPaused) {
            DOM.play.innerHTML = ICONS.APPLE_MUSIC_PLAY;
        } else {
            DOM.play.innerHTML = ICONS.APPLE_MUSIC_PAUSE;
        }
    }

    static hidePlayerControls() {
        if (this.playerControlsTimer) {
            clearTimeout(this.playerControlsTimer);
        }
        const element = DOM.container.querySelector<HTMLElement>(".fullscape-controls-center");
        if (!element) return;
        element.style.opacity = "1";
        this.playerControlsTimer = setTimeout(() => (element.style.opacity = "0"), 3000);
    }
}
