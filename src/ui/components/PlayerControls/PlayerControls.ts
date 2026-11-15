import { DOM } from "../../elements";
import Utils from "../../../utils/utils";
import ICONS from "../../../constants";
import { getPlaybackPaused, type PlaybackStateEvent } from "../../../services/playback-state";
import { MOTION } from "../../../utils/motion";

export class PlayerControls {
    static toolsTimer: ReturnType<typeof setTimeout>;

    static showLyricsTools() {
        clearTimeout(this.toolsTimer);
        const tools = DOM.container.querySelector(".fullscape-lyrics-tools");
        tools?.classList.add("is-visible");
        this.toolsTimer = setTimeout(
            () => tools?.classList.remove("is-visible"),
            MOTION.controlsIdle,
        );
    }

    static updatePlayerControls(evt?: Event | PlaybackStateEvent) {
        if (getPlaybackPaused(evt) ?? !Spicetify.Player.isPlaying()) {
            DOM.play.innerHTML = ICONS.APPLE_MUSIC_PLAY;
        } else {
            DOM.play.innerHTML = ICONS.APPLE_MUSIC_PAUSE;
        }
        Utils.fadeAnimation(DOM.play);
    }
}
