/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import React from "react";
import ReactDOM from "react-dom";

import Utils from "./utils/utils";
import CFM from "./utils/config";

import translations from "./resources/strings";
import ICONS, { CLASSES_TO_ADD } from "./constants";
import HtmlSelectors from "./utils/selectors";
import { Config, Settings } from "./types/fullscreen";

import showWhatsNew from "./services/whats-new";
import { getHtmlContent } from "./services/html-creator";
import { initMoustrapRecord } from "./services/mousetrap-record";

import SeekableProgressBar from "./ui/components/ProgressBar/ProgressBar";
import SeekableVolumeBar from "./ui/components/VolumeBar/VolumeBar";

import { DOM } from "./ui/elements";
import { ConfigManager } from "./ui/components/Config/Config";
import { UpNext } from "./ui/components/UpNext/UpNext";
import { PlayerControls } from "./ui/components/PlayerControls/PlayerControls";
import { Lyrics } from "./ui/components/Lyrics/Lyrics";
import { Background } from "./utils/background";

import "./styles/base.scss";
import "./styles/tvMode.scss";
import "./styles/defaultMode.scss";
import "./styles/settings.scss";

async function main() {
    let INIT_RETRIES = 0;
    let entriesNotPresent = Utils.allNotExist();

    while (entriesNotPresent.length > 0) {
        if (INIT_RETRIES > 100) {
            Utils.printNotExistings(entriesNotPresent);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        entriesNotPresent = Utils.allNotExist();
        INIT_RETRIES += 1;
    }

    // Start from here
    showWhatsNew();
    initMoustrapRecord(Spicetify.Mousetrap);
    DOM.init();

    if (CFM.getGlobal("activationTypes") !== "btns") {
        if (CFM.getGlobal("keyActivation") !== "def") Spicetify.Mousetrap.bind("t", openwithTV);
        if (CFM.getGlobal("keyActivation") !== "tv") Spicetify.Mousetrap.bind("f", openwithDef);
    }

    function openwithTV() {
        if (!Utils.isModeActivated() || !CFM.getGlobal("tvMode") || CFM.getMode() !== "tv") {
            if (!CFM.getGlobal("tvMode") || CFM.getMode() !== "tv") {
                CFM.setGlobal("tvMode", true);
                CFM.setMode("tv");
                render();
            }
            activate();
        } else deactivate();
    }

    function openwithDef() {
        if (!Utils.isModeActivated() || CFM.getGlobal("tvMode") || CFM.getMode() === "tv") {
            if (CFM.getGlobal("tvMode") || CFM.getMode() === "tv") {
                CFM.setGlobal("tvMode", false);
                CFM.setMode("def");
                render();
            }
            activate();
        } else deactivate();
    }

    if (localStorage.getItem("full-screen:inverted") === null) {
        localStorage.setItem("full-screen:inverted", "{}");
    }

    let LOCALE: string = CFM.getGlobal("locale") as Config["locale"];
    function applyLyricsScale() {
        if (!CFM.get("lyricsDisplay")) return;
        const size = Number(CFM.get("lyricsSize") || 30);
        const basePx = 22;
        const minScale = 0.7;
        const maxScale = 4;
        const scale = Math.min(maxScale, Math.max(minScale, size / basePx));
        DOM.container?.style.setProperty("--lyrics-font-scale", `${scale}`);
    }

    const updatePlayerControls = PlayerControls.updatePlayerControls.bind(PlayerControls);
    const updateUpNext = UpNext.updateUpNext.bind(UpNext);
    const updateUpNextShow = UpNext.updateUpNextShow.bind(UpNext);
    const hidePlayerControls = PlayerControls.hidePlayerControls.bind(PlayerControls);
    let metadataFrameId: number | null = null;

    function updateMetadataOverflow() {
        if (metadataFrameId !== null) cancelAnimationFrame(metadataFrameId);
        metadataFrameId = requestAnimationFrame(() => {
            metadataFrameId = null;
            const targets = [
                {
                    viewport: DOM.container.querySelector<HTMLElement>("#fsd-title-text-viewport"),
                    track: DOM.container.querySelector<HTMLElement>("#fsd-title-text-track"),
                },
                {
                    viewport: DOM.container.querySelector<HTMLElement>("#fsd-secondary-meta"),
                    track: DOM.container.querySelector<HTMLElement>("#fsd-secondary-meta-track"),
                },
            ].filter(
                (
                    target,
                ): target is {
                    viewport: HTMLElement;
                    track: HTMLElement;
                } => Boolean(target.viewport && target.track),
            );

            targets.forEach(({ track }) => {
                track.classList.remove("is-overflowing");
                track.style.animation = "none";
                track.style.removeProperty("--translate_width_fsd");
                track.style.removeProperty("--meta-scroll-duration");
            });

            // Force the previous animations to reset before both tracks restart together.
            void DOM.container.offsetWidth;

            const measurements = targets.map((target) => ({
                ...target,
                overflow: Math.ceil(target.track.scrollWidth - target.viewport.clientWidth),
            }));
            const maxOverflow = Math.max(0, ...measurements.map(({ overflow }) => overflow));
            if (maxOverflow <= 1) return;

            const animationDuration = Math.max(maxOverflow / 0.035, 1700);
            measurements.forEach(({ track, overflow }) => {
                track.style.removeProperty("animation");
                if (overflow <= 1) return;
                track.style.setProperty("--translate_width_fsd", `-${overflow + 5}px`);
                track.style.setProperty("--meta-scroll-duration", `${animationDuration}ms`);
                track.classList.add("is-overflowing");
            });
        });
    }

    function updateLyricsBounds() {
        if (!CFM.get("lyricsDisplay") || !DOM.lyrics?.isConnected) return;
        const artwork = DOM.container.querySelector<HTMLElement>("#fsd-art");
        const controls = DOM.container.querySelector<HTMLElement>("#fsd-status");
        const progress = DOM.container.querySelector<HTMLElement>("#fsd-progress-parent");
        if (!artwork || !controls) return;

        const containerRect = DOM.container.getBoundingClientRect();
        const artworkRect = artwork.getBoundingClientRect();
        const controlsRect = controls.getBoundingClientRect();
        const progressRect = progress?.getBoundingClientRect();
        const controlsBottom =
            controlsRect.height > 0 ? controlsRect.bottom : (progressRect?.bottom ?? 0);
        const unscaledArtworkTop =
            artworkRect.top - (artwork.offsetHeight - artworkRect.height) / 2;
        const top = unscaledArtworkTop - containerRect.top;
        const height = controlsBottom - unscaledArtworkTop;
        if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return;

        DOM.container.style.setProperty("--lyrics-container-top", `${top}px`);
        DOM.container.style.setProperty("--lyrics-container-height", `${height}px`);
    }

    function updatePlaybackLayout(evt?: any) {
        const isPaused =
            evt?.data?.is_paused ?? evt?.data?.isPaused ?? !Spicetify.Player.isPlaying();
        DOM.container.classList.toggle("playback-paused", Boolean(isPaused));
    }

    function render() {
        DOM.container.classList.toggle("lyrics-active", Boolean(CFM.get("lyricsDisplay")));
        Utils.toggleQueuePanel(null, false);
        DOM.container.classList.toggle(
            "vertical-mode",
            (CFM.get("verticalMonitorSupport") as Settings["verticalMonitorSupport"]) &&
                window.innerWidth < window.innerHeight,
        );
        document.body.classList.toggle(
            "vertical-mode",
            (CFM.get("verticalMonitorSupport") as Settings["verticalMonitorSupport"]) &&
                window.innerWidth < window.innerHeight,
        );
        DOM.container.setAttribute("data-locale", LOCALE);
        DOM.container.setAttribute("mode", CFM.getMode());
        DOM.container.classList.remove("lyrics-hide-force");

        applyLyricsScale();

        Spicetify.Player.removeEventListener("songchange", updateInfo);
        Spicetify.Player.removeEventListener("onplaypause", updatePlayerControls);
        Spicetify.Player.removeEventListener("onplaypause", updatePlayingIcon);
        Spicetify.Player.removeEventListener("onplaypause", updatePlaybackLayout);
        document.removeEventListener("fullscreenchange", fullScreenListener);

        Spicetify.Platform.PlayerAPI._events.removeListener("queue_update", updateUpNext);
        Spicetify.Platform.PlayerAPI._events.removeListener("update", updateUpNextShow);
        Spicetify.Player.removeEventListener("onprogress", handleLyricsProgress);
        Spicetify.Platform.PlayerAPI._events.removeListener(
            "queue_update",
            handleLyricsQueueUpdate,
        );
        window.removeEventListener("resize", resizeEvents);
        UpNext.upNextShown = false;

        cancelResize();
        if (metadataFrameId !== null) {
            cancelAnimationFrame(metadataFrameId);
            metadataFrameId = null;
        }
        Background.stop();

        handleMouseMoveDeactivation();

        const transitionTime = Number(CFM.get("backAnimationTime"));
        DOM.style.textContent = `
        #full-screen-display {
            --lyrics-alignment: left;
            --right-margin-lyrics: 0px;
            --icons-display: ${CFM.get("icons") ? "inline-block" : "none"};
            --fs-transition: ${
                Number.isFinite(transitionTime) ? Math.min(10, Math.max(0, transitionTime)) : 0
            }s;
       }
       `;

        if (CFM.get("lyricsDisplay")) {
            Lyrics.teardown();
        }
        DOM.container.innerHTML = getHtmlContent();

        DOM.back = DOM.container.querySelector("canvas")!;
        DOM.back.width = window.innerWidth;
        DOM.back.height = window.innerHeight;

        DOM.cover = DOM.container.querySelector("#fsd-art-image")!;
        DOM.title = DOM.container.querySelector("#fsd-title-text-track")!;
        DOM.artist = DOM.container.querySelector("#fsd-artist .fsd-artist-list")!;
        DOM.album = DOM.container.querySelector("#fsd-album span")!;
        if (CFM.get("lyricsDisplay")) {
            DOM.lyrics = DOM.container.querySelector("#fad-lyrics-container")!;
            Lyrics.attach(DOM.lyrics);
        }

        if (CFM.get("upnextDisplay") !== "never") {
            DOM.fsd_myUp = DOM.container.querySelector("#fsd-upnext-container")!;
            DOM.fsd_myUp.onclick = Spicetify.Player.next;
            DOM.fsd_nextCover = DOM.container.querySelector("#fsd_next_art_image")!;
            DOM.fsd_up_next_text = DOM.container.querySelector("#fsd_up_next_text")!;
            DOM.fsd_next_tit_art = DOM.container.querySelector("#fsd_next_tit_art")!;
            DOM.fsd_next_tit_art_inner = DOM.container.querySelector("#fsd_next_tit_art_inner")!;
            DOM.fsd_first_span = DOM.container.querySelector("#fsd_first_span")!;
            DOM.fsd_second_span = DOM.container.querySelector("#fsd_second_span")!;
        }
        if (CFM.get("icons")) {
            DOM.playingIcon = DOM.container.querySelector("#playing-icon")!;

            //Clicking on playing icon disables it and remembers the config
            DOM.playingIcon.onclick = () => {
                CFM.set("titleMovingIcon", false);
                DOM.playingIcon.classList.add("hidden");
                DOM.pausedIcon.classList.remove("hidden");
            };
            DOM.pausedIcon = DOM.container.querySelector("#paused-icon")!;
            DOM.pausedIcon.onclick = () => {
                CFM.set("titleMovingIcon", true);
                DOM.playingIcon.classList.remove("hidden");
                DOM.pausedIcon.classList.add("hidden");
                updatePlayingIcon({ data: { is_paused: !Spicetify.Player.isPlaying() } });
            };
        }
        if (CFM.get("playerControls") !== "never") {
            DOM.play = DOM.container.querySelector("#fsd-play")!;
            DOM.play.onclick = () => {
                Utils.fadeAnimation(DOM.play);
                Spicetify.Player.togglePlay();
            };
            DOM.nextControl = DOM.container.querySelector("#fsd-next")!;
            DOM.nextControl.onclick = () => {
                Utils.fadeAnimation(DOM.nextControl, "fade-ri");
                Spicetify.Player.next();
            };
            DOM.backControl = DOM.container.querySelector("#fsd-back")!;
            DOM.backControl.onclick = () => {
                Utils.fadeAnimation(DOM.backControl, "fade-le");
                Spicetify.Player.back();
            };
        }
    }

    function toggleQueue() {
        Utils.toggleQueue(null);
    }

    function handleNavigation(navigateUri: string) {
        if (!/^spotify:[a-z][a-z0-9-]*(?::[^:/?#\s]+)+$/i.test(navigateUri)) return;
        const formattedUri = `/${navigateUri
            .split(":")
            .slice(1)
            .map((part) => encodeURIComponent(part))
            .join("/")}`;
        deactivate();
        setTimeout(() => {
            Spicetify.Platform.History.push(formattedUri);
        }, 100);
    }

    /**
     * Update song details like title, artists, album etc.
     */
    let infoSequence = 0;
    async function updateInfo() {
        const sequence = ++infoSequence;
        const meta = Spicetify.Player.data.item?.metadata;
        if (!meta) return;

        if (CFM.get("lyricsDisplay")) {
            loadCurrentLyrics();
        }

        // prepare title
        let songName = meta?.title;
        if (CFM.get("trimTitle")) {
            songName = Utils.trimTitle(songName);
        }

        // prepare artist
        let artistData: string[][];
        const artistNameList = Object.keys(meta)
            .filter((key) => key.startsWith("artist_name"))
            .sort() as Array<keyof typeof meta>;

        const artistUriList = Object.keys(meta)
            .filter((key) => key.startsWith("artist_uri"))
            .sort() as Array<keyof typeof meta>;

        artistData = artistNameList.map((key, index) => [meta[key], meta[artistUriList[index]]]);

        // prepare album
        let albumText: string,
            updatedAlbum = false;
        if (CFM.get("showAlbum") !== "never") {
            albumText = meta?.album_title || "";
            if (CFM.get("trimAlbum")) {
                albumText = Utils.trimTitle(albumText);
            }
            const albumURI = meta?.album_uri;
            if (albumURI?.startsWith("spotify:album:") && CFM.get("showAlbum") === "date") {
                Utils.getAlbumReleaseDate(albumURI, LOCALE).then((releaseDate) => {
                    if (sequence !== infoSequence) return;
                    albumText += releaseDate;
                    if (updatedAlbum) {
                        DOM.album.innerText = albumText || "";
                        updateMetadataOverflow();
                    }
                });
            }
        }

        void Background.updateBackground(meta);

        // prepare cover image
        DOM.coverImg.src = meta?.image_xlarge_url;

        // update all the things on cover load
        DOM.coverImg.onload = () => {
            if (sequence !== infoSequence) return;
            DOM.cover.style.backgroundImage = `url("${DOM.coverImg.src}")`;
            DOM.title.innerText = songName || "";
            DOM.title.setAttribute("uri", Spicetify.Player.data?.item?.uri || "");

            // combine artist in a list with each span and separated by comma
            DOM.artist.replaceChildren();
            artistData.forEach(([name, uri], index) => {
                if (index > 0) DOM.artist.append(document.createTextNode(", "));
                const artist = document.createElement("span");
                artist.textContent = name ?? "";
                if (uri) artist.dataset.uri = uri;
                artist.onclick = () => handleNavigation(artist.dataset.uri ?? "");
                DOM.artist.append(artist);
            });

            if (DOM.album) {
                DOM.album.innerText = albumText || "";
                DOM.album.setAttribute("uri", meta?.album_uri || "");
                updatedAlbum = true;
            }
            updateMetadataOverflow();
            updateLyricsBounds();
        };

        // Placeholder
        DOM.coverImg.onerror = () => {
            if (sequence !== infoSequence || DOM.coverImg.src === ICONS.OFFLINE_SVG) return;
            console.error("Check your Internet! Unable to load Image");
            DOM.coverImg.src = ICONS.OFFLINE_SVG;
        };
    }

    function updatePlayingIcon(evt: any) {
        if (evt.data.is_paused || evt.data.isPaused) {
            DOM.pausedIcon.classList.remove("hidden");
            DOM.playingIcon.classList.add("hidden");
        } else {
            DOM.pausedIcon.classList.toggle("hidden", CFM.get("titleMovingIcon") as boolean);
            DOM.playingIcon.classList.toggle("hidden", !CFM.get("titleMovingIcon"));
        }
    }

    let curTimer: ReturnType<typeof setTimeout>;

    function hideCursor() {
        if (curTimer) {
            clearTimeout(curTimer);
        }
        DOM.container.style.cursor = "default";
        curTimer = setTimeout(() => (DOM.container.style.cursor = "none"), 2000);
    }

    function handleMouseMoveActivation() {
        DOM.container.addEventListener("mousemove", hideCursor);
        hideCursor();
        if (CFM.get("playerControls") === "mousemove") {
            DOM.container.addEventListener("mousemove", hidePlayerControls);
            PlayerControls.hidePlayerControls();
        }
    }

    function handleMouseMoveDeactivation() {
        DOM.container.removeEventListener("mousemove", hideCursor);
        DOM.container.removeEventListener("mousemove", hidePlayerControls);

        if (curTimer) clearTimeout(curTimer);
        if (PlayerControls.playerControlsTimer) clearTimeout(PlayerControls.playerControlsTimer);
    }

    function fullScreenListener() {
        if (
            document.fullscreenElement === null &&
            CFM.get("enableFullscreen") &&
            Utils.isModeActivated()
        ) {
            deactivate();
        }
    }

    const loadCurrentLyrics = () => {
        if (!CFM.get("lyricsDisplay")) return;
        const uri = Spicetify.Player.data.item?.uri;
        if (uri) Lyrics.loadLyrics(uri);
        Lyrics.prefetchNextLyrics();
    };

    const handleLyricsProgress = () => Lyrics.prefetchNextLyrics();
    const handleLyricsQueueUpdate = () => Lyrics.prefetchNextLyrics();

    let activationSequence = 0;

    async function activate() {
        const sequence = ++activationSequence;
        Utils.toggleQueuePanel(null, true);
        document.body.classList.add(...CLASSES_TO_ADD);
        if (CFM.get("enableFullscreen")) await Utils.fullScreenOn()?.catch(() => undefined);
        else await Utils.fullScreenOff()?.catch(() => undefined);
        setTimeout(() => {
            if (sequence !== activationSequence || !Utils.isModeActivated()) return;
            updateInfo();
            window.addEventListener("resize", resizeEvents);
            resizeEvents();
            DOM.container.querySelectorAll(".fsd-song-meta span").forEach((span) => {
                (span as HTMLElement).onclick = (evt: any) => {
                    handleNavigation(evt.target?.getAttribute("uri") ?? "");
                };
            });
        }, 200);
        Spicetify.Player.addEventListener("songchange", updateInfo);
        handleMouseMoveActivation();
        DOM.container.querySelector<HTMLElement>("#fsd-foreground")!.oncontextmenu =
            ConfigManager.openConfig.bind(ConfigManager);
        DOM.container.querySelector<HTMLElement>("#fsd-foreground")!.ondblclick = deactivate;
        DOM.back.oncontextmenu = ConfigManager.openConfig.bind(ConfigManager);
        DOM.back.ondblclick = deactivate;
        if (CFM.get("upnextDisplay") !== "never") {
            UpNext.updateUpNextShow();
            Spicetify.Platform.PlayerAPI._events.addListener("queue_update", updateUpNext);
            Spicetify.Platform.PlayerAPI._events.addListener("update", updateUpNextShow);
        }
        if (CFM.get("volumeDisplay") !== "never") {
            ReactDOM.render(
                <SeekableVolumeBar state={CFM.get("volumeDisplay") as Settings["volumeDisplay"]} />,
                DOM.container.querySelector("#fsd-volume-parent"),
            );
        }
        if (CFM.get("icons")) {
            updatePlayingIcon({ data: { is_paused: !Spicetify.Player.isPlaying() } });
            Spicetify.Player.addEventListener("onplaypause", updatePlayingIcon);
        }
        if (CFM.get("progressBarDisplay") !== "never") {
            ReactDOM.render(
                <SeekableProgressBar
                    state={CFM.get("progressBarDisplay") as Settings["progressBarDisplay"]}
                />,
                DOM.container.querySelector("#fsd-progress-parent"),
            );
        }
        if (CFM.get("playerControls") !== "never") {
            PlayerControls.updatePlayerControls({
                data: { is_paused: !Spicetify.Player.isPlaying() },
            });
            Spicetify.Player.addEventListener("onplaypause", updatePlayerControls);
        }
        document.querySelector(".Root__top-container")?.append(DOM.style, DOM.container);
        updatePlaybackLayout({
            data: { is_paused: !Spicetify.Player.isPlaying() },
        });
        Spicetify.Player.addEventListener("onplaypause", updatePlaybackLayout);
        if (CFM.get("lyricsDisplay")) {
            // hard reset lyric renderer to avoid stale raf state after re-entry
            Lyrics.teardown();
            Lyrics.attach(DOM.lyrics);
            loadCurrentLyrics();
            setTimeout(() => {
                if (sequence === activationSequence && Utils.isModeActivated()) loadCurrentLyrics();
            }, 400);
            Spicetify.Player.addEventListener("onprogress", handleLyricsProgress);
            Spicetify.Platform.PlayerAPI._events.addListener(
                "queue_update",
                handleLyricsQueueUpdate,
            );
        }
        Spicetify.Mousetrap.bind("f11", fsToggle);
        document.addEventListener("fullscreenchange", fullScreenListener);
        Spicetify.Mousetrap.bind("esc", deactivate);
        if (CFM.get("lyricsDisplay")) {
            Spicetify.Mousetrap.bind("l", Lyrics.toggleLyrics);
        }
        Spicetify.Mousetrap.bind("c", () => {
            const popup = document.querySelector("body > generic-modal");
            if (popup) popup.remove();
            else ConfigManager.openConfig();
        });
        Spicetify.Mousetrap.bind("q", toggleQueue);
    }

    async function deactivate() {
        activationSequence += 1;
        infoSequence += 1;
        Utils.toggleQueuePanel(null, false);
        Background.stop();
        Spicetify.Player.removeEventListener("songchange", updateInfo);
        Spicetify.Player.removeEventListener("onplaypause", updatePlaybackLayout);
        handleMouseMoveDeactivation();
        window.removeEventListener("resize", resizeEvents);
        cancelResize();
        if (metadataFrameId !== null) {
            cancelAnimationFrame(metadataFrameId);
            metadataFrameId = null;
        }
        if (CFM.get("upnextDisplay") !== "never") {
            UpNext.upNextShown = false;
            Spicetify.Platform.PlayerAPI._events.removeListener("queue_update", updateUpNext);
            Spicetify.Platform.PlayerAPI._events.removeListener("update", updateUpNextShow);
        }
        [
            DOM.container.querySelector("#fsd-volume-parent"),
            DOM.container.querySelector("#fsd-progress-parent"),
        ].forEach((root) => {
            if (root) ReactDOM.unmountComponentAtNode(root);
        });
        if (CFM.get("icons")) {
            Spicetify.Player.removeEventListener("onplaypause", updatePlayingIcon);
        }
        if (CFM.get("playerControls") !== "never") {
            Spicetify.Player.removeEventListener("onplaypause", updatePlayerControls);
        }
        if (CFM.get("lyricsDisplay")) {
            Spicetify.Player.removeEventListener("onprogress", handleLyricsProgress);
            Spicetify.Platform.PlayerAPI._events.removeListener(
                "queue_update",
                handleLyricsQueueUpdate,
            );
            Lyrics.teardown();
        }
        document.body.classList.remove(...CLASSES_TO_ADD);
        UpNext.upNextShown = false;
        if (CFM.get("enableFullscreen")) {
            await Utils.fullScreenOff()?.catch(() => undefined);
        }
        const popup = document.querySelector("body > generic-modal");
        if (popup) popup.remove();
        DOM.style.remove();
        DOM.container.remove();
        document.removeEventListener("fullscreenchange", fullScreenListener);

        Spicetify.Mousetrap.unbind("f11");
        Spicetify.Mousetrap.unbind("esc");
        Spicetify.Mousetrap.unbind("l");
        Spicetify.Mousetrap.unbind("c");
        Spicetify.Mousetrap.unbind("q");
    }

    function fsToggle() {
        if (CFM.get("enableFullscreen")) {
            CFM.set("enableFullscreen", false);
            render();
            activate();
        } else {
            CFM.set("enableFullscreen", true);
            render();
            activate();
        }
    }

    let resizeFrameId: number | null = null;
    function cancelResize() {
        if (resizeFrameId === null) return;
        cancelAnimationFrame(resizeFrameId);
        resizeFrameId = null;
    }

    function resizeEvents() {
        if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
        resizeFrameId = requestAnimationFrame(() => {
            resizeFrameId = null;
            applyResize();
        });
    }

    function applyResize() {
        if (CFM.get("upnextDisplay") !== "never") UpNext.updateUpNext();
        void Background.updateBackground(Spicetify.Player.data.item?.metadata, true);
        DOM.container.classList.toggle(
            "vertical-mode",
            (CFM.get("verticalMonitorSupport") as Settings["verticalMonitorSupport"]) &&
                window.innerWidth < window.innerHeight,
        );

        document.body.classList.toggle(
            "vertical-mode",
            (CFM.get("verticalMonitorSupport") as Settings["verticalMonitorSupport"]) &&
                window.innerWidth < window.innerHeight,
        );
        applyLyricsScale();
        updateMetadataOverflow();
        updateLyricsBounds();
    }

    ConfigManager.init(
        render,
        activate,
        deactivate,
        openwithDef,
        openwithTV,
        Background.updateBackground.bind(Background),
        UpNext.updateUpNextShow.bind(UpNext),
        Background.updateMainColor.bind(Background),
    );

    const extraBar = HtmlSelectors.getExtraBarSelector() as HTMLElement;
    if (CFM.getGlobal("fsHideOriginal")) {
        const lastExtraBarItem = extraBar?.lastElementChild as HTMLElement | null;
        if (
            lastExtraBarItem?.classList.contains("control-button") ||
            lastExtraBarItem?.title === "Full screen"
        )
            lastExtraBarItem.remove();
    }
    if (CFM.getGlobal("activationTypes") != "keys") {
        if (CFM.getGlobal("buttonActivation") !== "tv") {
            // Add Full Screen Button on bottom bar
            const defButton = document.createElement("button");
            defButton.classList.add("button");
            defButton.id = "fullscreen-default-button";
            defButton.setAttribute("title", translations[LOCALE].fullscreenBtnDesc);

            defButton.innerHTML = ICONS.FULLSCREEN;
            defButton.onclick = openwithDef;

            defButton.oncontextmenu = (evt) => {
                evt.preventDefault();
                CFM.setMode("def");
                ConfigManager.openConfig();
            };
            (extraBar as HTMLElement)?.append(defButton);
        }

        if (CFM.getGlobal("buttonActivation") !== "def") {
            // Add TV Mode Button on top bar
            const tvButton = document.createElement("button");

            tvButton.innerHTML = ICONS.TV_MODE;
            tvButton.id = "fullscreen-tv-button";
            tvButton.setAttribute("title", translations[LOCALE].tvBtnDesc);

            tvButton.onclick = openwithTV;

            tvButton.classList.add(
                "tm-button",
                "Button-buttonTertiary-small-isUsingKeyboard-useBrowserDefaultFocusStyle-condensedAll",
                "Button-small-small-buttonTertiary-condensedAll-isUsingKeyboard-useBrowserDefaultFocusStyle",
                "Button-buttonTertiary-small-small-isUsingKeyboard-useBrowserDefaultFocusStyle-condensedAll",
                "encore-text-body-small-bold",
                "main-globalNav-buddyFeed",
                "Button-sc-1dqy6lx-0",
            );
            HtmlSelectors.getTopBarSelector()?.prepend(tvButton);

            // document.querySelector(TOP_BAR_SELECTOR)?.append(tvButton);
            tvButton.oncontextmenu = (evt) => {
                evt.preventDefault();
                CFM.setMode("tv");
                ConfigManager.openConfig();
            };
        }
    }

    render();

    switch (CFM.getGlobal("autoLaunch")) {
        case "default":
            openwithDef();
            break;
        case "tvmode":
            openwithTV();
            break;
        case "lastused":
            if (CFM.getGlobal("tvMode")) openwithTV();
            else openwithDef();
            break;
        case "never":
        default:
            break;
    }
}

export default main;
