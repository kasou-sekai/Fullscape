import type { LyricsPresentation } from "../Lyrics/Lyrics";
import type { Settings } from "../../../types/fullscape";
import {
    convertChineseText,
    getChineseLyricsPresentation,
} from "../../../utils/chinese-conversion";
import { parseFuriganaMarkup } from "../../../utils/furigana";
import { getTextLanguageTag } from "../../../utils/text-presentation";
import { getMeasuredLyricEnd } from "../Lyrics/timeline";
import { FocusLyrics } from "./FocusLyrics";
import { FocusPlayer } from "./FocusPlayer";

import "./focus-page.scss";

type BookState = Parameters<FocusLyrics["update"]>[0];

export class FocusPage {
    readonly lyricsRoot = document.createElement("div");
    private readonly page = document.createElement("div");
    private readonly player: FocusPlayer;
    private readonly lyrics: FocusLyrics;
    private trackUri = "";
    private lines: BookState["lines"] = [];
    private status: BookState["status"] = "empty";

    constructor(
        host: HTMLElement,
        private readonly format: Settings["focusFormat"],
        private readonly lyricsEnabled: boolean,
        private readonly strings: {
            loading: string;
            unavailable: string;
            disabled: string;
            showSheet: string;
        },
        private readonly chineseConversion: Settings["lyricsChineseConversion"],
    ) {
        const playerRoot = document.createElement("div");
        playerRoot.className = "fullscape-focus-player";
        this.lyricsRoot.className = "fullscape-focus-book";
        this.page.className = "fullscape-focus-page";
        this.page.append(playerRoot, this.lyricsRoot);
        host.replaceChildren(this.page);
        this.player = new FocusPlayer(playerRoot);
        this.lyrics = new FocusLyrics(this.lyricsRoot);
    }

    presentLyrics = ({ trackUri, status, synced, lines, interludes }: LyricsPresentation) => {
        if (trackUri !== this.trackUri) return;
        const text = lines.map((line) => line.text).join("\n");
        const { conversion } = getChineseLyricsPresentation(text, this.chineseConversion);
        this.lyricsRoot.lang = lines.length ? getTextLanguageTag(text, undefined, conversion) : "";
        const gaps = new Set(interludes.map(({ nextIndex }) => nextIndex));
        this.lines = lines.map((line, index) => {
            const section = line.presentation?.sectionIndex;
            return {
                startTime: synced ? line.time : null,
                endTime: synced ? getMeasuredLyricEnd(line) : undefined,
                sectionBreakBefore: line.sectionBreakBefore,
                sectionIndex:
                    typeof section === "number" && Number.isSafeInteger(section) && section >= 0
                        ? section
                        : undefined,
                interludeBefore: gaps.has(index),
                text: convertChineseText(parseFuriganaMarkup(line.text).text, conversion),
            };
        });
        this.status = status;
        this.update();
    };

    update(paused = !Spicetify.Player.isPlaying()) {
        const player = Spicetify.Player;
        const item = player.data?.item;
        const trackUri = item?.uri ?? "";
        const trackKey = item?.uid ? `${trackUri}:${item.uid}` : trackUri;
        if (trackUri !== this.trackUri) {
            this.trackUri = trackUri;
            this.lines = [];
            this.lyricsRoot.lang = "";
            this.status = trackUri && this.lyricsEnabled ? "loading" : "empty";
        }
        const meta = item?.metadata;
        const title = meta?.title ?? "";
        const artist = meta?.artist_name ?? "";
        const coverUrl = meta?.image_xlarge_url || meta?.image_large_url || meta?.image_url || "";
        const rawDuration = player.getDuration();
        const rawProgress = player.getProgress();
        const duration = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0;
        const progress = Number.isFinite(rawProgress) ? Math.max(0, rawProgress) : 0;
        const track = { trackKey, title, artist, progress, duration };

        this.player.update({ ...track, coverUrl, paused, format: this.format });
        this.lyrics.update({
            trackKey,
            title,
            artist,
            progress,
            lines: this.lines,
            status: this.status,
            loadingLabel: this.strings.loading,
            emptyLabel: this.lyricsEnabled ? this.strings.unavailable : this.strings.disabled,
            showSheetLabel: this.strings.showSheet,
        });
    }

    destroy() {
        this.player.destroy();
        this.lyrics.destroy();
        this.page.remove();
    }
}
