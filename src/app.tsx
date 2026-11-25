import { APPLE_SYMBOLS } from "./constants/apple-system-symbols";
import { Queue } from "./ui/components/Queue/Queue";
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import React from "react";
import ReactDOM from "react-dom";

import Utils from "./utils/utils";
import {
    animateFeedback,
    cancelFeedback,
    initializeMotionTokens,
    MOTION,
    prefersReducedMotion,
} from "./utils/motion";
import CFM from "./utils/config";
import { getLyricFontSize } from "./utils/lyric-font-size";
import { getTextLanguageTag } from "./utils/text-presentation";
import { applyTypography } from "./utils/typography";

import translations from "./resources/strings";
import ICONS, { CLASSES_TO_ADD } from "./constants";
import HtmlSelectors from "./utils/selectors";
import { createOverflowScrollAnimation, getOverflowScrollTiming } from "./utils/overflow-scroll";

import { getPlaybackPaused, type PlaybackStateEvent } from "./services/playback-state";
import { getHtmlContent } from "./services/html-creator";
import { startSharedBridgePresence } from "./services/lyrics-bridge";
import { ReleaseUpdater } from "./services/release-updater";

import SeekableProgressBar from "./ui/components/ProgressBar/ProgressBar";

import { DOM } from "./ui/elements";
import { ConfigManager } from "./ui/components/Config/Config";
import { UpNext } from "./ui/components/UpNext/UpNext";
import { PlayerControls } from "./ui/components/PlayerControls/PlayerControls";
import { Cover } from "./ui/components/Cover/Cover";
import { Lyrics } from "./ui/components/Lyrics/Lyrics";
import { Background } from "./utils/background";

import "./styles/base.scss";
import "./styles/defaultMode.scss";
import "./styles/settings.scss";
import "./ui/components/Cover/styles.scss";

async function startFullscape() {
    initializeMotionTokens();
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
    DOM.init();
    startSharedBridgePresence();

    // Keep a keyboard entry available when Spotify changes or delays its bottom bar.
    if (CFM.getGlobal("activationTypes") !== "btns" || !HtmlSelectors.getExtraBarSelector()) {
        Spicetify.Mousetrap.bind("f", toggleFullscape);
    }

    function toggleFullscape() {
        return Utils.isModeActivated() ? deactivate() : activate();
    }

    function getLocale() {
        const locale = CFM.getGlobal("locale");
        return Object.hasOwn(translations, locale) ? locale : "en-US";
    }

    let showingQueue = false;
    function updateLyricsTools() {
        const strings = translations[getLocale()].sideView;
        const translation = DOM.container.querySelector<HTMLButtonElement>("#fullscape-translation");
        if (translation) {
            translation.setAttribute("aria-label", strings.translation);
            translation.setAttribute(
                "aria-pressed",
                String(Boolean(CFM.get("showLyricsTranslation"))),
            );
            translation.disabled = showingQueue || !CFM.get("lyricsDisplay");
        }
        if (DOM.sideView) {
            DOM.sideView.innerHTML = showingQueue ? APPLE_SYMBOLS.lyrics : APPLE_SYMBOLS.list;
            DOM.sideView.setAttribute(
                "aria-label",
                showingQueue ? strings.showLyrics : strings.showQueue,
            );
            DOM.sideView.setAttribute("aria-pressed", String(showingQueue));
        }
    }
    function setQueueVisible(visible: boolean) {
        if (!visible) Queue.cancelHandoff();
        showingQueue = visible;
        DOM.container.classList.toggle("side-view-queue", visible);
        if (DOM.lyrics) { DOM.lyrics.inert = visible; DOM.lyrics.setAttribute("aria-hidden", String(visible)); }
        if (DOM.queue) { DOM.queue.inert = !visible; DOM.queue.setAttribute("aria-hidden", String(!visible)); }
        if (visible) Queue.update();
        updateLyricsTools();
    }
    const showLyricsTools = PlayerControls.showLyricsTools.bind(PlayerControls);

    const updatePlayerControls = PlayerControls.updatePlayerControls.bind(PlayerControls);
    const updateUpNext = UpNext.updateUpNext.bind(UpNext);
    const updateUpNextShow = UpNext.updateUpNextShow.bind(UpNext);
    let metadataFrameId: number | null = null;
    let metadataAnimations: Animation[] = [];

    function cancelMetadataAnimations() {
        metadataAnimations.forEach((animation) => animation.cancel());
        metadataAnimations = [];
        DOM.container
            .querySelectorAll<HTMLElement>(
                "#fullscape-title-text-track, #fullscape-secondary-meta-track",
            )
            .forEach((track) => {
                track.style.removeProperty("transform");
            });
    }

    function updateMetadataOverflow() {
        if (metadataFrameId !== null) cancelAnimationFrame(metadataFrameId);
        metadataFrameId = requestAnimationFrame(() => {
            metadataFrameId = null;
            cancelMetadataAnimations();
            const targets = [
                {
                    viewport: DOM.container.querySelector<HTMLElement>(
                        "#fullscape-title-text-viewport",
                    ),
                    track: DOM.container.querySelector<HTMLElement>("#fullscape-title-text-track"),
                },
                {
                    viewport: DOM.container.querySelector<HTMLElement>("#fullscape-secondary-meta"),
                    track: DOM.container.querySelector<HTMLElement>(
                        "#fullscape-secondary-meta-track",
                    ),
                },
            ].filter(
                (
                    target,
                ): target is {
                    viewport: HTMLElement;
                    track: HTMLElement;
                } => Boolean(target.viewport && target.track),
            );

            const measurements = targets.map((target) => ({
                ...target,
                // The viewport's scrollable width includes the padding around the text.
                overflow: target.viewport.scrollWidth - target.viewport.clientWidth,
            }));
            const maxOverflow = Math.max(0, ...measurements.map(({ overflow }) => overflow));
            if (maxOverflow <= 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
                return;

            const timing = getOverflowScrollTiming(maxOverflow);
            const timelineTime = document.timeline.currentTime;
            const synchronizedStartTime =
                typeof timelineTime === "number" ? timelineTime : performance.now();

            measurements.forEach(({ track, overflow }) => {
                if (overflow <= 1) return;
                const animation = createOverflowScrollAnimation(track, overflow, timing);
                metadataAnimations.push(animation);
            });
            metadataAnimations.forEach((animation) => {
                animation.startTime = synchronizedStartTime;
            });
        });
    }

    function updateLyricsBounds() {
        if (
            !CFM.get("lyricsDisplay") ||
            !DOM.lyrics?.isConnected ||
            DOM.container.classList.contains("vertical-mode")
        ) {
            return;
        }
        const artwork = DOM.container.querySelector<HTMLElement>("#fullscape-art");
        const controls = DOM.container.querySelector<HTMLElement>("#fullscape-status");
        const progress = DOM.container.querySelector<HTMLElement>("#fullscape-progress-parent");
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

    function updatePlaybackLayout(evt?: Event | PlaybackStateEvent) {
        const isPaused = getPlaybackPaused(evt) ?? !Spicetify.Player.isPlaying();
        DOM.container.classList.toggle("playback-paused", Boolean(isPaused));
    }

    function removePlaybackListeners() {
        const player = Spicetify.Player;
        player.removeEventListener("songchange", handleSongChange);
        player.removeEventListener("onplaypause", updatePlayerControls);
        player.removeEventListener("onplaypause", updatePlayingIcon);
        player.removeEventListener("onplaypause", updatePlaybackLayout);
        player.removeEventListener("onprogress", handleLyricsProgress);

        const playerEvents = Spicetify.Platform.PlayerAPI._events;
        playerEvents.removeListener("queue_update", Queue.scheduleUpdate);
        playerEvents.removeListener("queue_update", updateUpNext);
        playerEvents.removeListener("queue_update", handleLyricsQueueUpdate);
        playerEvents.removeListener("update", updateUpNextShow);

        document.removeEventListener("fullscreenchange", fullscreenChangeListener);
    }

    function stopDisplayUpdates() {
        UpNext.teardown();
        window.removeEventListener("resize", resizeEvents);
        cancelResize();
        if (metadataFrameId !== null) {
            cancelAnimationFrame(metadataFrameId);
            metadataFrameId = null;
        }
        cancelMetadataAnimations();
        Background.stop();
        handleMouseMoveDeactivation();
        const progressRoot = DOM.container.querySelector("#fullscape-progress-parent");
        if (progressRoot) ReactDOM.unmountComponentAtNode(progressRoot);
    }

    function render() {
        infoSequence += 1;
        const locale = getLocale();
        applyTypography(CFM.get("typography"));
        DOM.container.classList.toggle("lyrics-active", Boolean(CFM.get("lyricsDisplay")));

        updateDisplayLayout();
        DOM.container.setAttribute("data-locale", locale);
        DOM.container.classList.remove("lyrics-hide-force");
        DOM.container.style.setProperty(
            "--lyrics-font-size",
            `${getLyricFontSize(CFM.get("lyricsSize"))}px`,
        );
        const entryButton = document.getElementById("fullscape-default-button");
        if (entryButton) updateEntryButtonLabel(entryButton);

        removePlaybackListeners();
        stopDisplayUpdates();

        DOM.style.textContent = `
        #fullscape-display {
            --right-margin-lyrics: 0px;
            --icons-display: ${CFM.get("icons") ? "inline-block" : "none"};
       }
       `;

        // Clean up the previous renderer even when the setting was just disabled.
        Lyrics.teardown();
        DOM.lyrics = null;
        Cover.teardown();
        Queue.teardown();
        DOM.container.innerHTML = getHtmlContent(locale);

        DOM.back = DOM.container.querySelector("#fullscape-background")!;
        DOM.back.width = window.innerWidth;
        DOM.back.height = window.innerHeight;
        DOM.fluidBack = DOM.container.querySelector("#fullscape-fluid-background")!;

        DOM.cover = DOM.container.querySelector("#fullscape-art-image")!;
        Cover.attach();
        DOM.queue = DOM.container.querySelector("#fullscape-queue-container");
        Queue.attach(DOM.queue!);
        DOM.sideView = DOM.container.querySelector("#fullscape-side-view")!;
        DOM.sideView.onclick = toggleQueue;
        DOM.container.querySelector<HTMLButtonElement>("#fullscape-translation")!.onclick = () => {
            Lyrics.toggleTranslation(); updateLyricsTools();
        };
        DOM.title = DOM.container.querySelector("#fullscape-title-text-track")!;
        DOM.artist = DOM.container.querySelector("#fullscape-artist .fullscape-artist-list")!;
        DOM.album = DOM.container.querySelector("#fullscape-album span")!;
        if (CFM.get("lyricsDisplay")) {
            DOM.lyrics = DOM.container.querySelector("#fad-lyrics-container")!;
            Lyrics.attach(DOM.lyrics);
        }

        setQueueVisible(false);

        if (CFM.get("upnextDisplay") !== "never") {
            DOM.upNextContainer = DOM.container.querySelector("#fullscape-upnext-container")!;
            DOM.upNextContainer.onclick = Spicetify.Player.next;
            DOM.upNextCover = DOM.container.querySelector("#fullscape-up-next-cover")!;
            DOM.upNextLabel = DOM.container.querySelector("#upNextLabel")!;
            DOM.upNextTitleViewport = DOM.container.querySelector("#upNextTitleViewport")!;
            DOM.upNextTitleTrack = DOM.container.querySelector("#upNextTitleTrack")!;
            DOM.upNextPrimaryText = DOM.container.querySelector("#upNextPrimaryText")!;
            DOM.upNextSecondaryText = DOM.container.querySelector("#upNextSecondaryText")!;
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
                updatePlayingIcon();
            };
        }
        DOM.play = DOM.container.querySelector("#fullscape-play")!;
        DOM.play.onclick = () => {
            Spicetify.Player.togglePlay();
        };
        DOM.nextControl = DOM.container.querySelector("#fullscape-next")!;
        DOM.nextControl.onclick = () => {
            Utils.fadeAnimation(DOM.nextControl, "fade-ri");
            Spicetify.Player.next();
        };
        DOM.backControl = DOM.container.querySelector("#fullscape-back")!;
        DOM.backControl.onclick = () => {
            Utils.fadeAnimation(DOM.backControl, "fade-le");
            Spicetify.Player.back();
        };
    }

    function toggleQueue() {
        setQueueVisible(!showingQueue);
    }

    function handleNavigation(navigateUri: string) {
        if (!/^spotify:[a-z][a-z0-9-]*(?::[^:/?#\s]+)+$/i.test(navigateUri)) return;
        const formattedUri = `/${navigateUri
            .split(":")
            .slice(1)
            .map((part) => encodeURIComponent(part))
            .join("/")}`;
        void deactivate().then(() => Spicetify.Platform.History.push(formattedUri));
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
                Utils.getAlbumReleaseDate(albumURI, getLocale()).then((releaseDate) => {
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
            const previousArtwork = Cover.artworkSource;
            const previousTitle = DOM.title.getAttribute("uri");
            DOM.cover.style.backgroundImage = `url("${DOM.coverImg.src}")`;
            Cover.updateImage(previousArtwork, Queue.hasIncomingArtwork);
            Queue.landIncoming();
            DOM.title.innerText = songName || "";
            Lyrics.updateTitleLanguage();
            DOM.title.setAttribute("uri", Spicetify.Player.data?.item?.uri || "");

            // combine artist in a list with each span and separated by comma
            DOM.artist.replaceChildren();
            artistData.forEach(([name, uri], index) => {
                if (index > 0) {
                    const separator = document.createElement("span");
                    separator.className = "fullscape-artist-separator";
                    separator.textContent = ",";
                    separator.setAttribute("aria-hidden", "true");
                    DOM.artist.append(separator);
                }
                const artist = document.createElement("span");
                artist.textContent = name ?? "";
                artist.lang = getTextLanguageTag(artist.textContent);
                if (uri) artist.dataset.uri = uri;
                artist.onclick = () => handleNavigation(artist.dataset.uri ?? "");
                DOM.artist.append(artist);
            });

            if (DOM.album) {
                DOM.album.innerText = albumText || "";
                DOM.album.lang = getTextLanguageTag(albumText || "");
                DOM.album.setAttribute("uri", meta?.album_uri || "");
                updatedAlbum = true;
            }
            updateMetadataOverflow();
            updateLyricsBounds();
            if (previousTitle && previousTitle !== DOM.title.getAttribute("uri")) {
                animateFeedback(DOM.container.querySelector("#fullscape-details"), [
                    { opacity: 0.35 },
                    { opacity: 1 },
                ]);
            }
        };

        // Placeholder
        DOM.coverImg.onerror = () => {
            if (sequence !== infoSequence || DOM.coverImg.src === ICONS.OFFLINE_SVG) return;
            console.error("Check your Internet! Unable to load Image");
            DOM.coverImg.src = ICONS.OFFLINE_SVG;
        };
    }

    function updatePlayingIcon(evt?: Event | PlaybackStateEvent) {
        if (getPlaybackPaused(evt) ?? !Spicetify.Player.isPlaying()) {
            DOM.pausedIcon.classList.remove("hidden");
            DOM.playingIcon.classList.add("hidden");
        } else {
            DOM.pausedIcon.classList.toggle("hidden", CFM.get("titleMovingIcon") as boolean);
            DOM.playingIcon.classList.toggle("hidden", !CFM.get("titleMovingIcon"));
        }
    }

    let curTimer: ReturnType<typeof setTimeout>;

    function hideCursor(event?: MouseEvent) {
        if (curTimer) {
            clearTimeout(curTimer);
        }
        DOM.container.classList.remove("fullscape-cursor-hidden");
        DOM.container.style.cursor = "default";
        const isInsideLyrics = Boolean(event?.target && DOM.lyrics?.contains(event.target as Node));
        const delay = isInsideLyrics ? 10_000 : MOTION.controlsIdle;
        curTimer = setTimeout(() => {
            DOM.container.style.cursor = "none";
            DOM.container.classList.add("fullscape-cursor-hidden");
        }, delay);
    }

    function handleMouseMoveActivation() {
        DOM.container.addEventListener("mousemove", hideCursor);
        DOM.container.addEventListener("mousemove", showLyricsTools);
        showLyricsTools();
        hideCursor();
    }

    function handleMouseMoveDeactivation() {
        DOM.container.removeEventListener("mousemove", hideCursor);
        DOM.container.removeEventListener("mousemove", showLyricsTools);
        clearTimeout(PlayerControls.toolsTimer);

        if (curTimer) clearTimeout(curTimer);
    }

    function fullscreenChangeListener() {
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

    const handleLyricsProgress = () => {
        Lyrics.syncPlaybackProgress();
        Lyrics.prefetchNextLyrics();
    };
    const handleLyricsQueueUpdate = () => Lyrics.prefetchNextLyrics();
    function handleSongChange() {
        Queue.captureIncoming();
        Queue.scheduleUpdate();
        void updateInfo();
    }

    let activationSequence = 0;
    let deactivationPromise: Promise<void> | null = null;

    async function activate() {
        if (deactivationPromise) await deactivationPromise;
        Cover.attach();
        Queue.attach(DOM.queue!);
        Spicetify.Platform.PlayerAPI._events.addListener("queue_update", Queue.scheduleUpdate);
        const sequence = ++activationSequence;

        document.body.classList.add(...CLASSES_TO_ADD);
        if (CFM.get("enableFullscreen")) await Utils.enterFullscreen()?.catch(() => undefined);
        else await Utils.exitFullscreen()?.catch(() => undefined);
        setTimeout(() => {
            if (sequence !== activationSequence || !Utils.isModeActivated()) return;
            updateInfo();
            window.addEventListener("resize", resizeEvents);
            resizeEvents();
            DOM.container.querySelectorAll(".fullscape-song-meta span").forEach((span) => {
                (span as HTMLElement).onclick = (evt: any) => {
                    handleNavigation(evt.target?.getAttribute("uri") ?? "");
                };
            });
        }, 200);
        Spicetify.Player.addEventListener("songchange", handleSongChange);
        handleMouseMoveActivation();
        DOM.container.oncontextmenu = ConfigManager.openConfig.bind(ConfigManager);
        DOM.container.querySelector<HTMLElement>("#fullscape-foreground")!.ondblclick = deactivate;
        DOM.back.ondblclick = deactivate;
        if (CFM.get("upnextDisplay") !== "never") {
            UpNext.updateUpNextShow();
            Spicetify.Platform.PlayerAPI._events.addListener("queue_update", updateUpNext);
            Spicetify.Platform.PlayerAPI._events.addListener("update", updateUpNextShow);
        }
        const playbackState = { data: { is_paused: !Spicetify.Player.isPlaying() } };
        if (CFM.get("icons")) {
            updatePlayingIcon(playbackState);
            Spicetify.Player.addEventListener("onplaypause", updatePlayingIcon);
        }
        ReactDOM.render(
            <SeekableProgressBar />,
            DOM.container.querySelector("#fullscape-progress-parent"),
        );
        updatePlayerControls(playbackState);
        Spicetify.Player.addEventListener("onplaypause", updatePlayerControls);
        // Recent Spotify layouts no longer expose the legacy root class.
        const displayHost = document.querySelector(".Root__top-container") ?? document.body;
        displayHost.append(DOM.style, DOM.container);
        animateFeedback(DOM.container, [{ opacity: 0 }, { opacity: 1 }]);
        updatePlaybackLayout(playbackState);
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
        Spicetify.Mousetrap.bind("f11", toggleNativeFullscreen);
        document.addEventListener("fullscreenchange", fullscreenChangeListener);
        Spicetify.Mousetrap.bind("esc", deactivate);
        if (CFM.get("lyricsDisplay")) {
            Spicetify.Mousetrap.bind("l", () => {
                if (showingQueue) setQueueVisible(false);
                else Lyrics.toggleLyrics();
            });
        }
        Spicetify.Mousetrap.bind("c", () => {
            const popup = document.querySelector("body > generic-modal");
            if (popup) popup.remove();
            else ConfigManager.openConfig();
        });
        Spicetify.Mousetrap.bind("q", toggleQueue);
    }

    function deactivate(): Promise<void> {
        if (deactivationPromise) return deactivationPromise;
        deactivationPromise = deactivateDisplay().finally(() => {
            deactivationPromise = null;
        });
        return deactivationPromise;
    }

    async function deactivateDisplay() {
        if (DOM.container.isConnected && !prefersReducedMotion()) {
            const opacity = getComputedStyle(DOM.container).opacity;
            cancelFeedback(DOM.container);
            const animation = DOM.container.animate([{ opacity }, { opacity: 0 }], {
                duration: MOTION.feedback,
                easing: MOTION.ease,
                fill: "forwards",
            });
            await animation.finished.catch(() => undefined);
            animation.cancel();
        }
        Cover.teardown();
        Queue.teardown();
        activationSequence += 1;
        infoSequence += 1;

        removePlaybackListeners();
        stopDisplayUpdates();
        Lyrics.teardown();
        document.body.classList.remove(...CLASSES_TO_ADD);
        if (CFM.get("enableFullscreen")) {
            await Utils.exitFullscreen()?.catch(() => undefined);
        }
        const popup = document.querySelector("body > generic-modal");
        if (popup) popup.remove();
        DOM.style.remove();
        DOM.container.remove();

        Spicetify.Mousetrap.unbind("f11");
        Spicetify.Mousetrap.unbind("esc");
        Spicetify.Mousetrap.unbind("l");
        Spicetify.Mousetrap.unbind("c");
        Spicetify.Mousetrap.unbind("q");
    }

    function toggleNativeFullscreen() {
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
        Queue.cancelHandoff();
        if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
        resizeFrameId = requestAnimationFrame(() => {
            resizeFrameId = null;
            applyResize();
        });
    }

    function updateDisplayLayout() {
        const { innerWidth: width, innerHeight: height } = window;
        const vertical = width < height;
        const aspect = width / height;
        const referenceAspect = 16 / 9;
        const proportional = !vertical && height > 0 && aspect <= 2;
        const compact = proportional && aspect < referenceAspect;
        const compactness = compact
            ? Math.min(1, (referenceAspect - aspect) / (referenceAspect - 4 / 3))
            : 0;
        // Use spare height on narrower displays, with a cap based on available width.
        const scale = Math.min((width / 1920) * (compact ? 1.18 : 1), height / 1080);
        DOM.container.classList.toggle("vertical-mode", vertical);
        DOM.container.classList.toggle("proportional-landscape", proportional);
        DOM.container.classList.toggle("compact-landscape", compact);
        DOM.container.style.setProperty(
            "--fullscape-content-scale",
            String(proportional ? scale : 1),
        );
        DOM.container.style.setProperty(
            "--fullscape-compact-player-width",
            `${50 - 8 * compactness}%`,
        );
    }

    function applyResize() {
        if (CFM.get("upnextDisplay") !== "never") UpNext.updateUpNext();
        void Background.updateBackground(Spicetify.Player.data.item?.metadata, true);
        updateDisplayLayout();
        updateMetadataOverflow();
        updateLyricsBounds();
    }

    document.addEventListener("typography", () => {
        applyTypography(CFM.get("typography"));
        if (!Utils.isModeActivated()) return;
        updateMetadataOverflow();
        updateLyricsBounds();
        Lyrics.refreshLayout();
        Queue.refreshLayout();
        if (UpNext.upNextShown) UpNext.setupScrollingAnimation();
    });

    ConfigManager.init(
        render,
        activate,
        deactivate,
        Background.updateBackground.bind(Background),
        UpNext.updateUpNextShow.bind(UpNext),
    );

    function updateEntryButtonLabel(button: HTMLElement) {
        const label = translations[getLocale()].fullscapeButtonDescription;
        button.setAttribute("title", label);
        button.setAttribute("aria-label", label);
    }

    const syncPlaybackBar = () => {
        const extraBar = HtmlSelectors.getExtraBarSelector();
        if (!extraBar) return;
        if (CFM.getGlobal("hideSpotifyFullscreenButton")) {
            const fullscreenButton =
                extraBar.querySelector<HTMLElement>('[data-testid="fullscreen-mode-button"]') ??
                extraBar.querySelector<HTMLElement>('button[title="Full screen"]');
            if (fullscreenButton) fullscreenButton.style.display = "none";
        }
        if (
            CFM.getGlobal("activationTypes") === "keys" ||
            document.getElementById("fullscape-default-button")
        ) return;

        const defButton = document.createElement("button");
        defButton.classList.add("button");
        defButton.id = "fullscape-default-button";
        defButton.type = "button";
        updateEntryButtonLabel(defButton);
        defButton.innerHTML = ICONS.FULLSCREEN;
        defButton.onclick = toggleFullscape;
        defButton.oncontextmenu = (evt) => {
            evt.preventDefault();
            ConfigManager.openConfig();
        };
        extraBar.append(defButton);
    };
    if (CFM.getGlobal("activationTypes") !== "keys" || CFM.getGlobal("hideSpotifyFullscreenButton")) {
        syncPlaybackBar();
        // Spotify can mount or replace the player bar after extension startup.
        const entryObserver = new MutationObserver(syncPlaybackBar);
        entryObserver.observe(document.body, { childList: true, subtree: true });
    }

    render();

    const failedRelease = ReleaseUpdater.consumeLoadFailure();
    if (failedRelease) {
        Spicetify.showNotification(
            translations[getLocale()].settings.updates.loadFailed.replace(
                "{version}",
                failedRelease.version,
            ),
            true,
            8000,
        );
    }
    if (CFM.getGlobal("autoUpdateCheck")) {
        window.setTimeout(() => void ConfigManager.promptForUpdate(getLocale()), 2500);
    }

    if (CFM.getGlobal("autoLaunch") === "default") toggleFullscape();
}

async function main() {
    ReleaseUpdater.reportRuntimeVersion();
    if (!(await ReleaseUpdater.shouldStartBundledVersion())) return;
    await startFullscape();
}

export default main;
