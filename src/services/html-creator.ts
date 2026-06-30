import ICONS from "../constants";
import CFM from "../utils/config";

export const getHtmlContent = () => {
    return `
        <canvas id="fsd-background"></canvas>
        <canvas id="fsd-fluid-background" aria-hidden="true"></canvas>
        ${
            CFM.get("debugMode")
                ? `<aside id="fsd-background-debug" aria-label="Background motion debug">
            <div class="fsd-debug-title">
                <span class="fsd-debug-beat-dot"></span>
                <strong>BACKGROUND MOTION</strong>
                <span data-debug-status>WAITING</span>
            </div>
            <div class="fsd-debug-meter"><span></span></div>
            <div class="fsd-debug-values">
                <span>BEAT <b data-debug-beat>0.00</b></span>
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
<div id="fsd-upnext-container">
    <div id="fsd_next_details">
        <div id="fsd_up_next_text"></div>
        <div id="fsd_next_tit_art">
            <div id="fsd_next_tit_art_inner">
                <span id="fsd_first_span"></span>
                <span id="fsd_second_span"></span>
            </div>
        </div>
    </div>
    <div id="fsd_next_art">
        <div id="fsd_next_art_image" class="fsd-background-fade"></div>
    </div>
</div>`
         : ""
 }
${CFM.get("lyricsDisplay") ? `<div id="fad-lyrics-container"></div>` : ""}
<div id="fsd-foreground">
    <div id="fsd-art">
        <div id="fsd-art-image" class="fsd-background-fade">
            <div id="fsd-art-inner"></div>
        </div>
    </div>
    <div id="fsd-details">
            <div id="fsd-title" class="fsd-song-meta">
                 ${ICONS.PLAYING_ICON}
                 ${ICONS.PAUSED_ICON}
                 <div id="fsd-title-text-viewport">
                     <span id="fsd-title-text-track"></span>
                 </div>
            </div>
            <div id="fsd-secondary-meta">
                <div id="fsd-secondary-meta-track">
                    <div id="fsd-artist">
                        ${ICONS.ARTIST}
                        <span class="fsd-artist-list"></span>
                    </div>
                    ${
                        CFM.get("showAlbum") !== "never"
                            ? `<span class="fsd-meta-separator" aria-hidden="true">•</span>
                    <div id="fsd-album" class="fsd-song-meta">
                        ${ICONS.ALBUM}
                        <span></span>
                    </div>`
                            : ""
                    }
                </div>
            </div>
            <div id="fsd-progress-parent"></div>
            <div id="fsd-status" class="${CFM.get("playerControls") !== "never" ? "active" : ""}">
                ${
                    CFM.get("playerControls") !== "never"
                        ? `
                    <div class="fsd-controls-center fsd-controls">
                        <button class="fs-button" id="fsd-back">
                            ${ICONS.APPLE_MUSIC_BACK}
                        </button>
                        <button class="fs-button" id="fsd-play">
                            ${ICONS.APPLE_MUSIC_PLAY}
                        </button>
                        <button class="fs-button" id="fsd-next">
                            ${ICONS.APPLE_MUSIC_NEXT}
                        </button>
                    </div>`
                        : ""
                }
            </div>
    </div>
</div>`;
};
