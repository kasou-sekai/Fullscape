import ICONS from "../constants";
import CFM from "../utils/config";

export const getHtmlContent = () => {
    return `
        <canvas id="fsd-background"></canvas>
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
