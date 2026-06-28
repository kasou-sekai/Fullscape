import * as React from "react";
import "./styles.scss";
import { SeekbarProps } from "../../../types/fullscreen";
import classNames from "classnames";

const SeekableProgressBar = ({ state }: { state: string }) => {
    const [curProgress, setProgress] = React.useState(Spicetify.Player.getProgress());
    const [curDuration, setDuration] = React.useState(Spicetify.Player.getDuration());

    const [changingProgress, setChangingProgress] = React.useState<SeekbarProps>({
        isChanging: false,
        data: null,
    });

    const progSlider = React.useRef(null) as React.MutableRefObject<HTMLDivElement | null>;

    const [visibility, setVisibility] = React.useState(true);

    const progressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const animationFrame = React.useRef<number | null>(null);
    const progressRef = React.useRef(curProgress);
    const durationRef = React.useRef(curDuration);
    const changingProgressRef = React.useRef(changingProgress);
    const playbackAnchor = React.useRef({
        progress: curProgress,
        timestamp: performance.now(),
        isPlaying: Spicetify.Player.isPlaying(),
    });
    progressRef.current = curProgress;
    durationRef.current = curDuration;
    changingProgressRef.current = changingProgress;

    const onMouseDown = (evt: MouseEvent) => {
        if (evt.button == 0) {
            const sliderWidth = progSlider.current?.getBoundingClientRect().width ?? 480;
            const newData = {
                isChanging: true,
                data: {
                    begin: evt.offsetX,
                    positionCoord: evt.offsetX,
                    beginClient: evt.clientX,
                    sliderDimen: sliderWidth,
                },
            };
            const newPercentage = newData.data.positionCoord / sliderWidth;
            const progress = newPercentage * durationRef.current;
            progressRef.current = progress;
            setProgress(progress);
            changingProgressRef.current = newData;
            setChangingProgress(newData);
        }
    };

    const onMouseMove = (evt: MouseEvent) => {
        const changing = changingProgressRef.current;
        if (changing.isChanging && changing.data) {
            const moveX = evt.clientX - changing.data.beginClient;
            const sliderWidth = changing.data.sliderDimen;
            const newPosX = Math.min(Math.max(changing.data.begin + moveX, 0), sliderWidth);
            const newPercentage = newPosX / sliderWidth;
            const progress = newPercentage * durationRef.current;
            const nextChanging = {
                isChanging: true,
                data: { ...changing.data, positionCoord: newPosX },
            };
            progressRef.current = progress;
            changingProgressRef.current = nextChanging;
            setProgress(progress);
            setChangingProgress(nextChanging);
        }
        if (state === "mousemove") {
            hideProgressBar();
        }
    };

    const onMouseUp = (evt: MouseEvent) => {
        if (evt.button == 0 && changingProgressRef.current.isChanging) {
            Spicetify.Player.seek(progressRef.current);
            playbackAnchor.current = {
                progress: progressRef.current,
                timestamp: performance.now(),
                isPlaying: Spicetify.Player.isPlaying(),
            };
            const stopped = { isChanging: false, data: null };
            changingProgressRef.current = stopped;
            setChangingProgress(stopped);
        }
    };

    const hideProgressBar = (timeout = 3000) => {
        if (progressTimer.current) {
            clearTimeout(progressTimer.current);
        }
        setVisibility(true);
        progressTimer.current = setTimeout(() => {
            setVisibility(false);
        }, timeout);
    };

    const setDragListener = () => {
        progSlider.current?.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const resetDragListener = () => {
        progSlider.current?.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
    };

    const syncProgress = () => {
        const playerProgress = Spicetify.Player.getProgress();
        const isPlaying = Spicetify.Player.isPlaying();
        const drift = playerProgress - progressRef.current;
        const progress =
            isPlaying && Math.abs(drift) < 1500
                ? Math.max(playerProgress, progressRef.current)
                : playerProgress;
        playbackAnchor.current = {
            progress,
            timestamp: performance.now(),
            isPlaying,
        };
        if (!changingProgressRef.current.isChanging) {
            progressRef.current = progress;
            setProgress(progress);
        }
    };
    const animateProgress = (timestamp: number) => {
        if (!changingProgressRef.current.isChanging) {
            const anchor = playbackAnchor.current;
            const elapsed = anchor.isPlaying ? timestamp - anchor.timestamp : 0;
            const progress = Math.min(durationRef.current, Math.max(0, anchor.progress + elapsed));
            progressRef.current = progress;
            setProgress(progress);
        }
        animationFrame.current = requestAnimationFrame(animateProgress);
    };
    //Using spotify internal songchange event listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateDuration = (meta: any) => {
        const duration = meta.data.duration ?? Spicetify.Player.getDuration();
        const progress = Spicetify.Player.getProgress();
        progressRef.current = progress;
        durationRef.current = duration;
        playbackAnchor.current = {
            progress,
            timestamp: performance.now(),
            isPlaying: Spicetify.Player.isPlaying(),
        };
        setProgress(progress);
        setDuration(duration);
    };
    const updatePlaybackState = (evt?: Event) => {
        const playbackEvent = evt as
            | (Event & { data?: { is_paused?: boolean; isPaused?: boolean } })
            | undefined;
        const isPaused = playbackEvent?.data?.is_paused ?? playbackEvent?.data?.isPaused;
        const progress = Spicetify.Player.getProgress();
        playbackAnchor.current = {
            progress,
            timestamp: performance.now(),
            isPlaying: typeof isPaused === "boolean" ? !isPaused : Spicetify.Player.isPlaying(),
        };
        if (!changingProgressRef.current.isChanging) {
            progressRef.current = progress;
            setProgress(progress);
        }
    };

    React.useEffect(() => {
        // console.log("Progress Effect called");
        if (state === "mousemove") {
            hideProgressBar();
        } else {
            setVisibility(true);
        }
        syncProgress();
        animationFrame.current = requestAnimationFrame(animateProgress);
        const syncInterval = setInterval(syncProgress, 1000);

        Spicetify.Player.addEventListener("songchange", updateDuration);
        Spicetify.Player.addEventListener("onplaypause", updatePlaybackState);
        setDragListener();
        return () => {
            clearInterval(syncInterval);
            if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
            if (progressTimer.current) clearTimeout(progressTimer.current);
            Spicetify.Player.removeEventListener("songchange", updateDuration);
            Spicetify.Player.removeEventListener("onplaypause", updatePlaybackState);
            resetDragListener();
        };
    }, [state]);

    const progressPercentage =
        curDuration > 0 ? Math.min(100, Math.max(0, (curProgress / curDuration) * 100)) : 0;

    return (
        <div id="fsd-progress-container" style={{ opacity: visibility ? 1 : 0 }}>
            <div
                id="fsd-progress-bar"
                ref={progSlider}
                className={classNames({ dragging: changingProgress.isChanging })}>
                <div id="fsd-progress-bar-inner" style={{ width: `${progressPercentage}%` }}>
                    <div id="progress-thumb" />
                </div>
            </div>
            <div id="fsd-progress-times">
                <div className="progress-number" id="fsd-elapsed">
                    {Spicetify.Player.formatTime(curProgress)}
                </div>
                <div className="progress-number" id="fsd-duration">
                    -{Spicetify.Player.formatTime(Math.max(0, curDuration - curProgress))}
                </div>
            </div>
        </div>
    );
};

export default SeekableProgressBar;
