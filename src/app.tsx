/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import React from "react";
import ReactDOM from "react-dom";

import Utils from "./utils/utils";
import CFM from "./utils/config";

import translations from "./resources/strings";
import ICONS, { CLASSES_TO_ADD } from "./constants";
import HtmlSelectors from "./utils/selectors";
import { Config, Settings } from "./types/fullscape";
import { createOverflowScrollAnimation, getOverflowScrollTiming } from "./utils/overflow-scroll";

import { getHtmlContent } from "./services/html-creator";
import { initMoustrapRecord } from "./services/mousetrap-record";
import { startSharedBridgePresence } from "./services/lyrics-cache";
import { ReleaseUpdater } from "./services/release-updater";

import SeekableProgressBar from "./ui/components/ProgressBar/ProgressBar";

import { DOM } from "./ui/elements";
import { ConfigManager } from "./ui/components/Config/Config";
import { UpNext } from "./ui/components/UpNext/UpNext";
import { PlayerControls } from "./ui/components/PlayerControls/PlayerControls";
import { Lyrics } from "./ui/components/Lyrics/Lyrics";
import { Background } from "./utils/background";

import "./styles/base.scss";
import "./styles/defaultMode.scss";
import "./styles/settings.scss";

async function startFullscape() {
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
    initMoustrapRecord(Spicetify.Mousetrap);
    DOM.init();
    startSharedBridgePresence();

    if (CFM.getGlobal("activationTypes") !== "btns") {
        Spicetify.Mousetrap.bind("f", toggleFullscape);
    }

    function toggleFullscape() {
        if (Utils.isModeActivated()) deactivate();
        else activate();
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
    const PLAYBACK_TIMELINE_RESYNC_TARGET_MS = 1000;
    const PLAYBACK_TIMELINE_RESYNC_DELAY_MS = 1;
    const PLAYBACK_TIMELINE_RESYNC_CHECK_INTERVAL_MS = 100;
    let playbackTimelineResyncTimer: ReturnType<typeof setTimeout> | null = null;
    let playbackTimelineResyncCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let playbackTimelineResyncResumeReleaseTimer: ReturnType<typeof setTimeout> | null = null;
    let playbackTimelineResyncSequence = 0;
    let isPlaybackTimelineResyncing = false;
    let isPlaybackTimelineResyncAwaitingResume = false;
    let playbackTimelineResyncPending = false;
    let playbackTimelineResyncTrackUri: string | null = null;
    let playbackTimelineResyncCheckingDevice = false;
    let playbackDeviceDebugUpdatedAt = 0;
    let playbackDeviceDebugRequest: Promise<void> | null = null;
    let playbackStateEventData: any = null;
    let playbackDeviceDebugSource = "NONE";

    function finishPlaybackTimelineResyncVisualState() {
        if (playbackTimelineResyncResumeReleaseTimer !== null) {
            clearTimeout(playbackTimelineResyncResumeReleaseTimer);
            playbackTimelineResyncResumeReleaseTimer = null;
        }
        isPlaybackTimelineResyncAwaitingResume = false;
        DOM.container?.classList.remove("playback-timeline-resyncing");
    }

    function shouldSuppressPlaybackTimelineResyncEvent(evt?: any) {
        if (isPlaybackTimelineResyncing) return true;
        if (!isPlaybackTimelineResyncAwaitingResume) return false;
        const isPaused = evt?.data?.is_paused ?? evt?.data?.isPaused;
        if (isPaused === false) finishPlaybackTimelineResyncVisualState();
        return true;
    }

    function cancelPlaybackTimelineResync(resumePlayback = true) {
        if (playbackTimelineResyncTimer !== null) {
            clearTimeout(playbackTimelineResyncTimer);
            playbackTimelineResyncTimer = null;
        }
        if (playbackTimelineResyncCheckTimer !== null) {
            clearTimeout(playbackTimelineResyncCheckTimer);
            playbackTimelineResyncCheckTimer = null;
        }
        finishPlaybackTimelineResyncVisualState();
        playbackTimelineResyncSequence += 1;
        const shouldResume =
            resumePlayback &&
            isPlaybackTimelineResyncing &&
            playbackTimelineResyncTrackUri === Spicetify.Player.data?.item?.uri &&
            !Spicetify.Player.isPlaying();
        isPlaybackTimelineResyncing = false;
        playbackTimelineResyncPending = false;
        playbackTimelineResyncTrackUri = null;
        if (shouldResume) {
            DOM.container?.classList.remove("playback-paused");
            Spicetify.Player.play();
        }
    }

    function schedulePlaybackTimelineResyncCheck(delay: number) {
        if (playbackTimelineResyncCheckTimer !== null) {
            clearTimeout(playbackTimelineResyncCheckTimer);
        }
        playbackTimelineResyncCheckTimer = setTimeout(() => {
            playbackTimelineResyncCheckTimer = null;
            tryPlaybackTimelineResync();
        }, delay);
    }

    function getPlaybackDevice(source: any) {
        return (
            source?.device ??
            source?.playbackDevice ??
            source?.playback_device ??
            source?.device_info ??
            source?.deviceInfo ??
            source?.active_device ??
            source?.activeDevice ??
            source?.player_state?.device ??
            source?.playerState?.device ??
            source?.state?.device ??
            null
        );
    }

    function getPlaybackDeviceIdentifier(source: any) {
        return (
            source?.device_identifier ??
            source?.deviceIdentifier ??
            source?.device_id ??
            source?.deviceId ??
            source?.play_origin?.device_identifier ??
            source?.play_origin?.deviceIdentifier ??
            source?.play_origin?.device_id ??
            source?.play_origin?.deviceId ??
            source?.playOrigin?.device_identifier ??
            source?.playOrigin?.deviceIdentifier ??
            source?.playOrigin?.device_id ??
            source?.playOrigin?.deviceId ??
            source?.player_state?.device_identifier ??
            source?.player_state?.play_origin?.device_identifier ??
            source?.playerState?.device_identifier ??
            source?.playerState?.play_origin?.device_identifier ??
            source?.state?.device_identifier ??
            source?.state?.play_origin?.device_identifier ??
            source?.track?.device_identifier ??
            source?.track?.play_origin?.device_identifier ??
            source?.track?.playOrigin?.device_identifier ??
            source?.track?.play_origin?.device_id ??
            source?.track?.playOrigin?.deviceId ??
            source?.track?.track?.device_identifier ??
            source?.track?.track?.play_origin?.device_identifier ??
            source?.id ??
            null
        );
    }

    function parsePlaybackResponse(response: any) {
        const body = response?.body ?? response;
        if (typeof body !== "string") return body;
        try {
            return JSON.parse(body);
        } catch {
            return null;
        }
    }

    function hasPlaybackDeviceType(device: any) {
        return Boolean(
            device?.type ??
                device?.deviceType ??
                device?.device_type ??
                device?.device_info?.type ??
                device?.deviceInfo?.type,
        );
    }

    function getConnectPlaybackDevice() {
        const connectApi = (Spicetify.Platform as any)?.ConnectAPI;
        if (!connectApi) return null;

        const state =
            connectApi.getConnectState?.() ??
            connectApi.getState?.() ??
            connectApi.state ??
            null;
        const devices =
            connectApi.getDevices?.() ??
            (Array.isArray(state?.devices) ? state.devices : []);
        return (
            connectApi.getActiveDevice?.() ??
            state?.activeDevice ??
            devices.find((device: any) => device?.isActive || device?.is_active) ??
            devices.find((device: any) => device?.isLocal || device?.is_local) ??
            null
        );
    }

    function getLocalDeviceId() {
        const playerApi = Spicetify.Platform?.PlayerAPI as any;
        return (
            playerApi?._device?.id ??
            playerApi?._session?.deviceId ??
            playerApi?._state?.localDeviceId ??
            playerApi?._state?.local_device_id ??
            null
        );
    }

    function isLocalPlaybackDevice(device: any, source?: any): boolean | null {
        if (!device && !source) return null;
        const localFlags = [
            device?.isLocal,
            device?.is_local,
            source?.isLocal,
            source?.is_local,
        ];
        const localFlag = localFlags.find((value) => typeof value === "boolean");
        if (typeof localFlag === "boolean") return localFlag;

        const remoteFlags = [
            device?.isRemote,
            device?.is_remote,
            source?.isRemote,
            source?.is_remote,
        ];
        const remoteFlag = remoteFlags.find((value) => typeof value === "boolean");
        if (typeof remoteFlag === "boolean") return !remoteFlag;

        const localDeviceId = getLocalDeviceId();
        const deviceId = getPlaybackDeviceIdentifier(device);
        if (localDeviceId && deviceId) return localDeviceId === deviceId;

        const deviceType = String(
            device?.type ??
                device?.deviceType ??
                device?.device_type ??
                device?.device_info?.type ??
                device?.deviceInfo?.type ??
                "",
        ).toLowerCase();
        if (deviceType) return deviceType === "computer" || deviceType === "desktop";
        return null;
    }

    async function getCurrentPlaybackDevice() {
        playbackDeviceDebugSource = "CHECKING";
        const player = Spicetify.Player as any;
        const playerApi = Spicetify.Platform?.PlayerAPI as any;
        const playerState = player?.data;
        const playerStateSources = [
            playbackStateEventData,
            playerState,
            playerApi?._state,
            playerApi?._session,
        ];
        const directDevice = playerStateSources
            .map((source) => getPlaybackDevice(source))
            .find((device) => hasPlaybackDeviceType(device));
        let currentDeviceIdentifier = playerStateSources
            .map((source) => getPlaybackDeviceIdentifier(source))
            .find(Boolean);
        if (hasPlaybackDeviceType(directDevice)) {
            playbackDeviceDebugSource = "PLAYER";
            return directDevice;
        }

        const connectDevice = getConnectPlaybackDevice();
        if (connectDevice) {
            playbackDeviceDebugSource = "CONNECT_API";
            return connectDevice;
        }

        let apiState: any = null;
        try {
            const internalPlaybackState = await Spicetify.CosmosAsync.get(
                "sp://player/v2/main",
            );
            const internalState = parsePlaybackResponse(internalPlaybackState);
            const internalDevice = getPlaybackDevice(internalState);
            if (hasPlaybackDeviceType(internalDevice)) {
                playbackDeviceDebugSource = "INTERNAL";
                return internalDevice;
            }
            currentDeviceIdentifier =
                currentDeviceIdentifier ?? getPlaybackDeviceIdentifier(internalState);
        } catch {
            playbackDeviceDebugSource = "INTERNAL_ERROR";
        }

        try {
            const playbackState = await Spicetify.CosmosAsync.get(
                "https://api.spotify.com/v1/me/player",
            );
            apiState = parsePlaybackResponse(playbackState);
            const apiDevice = getPlaybackDevice(apiState);
            if (hasPlaybackDeviceType(apiDevice)) {
                playbackDeviceDebugSource = "PLAYER_API";
                return apiDevice;
            }
            currentDeviceIdentifier =
                currentDeviceIdentifier ?? getPlaybackDeviceIdentifier(apiState);
        } catch {
            apiState = null;
            playbackDeviceDebugSource = "PLAYER_API_ERROR";
        }

        try {
            const devicesResponse = await Spicetify.CosmosAsync.get(
                "https://api.spotify.com/v1/me/player/devices",
            );
            const devicesState = parsePlaybackResponse(devicesResponse);
            const devices = Array.isArray(devicesState?.devices) ? devicesState.devices : [];
            const matchingDevice = devices.find(
                (device: any) =>
                    currentDeviceIdentifier &&
                    getPlaybackDeviceIdentifier(device) === currentDeviceIdentifier,
            );
            if (matchingDevice) {
                playbackDeviceDebugSource = "DEVICES_MATCH";
                return matchingDevice;
            }
            const activeDevice = devices.find(
                (device: any) => device?.is_active || device?.isActive,
            );
            if (activeDevice) {
                playbackDeviceDebugSource = "DEVICES_ACTIVE";
                return activeDevice;
            }
            if (devices[0]) {
                playbackDeviceDebugSource = "DEVICES_FIRST";
                return devices[0];
            }
            playbackDeviceDebugSource = currentDeviceIdentifier ? "ID_ONLY" : "NO_DEVICE";
            return currentDeviceIdentifier ? { id: currentDeviceIdentifier } : null;
        } catch {
            playbackDeviceDebugSource = "DEVICES_ERROR";
            return currentDeviceIdentifier ? { id: currentDeviceIdentifier } : null;
        }
    }

    async function isPlaybackOnLocalDevice() {
        const device = await getCurrentPlaybackDevice();
        // Do not pause when the active device cannot be identified safely.
        return isLocalPlaybackDevice(device) === true;
    }

    function getPlaybackDeviceType(device: any) {
        const type =
            device?.type ??
            device?.deviceType ??
            device?.device_type ??
            device?.device_info?.type ??
            device?.deviceInfo?.type;
        if (typeof type === "number") {
            return (
                {
                    0: "UNKNOWN",
                    1: "COMPUTER",
                    2: "TABLET",
                    3: "SMARTPHONE",
                    4: "SPEAKER",
                    5: "TV",
                    6: "AVR",
                    7: "STB",
                    8: "AUDIO_DONGLE",
                    9: "GAME_CONSOLE",
                    10: "CAST_VIDEO",
                    11: "CAST_AUDIO",
                    12: "AUTOMOBILE",
                    13: "SMARTWATCH",
                    14: "CHROMEBOOK",
                    100: "UNKNOWN_SPOTIFY",
                    101: "CAR_THING",
                    102: "OBSERVER",
                    103: "HOME_THING",
                } as Record<number, string>
            )[type] ?? `TYPE_${type}`;
        }
        return type ? String(type).toUpperCase() : "UNKNOWN";
    }

    async function updatePlaybackDeviceDebug(force = false) {
        if (!CFM.get("debugMode")) return;
        const target = DOM.container.querySelector<HTMLElement>("[data-debug-device]");
        const idTarget = DOM.container.querySelector<HTMLElement>("[data-debug-device-id]");
        const sourceTarget = DOM.container.querySelector<HTMLElement>(
            "[data-debug-device-source]",
        );
        if (!target) return;
        const now = Date.now();
        if (!force && now - playbackDeviceDebugUpdatedAt < 2000) return;
        if (playbackDeviceDebugRequest) return;
        playbackDeviceDebugUpdatedAt = now;
        const request = (async () => {
            const device = await getCurrentPlaybackDevice();
            if (!CFM.get("debugMode") || !DOM.container.contains(target)) return;
            target.textContent = getPlaybackDeviceType(device);
            if (idTarget && DOM.container.contains(idTarget)) {
                idTarget.textContent = getPlaybackDeviceIdentifier(device) ?? "--";
            }
            if (sourceTarget && DOM.container.contains(sourceTarget)) {
                sourceTarget.textContent = playbackDeviceDebugSource;
            }
        })();
        playbackDeviceDebugRequest = request;
        try {
            await request;
        } finally {
            if (playbackDeviceDebugRequest === request) playbackDeviceDebugRequest = null;
        }
    }

    async function tryPlaybackTimelineResync() {
        if (!playbackTimelineResyncPending) return;
        if (
            !CFM.get("playbackTimelineResync") ||
            playbackTimelineResyncTrackUri !== Spicetify.Player.data?.item?.uri ||
            !Utils.isModeActivated()
        ) {
            cancelPlaybackTimelineResync(false);
            return;
        }

        if (playbackTimelineResyncCheckingDevice) return;
        playbackTimelineResyncCheckingDevice = true;
        const deviceCheckSequence = playbackTimelineResyncSequence;
        const isLocalDevice = await isPlaybackOnLocalDevice();
        playbackTimelineResyncCheckingDevice = false;
        if (
            deviceCheckSequence !== playbackTimelineResyncSequence &&
            playbackTimelineResyncPending
        ) {
            schedulePlaybackTimelineResyncCheck(0);
            return;
        }
        if (!playbackTimelineResyncPending) return;
        if (!isLocalDevice) {
            cancelPlaybackTimelineResync(false);
            return;
        }

        const progress = Number(Spicetify.Player.getProgress());
        if (
            !Number.isFinite(progress) ||
            progress < PLAYBACK_TIMELINE_RESYNC_TARGET_MS ||
            !Spicetify.Player.isPlaying()
        ) {
            const delay =
                Number.isFinite(progress) && progress < PLAYBACK_TIMELINE_RESYNC_TARGET_MS
                    ? Math.min(
                          PLAYBACK_TIMELINE_RESYNC_CHECK_INTERVAL_MS,
                          Math.max(1, PLAYBACK_TIMELINE_RESYNC_TARGET_MS - progress),
                      )
                    : PLAYBACK_TIMELINE_RESYNC_CHECK_INTERVAL_MS;
            schedulePlaybackTimelineResyncCheck(delay);
            return;
        }

        playbackTimelineResyncPending = false;
        const sequence = playbackTimelineResyncSequence;
        isPlaybackTimelineResyncing = true;
        DOM.container?.classList.add("playback-timeline-resyncing");
        Spicetify.Player.pause();
        playbackTimelineResyncTimer = setTimeout(() => {
            playbackTimelineResyncTimer = null;
            const shouldResume =
                sequence === playbackTimelineResyncSequence &&
                isPlaybackTimelineResyncing &&
                playbackTimelineResyncTrackUri === Spicetify.Player.data?.item?.uri &&
                Utils.isModeActivated();
            isPlaybackTimelineResyncing = false;
            if (shouldResume) {
                DOM.container?.classList.remove("playback-paused");
                isPlaybackTimelineResyncAwaitingResume = true;
                playbackTimelineResyncResumeReleaseTimer = setTimeout(
                    finishPlaybackTimelineResyncVisualState,
                    50,
                );
                Spicetify.Player.play();
            } else {
                finishPlaybackTimelineResyncVisualState();
            }
            playbackTimelineResyncTrackUri = null;
        }, PLAYBACK_TIMELINE_RESYNC_DELAY_MS);
    }

    function schedulePlaybackTimelineResync(evt?: any) {
        cancelPlaybackTimelineResync(false);
        if (!CFM.get("playbackTimelineResync")) return;

        const isPaused = evt?.data?.is_paused ?? evt?.data?.isPaused;
        const wasPlaying =
            typeof isPaused === "boolean" ? !isPaused : Spicetify.Player.isPlaying();
        if (!wasPlaying) return;

        const trackUri = Spicetify.Player.data?.item?.uri ?? null;
        if (!trackUri) return;
        playbackTimelineResyncPending = true;
        playbackTimelineResyncTrackUri = trackUri;
        schedulePlaybackTimelineResyncCheck(PLAYBACK_TIMELINE_RESYNC_TARGET_MS);
    }

    const updatePlayerControlsWithoutResyncEffect = (evt: any) => {
        if (shouldSuppressPlaybackTimelineResyncEvent(evt)) return;
        updatePlayerControls(evt);
    };
    let metadataFrameId: number | null = null;
    let metadataAnimations: Animation[] = [];

    function cancelMetadataAnimations() {
        metadataAnimations.forEach((animation) => animation.cancel());
        metadataAnimations = [];
        DOM.container
            .querySelectorAll<HTMLElement>("#fullscape-title-text-track, #fullscape-secondary-meta-track")
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
                    viewport: DOM.container.querySelector<HTMLElement>("#fullscape-title-text-viewport"),
                    track: DOM.container.querySelector<HTMLElement>("#fullscape-title-text-track"),
                },
                {
                    viewport: DOM.container.querySelector<HTMLElement>("#fullscape-secondary-meta"),
                    track: DOM.container.querySelector<HTMLElement>("#fullscape-secondary-meta-track"),
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
                overflow: Math.ceil(target.track.scrollWidth - target.viewport.clientWidth),
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
        if (!CFM.get("lyricsDisplay") || !DOM.lyrics?.isConnected) return;
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

    function updatePlaybackLayout(evt?: any) {
        if (evt?.data && typeof evt.data === "object") playbackStateEventData = evt.data;
        if (shouldSuppressPlaybackTimelineResyncEvent(evt)) return;
        const isPaused =
            evt?.data?.is_paused ?? evt?.data?.isPaused ?? !Spicetify.Player.isPlaying();
        DOM.container.classList.toggle("playback-paused", Boolean(isPaused));
    }

    function render() {
        cancelPlaybackTimelineResync();
        playbackDeviceDebugUpdatedAt = 0;
        playbackDeviceDebugRequest = null;
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
        DOM.container.classList.remove("lyrics-hide-force");

        applyLyricsScale();

        Spicetify.Player.removeEventListener("songchange", handleSongChange);
        Spicetify.Player.removeEventListener("onplaypause", updatePlayerControlsWithoutResyncEffect);
        Spicetify.Player.removeEventListener("onplaypause", updatePlayingIcon);
        Spicetify.Player.removeEventListener("onplaypause", updatePlaybackLayout);
        document.removeEventListener("fullscreenchange", fullscreenChangeListener);

        Spicetify.Platform.PlayerAPI._events.removeListener("queue_update", updateUpNext);
        Spicetify.Platform.PlayerAPI._events.removeListener("update", updateUpNextShow);
        Spicetify.Player.removeEventListener("onprogress", handlePlaybackTimelineProgress);
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
        cancelMetadataAnimations();
        Background.stop();

        handleMouseMoveDeactivation();

        const transitionTime = Number(CFM.get("backAnimationTime"));
        DOM.style.textContent = `
        #fullscape-display {
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

        DOM.back = DOM.container.querySelector("#fullscape-background")!;
        DOM.back.width = window.innerWidth;
        DOM.back.height = window.innerHeight;
        DOM.fluidBack = DOM.container.querySelector("#fullscape-fluid-background")!;

        DOM.cover = DOM.container.querySelector("#fullscape-art-image")!;
        DOM.title = DOM.container.querySelector("#fullscape-title-text-track")!;
        DOM.artist = DOM.container.querySelector("#fullscape-artist .fullscape-artist-list")!;
        DOM.album = DOM.container.querySelector("#fullscape-album span")!;
        if (CFM.get("lyricsDisplay")) {
            DOM.lyrics = DOM.container.querySelector("#fad-lyrics-container")!;
            Lyrics.attach(DOM.lyrics);
        }

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
                updatePlayingIcon({ data: { is_paused: !Spicetify.Player.isPlaying() } });
            };
        }
        if (CFM.get("playerControls") !== "never") {
            DOM.play = DOM.container.querySelector("#fullscape-play")!;
            DOM.play.onclick = () => {
                Utils.fadeAnimation(DOM.play);
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
                if (index > 0) {
                    const separator = document.createElement("span");
                    separator.className = "fullscape-artist-separator";
                    separator.textContent = ",";
                    separator.setAttribute("aria-hidden", "true");
                    DOM.artist.append(separator);
                }
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
        if (shouldSuppressPlaybackTimelineResyncEvent(evt)) return;
        if (evt.data.is_paused || evt.data.isPaused) {
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
        const delay = isInsideLyrics ? 10_000 : 3_000;
        curTimer = setTimeout(() => {
            DOM.container.style.cursor = "none";
            DOM.container.classList.add("fullscape-cursor-hidden");
        }, delay);
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
    function handlePlaybackTimelineProgress() {
        void updatePlaybackDeviceDebug();
        void tryPlaybackTimelineResync();
    }

    function handleSongChange(evt?: any) {
        if (evt?.data && typeof evt.data === "object") playbackStateEventData = evt.data;
        schedulePlaybackTimelineResync(evt);
        void updatePlaybackDeviceDebug(true);
        void updateInfo();
    }

    let activationSequence = 0;

    async function activate() {
        const sequence = ++activationSequence;
        Utils.toggleQueuePanel(null, true);
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
        Spicetify.Player.addEventListener("onprogress", handlePlaybackTimelineProgress);
        void updatePlaybackDeviceDebug(true);
        handleMouseMoveActivation();
        DOM.container.oncontextmenu = ConfigManager.openConfig.bind(ConfigManager);
        DOM.container.querySelector<HTMLElement>("#fullscape-foreground")!.ondblclick = deactivate;
        DOM.back.ondblclick = deactivate;
        if (CFM.get("upnextDisplay") !== "never") {
            UpNext.updateUpNextShow();
            Spicetify.Platform.PlayerAPI._events.addListener("queue_update", updateUpNext);
            Spicetify.Platform.PlayerAPI._events.addListener("update", updateUpNextShow);
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
                DOM.container.querySelector("#fullscape-progress-parent"),
            );
        }
        if (CFM.get("playerControls") !== "never") {
            PlayerControls.updatePlayerControls({
                data: { is_paused: !Spicetify.Player.isPlaying() },
            });
            Spicetify.Player.addEventListener(
                "onplaypause",
                updatePlayerControlsWithoutResyncEffect,
            );
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
        Spicetify.Mousetrap.bind("f11", toggleNativeFullscreen);
        document.addEventListener("fullscreenchange", fullscreenChangeListener);
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
        cancelPlaybackTimelineResync();
        Utils.toggleQueuePanel(null, false);
        Background.stop();
        Spicetify.Player.removeEventListener("songchange", handleSongChange);
        Spicetify.Player.removeEventListener("onplaypause", updatePlaybackLayout);
        handleMouseMoveDeactivation();
        window.removeEventListener("resize", resizeEvents);
        cancelResize();
        if (metadataFrameId !== null) {
            cancelAnimationFrame(metadataFrameId);
            metadataFrameId = null;
        }
        cancelMetadataAnimations();
        if (CFM.get("upnextDisplay") !== "never") {
            UpNext.upNextShown = false;
            Spicetify.Platform.PlayerAPI._events.removeListener("queue_update", updateUpNext);
            Spicetify.Platform.PlayerAPI._events.removeListener("update", updateUpNextShow);
        }
        const progressRoot = DOM.container.querySelector("#fullscape-progress-parent");
        if (progressRoot) ReactDOM.unmountComponentAtNode(progressRoot);
        if (CFM.get("icons")) {
            Spicetify.Player.removeEventListener("onplaypause", updatePlayingIcon);
        }
        if (CFM.get("playerControls") !== "never") {
            Spicetify.Player.removeEventListener(
                "onplaypause",
                updatePlayerControlsWithoutResyncEffect,
            );
        }
        Spicetify.Player.removeEventListener("onprogress", handlePlaybackTimelineProgress);
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
            await Utils.exitFullscreen()?.catch(() => undefined);
        }
        const popup = document.querySelector("body > generic-modal");
        if (popup) popup.remove();
        DOM.style.remove();
        DOM.container.remove();
        document.removeEventListener("fullscreenchange", fullscreenChangeListener);

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
        Background.updateBackground.bind(Background),
        UpNext.updateUpNextShow.bind(UpNext),
    );

    const extraBar = HtmlSelectors.getExtraBarSelector() as HTMLElement;
    if (CFM.getGlobal("hideSpotifyFullscreenButton")) {
        const lastExtraBarItem = extraBar?.lastElementChild as HTMLElement | null;
        if (
            lastExtraBarItem?.classList.contains("control-button") ||
            lastExtraBarItem?.title === "Full screen"
        )
            lastExtraBarItem.remove();
    }
    if (CFM.getGlobal("activationTypes") != "keys") {
        const defButton = document.createElement("button");
        defButton.classList.add("button");
        defButton.id = "fullscape-default-button";
        defButton.setAttribute("title", translations[LOCALE].fullscapeButtonDescription);

        defButton.innerHTML = ICONS.FULLSCREEN;
        defButton.onclick = toggleFullscape;

        defButton.oncontextmenu = (evt) => {
            evt.preventDefault();
            ConfigManager.openConfig();
        };
        (extraBar as HTMLElement)?.append(defButton);
    }

    render();

    const failedRelease = ReleaseUpdater.consumeLoadFailure();
    if (failedRelease) {
        Spicetify.showNotification(
            translations[LOCALE].settings.updates.loadFailed.replace(
                "{version}",
                failedRelease.version,
            ),
            true,
            8000,
        );
    }
    if (CFM.getGlobal("autoUpdateCheck")) {
        window.setTimeout(() => void ConfigManager.promptForUpdate(LOCALE), 2500);
    }

    if (CFM.getGlobal("autoLaunch") === "default") toggleFullscape();
}

async function main() {
    ReleaseUpdater.reportRuntimeVersion();
    ReleaseUpdater.initializeUpdateModel();
    if (!(await ReleaseUpdater.shouldStartBundledVersion())) return;
    await startFullscape();
}

export default main;
