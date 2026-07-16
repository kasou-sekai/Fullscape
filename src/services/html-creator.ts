import ICONS from "../constants";
import CFM from "../utils/config";

export const getHtmlContent = () => {
    return `
        <canvas id="fullscape-background"></canvas>
        <canvas id="fullscape-fluid-background" aria-hidden="true"></canvas>
        ${
            CFM.get("debugMode")
                ? `<aside id="fullscape-background-debug" aria-label="Background motion debug">
            <div class="fullscape-debug-title">
                <span class="fullscape-debug-beat-dot"></span>
                <strong>BACKGROUND MOTION</strong>
                <span data-debug-status>WAITING</span>
            </div>
            <div class="fullscape-debug-meter"><span></span></div>
            <div class="fullscape-debug-values">
                <span>BEAT <b data-debug-beat>0.00</b></span>
                <span>BPM <b data-debug-bpm>--</b></span>
                <span>SMOOTH <b data-debug-smooth>0.00</b></span>
                <span>SPEED <b data-debug-speed>0.00</b></span>
                <span>WARP <b data-debug-warp>0.00</b></span>
                <span>SCALE <b data-debug-scale>0.00</b></span>
                <span>TIME <b data-debug-time>0:00.0</b></span>
            </div>
        </aside>`
                : ""
        }
 ${
     CFM.get("upnextDisplay") !== "never"
         ? `
<div id="fullscape-upnext-container">
    <div id="fullscape-up-next-details">
        <div id="upNextLabel"></div>
        <div id="upNextTitleViewport">
            <div id="upNextTitleTrack">
                <span id="upNextPrimaryText"></span>
                <span id="upNextSecondaryText"></span>
            </div>
        </div>
    </div>
    <div id="fullscape-up-next-artwork">
        <div id="fullscape-up-next-cover" class="fullscape-background-fade"></div>
    </div>
</div>`
         : ""
 }
${CFM.get("lyricsDisplay") ? `<div id="fad-lyrics-container"></div>` : ""}
<div id="fullscape-foreground">
    <div id="fullscape-art">
        <div id="fullscape-art-image" class="fullscape-background-fade">
            <div id="fullscape-art-inner"></div>
        </div>
    </div>
    <div id="fullscape-details">
            <div id="fullscape-title" class="fullscape-song-meta">
                 ${ICONS.PLAYING_ICON}
                 ${ICONS.PAUSED_ICON}
                 <div id="fullscape-title-text-viewport">
                     <span id="fullscape-title-text-track"></span>
                 </div>
            </div>
            <div id="fullscape-secondary-meta">
                <div id="fullscape-secondary-meta-track">
                    <div id="fullscape-artist">
                        ${ICONS.ARTIST}
                        <span class="fullscape-artist-list"></span>
                    </div>
                    ${
                        CFM.get("showAlbum") !== "never"
                            ? `<span class="fullscape-meta-separator" aria-hidden="true">•</span>
                    <div id="fullscape-album" class="fullscape-song-meta">
                        ${ICONS.ALBUM}
                        <span></span>
                    </div>`
                            : ""
                    }
                </div>
            </div>
            <div id="fullscape-progress-parent"></div>
            <div id="fullscape-status" class="${CFM.get("playerControls") !== "never" ? "active" : ""}">
                ${
                    CFM.get("playerControls") !== "never"
                        ? `
                    <div class="fullscape-controls-center fullscape-controls">
                        <button class="fullscape-button" id="fullscape-back">
                            ${ICONS.APPLE_MUSIC_BACK}
                        </button>
                        <button class="fullscape-button" id="fullscape-play">
                            ${ICONS.APPLE_MUSIC_PLAY}
                        </button>
                        <button class="fullscape-button" id="fullscape-next">
                            ${ICONS.APPLE_MUSIC_NEXT}
                        </button>
                    </div>`
                        : ""
                }
            </div>
    </div>
</div>`;
};
