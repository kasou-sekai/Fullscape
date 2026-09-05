import CFM from "../../../utils/config";
import { DOM } from "../../elements";
import Utils from "../../../utils/utils";
import ICONS from "../../../constants";

export class PlayerControls {
    static playerControlsTimer: ReturnType<typeof setTimeout> | null = null;
    static controlPointerInside = false;

    static updatePlayerControls(evt: { data: { is_paused?: boolean; isPaused?: boolean } }) {
        if (CFM.get("playerControls") === "mousemove") this.hidePlayerControls();
        if (evt.data.is_paused || evt.data.isPaused) {
            void Utils.transitionIcon(DOM.play, ICONS.APPLE_MUSIC_PLAY);
        } else {
            void Utils.transitionIcon(DOM.play, ICONS.APPLE_MUSIC_PAUSE);
        }
        this.updateControlVisibility(
            CFM.get("playerControls") === "mousemove" || this.controlPointerInside,
        );
    }

    static hidePlayerControls() {
        if (this.playerControlsTimer !== null) {
            clearTimeout(this.playerControlsTimer);
        }
        this.updateControlVisibility(true);
        if (this.controlPointerInside) {
            this.playerControlsTimer = null;
            return;
        }
        this.playerControlsTimer = setTimeout(() => {
            this.playerControlsTimer = null;
            this.updateControlVisibility(false);
        }, 3000);
    }

    static setPointerInside(value: boolean) {
        this.controlPointerInside = value;
        if (value) this.updateControlVisibility(true);
    }

    static updateControlVisibility(forceVisible = false) {
        const container = DOM.container;
        if (!container) return;
        const transportVisible =
            forceVisible ||
            CFM.get("playerControls") === "always";
        const auxiliaryControlsVisible =
            forceVisible ||
            CFM.get("playModeControl") !== "mousemove" ||
            container.classList.contains("side-view-queue");
        const setOpacity = (selector: string, visible: boolean) => {
            const control = container.querySelector<HTMLElement>(selector);
            if (control) control.style.opacity = visible ? "1" : "0";
        };
        setOpacity("#fullscape-back", transportVisible);
        setOpacity("#fullscape-play", transportVisible);
        setOpacity("#fullscape-next", transportVisible);
        setOpacity("#fullscape-play-mode", auxiliaryControlsVisible);
        setOpacity("#fullscape-side-view", auxiliaryControlsVisible);
    }
}
