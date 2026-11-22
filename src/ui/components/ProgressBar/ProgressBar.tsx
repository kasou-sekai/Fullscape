import * as React from "react";
import "./styles.scss";
import { getPlaybackPaused, type PlaybackStateEvent } from "../../../services/playback-state";
import { prefersReducedMotion } from "../../../utils/motion";
import classNames from "classnames";

type Drag = {
    startPosition: number;
    startClientX: number;
    width: number;
};

const CLOCK_SYNC_INTERVAL_MS = 1000;
const SMALL_CLOCK_DRIFT_MS = 1500;

function getProgressPercentage(progress: number, duration: number) {
    return duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
}

const SeekableProgressBar = () => {
    const [curProgress, setProgress] = React.useState(() => Spicetify.Player.getProgress());
    const [curDuration, setDuration] = React.useState(() => Spicetify.Player.getDuration());

    const [isDragging, setDragging] = React.useState(false);
    const drag = React.useRef<Drag | null>(null);
    const progSlider = React.useRef<HTMLDivElement>(null);

    const fillRef = React.useRef<HTMLDivElement>(null);

    const animationFrame = React.useRef<number | null>(null);
    const progressRef = React.useRef(curProgress);
    const labeledProgress = React.useRef(curProgress);
    const paintedPercentage = React.useRef<number | null>(null);
    const durationRef = React.useRef(curDuration);
    const playbackAnchor = React.useRef({ progress: curProgress, timestamp: 0, isPlaying: false });

    const paintProgress = (progress: number) => {
        progressRef.current = progress;
        const percentage = getProgressPercentage(progress, durationRef.current);
        if (fillRef.current && percentage !== paintedPercentage.current) {
            const previousPercentage = paintedPercentage.current;
            fillRef.current.style.width = `${percentage}%`;
            if (previousPercentage === null || (previousPercentage > 0) !== (percentage > 0)) {
                fillRef.current.style.minWidth = percentage > 0 ? "10px" : "0";
            }
            paintedPercentage.current = percentage;
        }
        const previous = labeledProgress.current;
        if (
            Math.floor(previous / 1000) !== Math.floor(progress / 1000) ||
            Math.floor((durationRef.current - previous) / 1000) !==
                Math.floor((durationRef.current - progress) / 1000)
        ) {
            labeledProgress.current = progress;
            setProgress(progress);
        }
    };
    const stopAnimation = () => {
        if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
    };
    const resumeAnimation = () => {
        if (document.hidden || !playbackAnchor.current.isPlaying || prefersReducedMotion()) {
            stopAnimation();
        } else if (animationFrame.current === null) {
            animationFrame.current = requestAnimationFrame(animateProgress);
        }
    };

    const resetPlaybackAnchor = (progress: number, isPlaying = Spicetify.Player.isPlaying()) => {
        playbackAnchor.current = { progress, timestamp: performance.now(), isPlaying };
    };

    const previewSeek = ({ startPosition, width, startClientX }: Drag, clientX: number) => {
        const position = Math.min(width, Math.max(0, startPosition + clientX - startClientX));
        paintProgress((position / width) * durationRef.current);
    };

    const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;
        const bounds = progSlider.current?.getBoundingClientRect();
        if (!bounds?.width) return;
        const startPosition = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
        const next = { startPosition, startClientX: event.clientX, width: bounds.width };
        drag.current = next;
        setDragging(true);
        previewSeek(next, event.clientX);
    };

    const onMouseMove = (event: MouseEvent) => {
        if (drag.current) previewSeek(drag.current, event.clientX);
    };

    const onMouseUp = (event: MouseEvent) => {
        if (event.button !== 0 || !drag.current) return;
        Spicetify.Player.seek(progressRef.current);
        resetPlaybackAnchor(progressRef.current);
        drag.current = null;
        setDragging(false);
    };

    const syncProgress = () => {
        const playerProgress = Spicetify.Player.getProgress();
        const isPlaying = Spicetify.Player.isPlaying();
        const drift = playerProgress - progressRef.current;
        const progress =
            isPlaying && Math.abs(drift) < SMALL_CLOCK_DRIFT_MS
                ? Math.max(playerProgress, progressRef.current)
                : playerProgress;
        resetPlaybackAnchor(progress, isPlaying);
        if (!drag.current) {
            paintProgress(progress);
        }
        resumeAnimation();
    };
    const animateProgress = (timestamp: number) => {
        animationFrame.current = null;
        if (!drag.current) {
            const anchor = playbackAnchor.current;
            const elapsed = anchor.isPlaying ? timestamp - anchor.timestamp : 0;
            const progress = Math.min(durationRef.current, Math.max(0, anchor.progress + elapsed));
            paintProgress(progress);
        }
        resumeAnimation();
    };
    const updateDuration = (event?: Event & { data?: { duration?: number } }) => {
        const duration = event?.data?.duration ?? Spicetify.Player.getDuration();
        const progress = Spicetify.Player.getProgress();
        durationRef.current = duration;
        resetPlaybackAnchor(progress);
        paintProgress(progress);
        setDuration(duration);
        resumeAnimation();
    };

    const updatePlaybackState = (event?: Event & PlaybackStateEvent) => {
        const isPaused = getPlaybackPaused(event);
        const progress = Spicetify.Player.getProgress();
        resetPlaybackAnchor(progress, typeof isPaused === "boolean" ? !isPaused : undefined);
        if (!drag.current) paintProgress(progress);
        resumeAnimation();
    };

    React.useLayoutEffect(() => {
        syncProgress();
        document.addEventListener("visibilitychange", syncProgress);
        const syncInterval = setInterval(syncProgress, CLOCK_SYNC_INTERVAL_MS);

        Spicetify.Player.addEventListener("songchange", updateDuration);
        Spicetify.Player.addEventListener("onplaypause", updatePlaybackState);
        const slider = progSlider.current;
        slider?.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        return () => {
            clearInterval(syncInterval);
            document.removeEventListener("visibilitychange", syncProgress);
            stopAnimation();
            Spicetify.Player.removeEventListener("songchange", updateDuration);
            Spicetify.Player.removeEventListener("onplaypause", updatePlaybackState);
            slider?.removeEventListener("mousedown", onMouseDown);
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
    }, []);

    return (
        <div id="fullscape-progress-container">
            <div
                id="fullscape-progress-bar"
                ref={progSlider}
                className={classNames({ dragging: isDragging })}>
                <div id="fullscape-progress-bar-inner" ref={fillRef} />
            </div>
            <div id="fullscape-progress-times">
                <div className="progress-number" id="fullscape-elapsed">
                    {Spicetify.Player.formatTime(curProgress)}
                </div>
                <div className="progress-number" id="fullscape-duration">
                    -{Spicetify.Player.formatTime(Math.max(0, curDuration - curProgress))}
                </div>
            </div>
        </div>
    );
};

export default SeekableProgressBar;
