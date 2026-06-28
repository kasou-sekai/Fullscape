import * as React from "react";
import "./styles.scss";
import { SeekbarProps } from "../../../types/fullscreen";
import classNames from "classnames";
import CFM from "../../../utils/config";

const SeekableProgressBar = ({ state }: { state: string }) => {
    const [curProgress, setProgress] = React.useState(Spicetify.Player.getProgress());
    const [curDuration, setDuration] = React.useState(Spicetify.Player.getDuration());
    const [secondaryPref, setSecondaryPref] = React.useState(CFM.get("showRemainingTime"));

    const [changingProgress, setChangingProgress] = React.useState<SeekbarProps>({
        isChanging: false,
        data: null,
    });

    const progSlider = React.useRef(null) as React.MutableRefObject<HTMLDivElement | null>;

    const [visibility, setVisibility] = React.useState(true);

    const progressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const progressRef = React.useRef(curProgress);
    const durationRef = React.useRef(curDuration);
    const changingProgressRef = React.useRef(changingProgress);
    const secondaryPrefRef = React.useRef(secondaryPref);
    progressRef.current = curProgress;
    durationRef.current = curDuration;
    changingProgressRef.current = changingProgress;
    secondaryPrefRef.current = secondaryPref;

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

    const updateProgress = () => {
        const progress = Spicetify.Player.getProgress();
        if (
            !changingProgressRef.current.isChanging &&
            (Spicetify.Player.isPlaying() || progressRef.current !== progress)
        ) {
            progressRef.current = progress;
            setProgress(progress);
        }
    };
    //Using spotify internal songchange event listener
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateDuration = (meta: any) => {
        setProgress(0);
        progressRef.current = 0;
        durationRef.current = meta.data.duration;
        setDuration(meta.data.duration);
    };

    const updateSecondaryPref = () => {
        const nextValue = !secondaryPrefRef.current;
        secondaryPrefRef.current = nextValue;
        setSecondaryPref(nextValue);
        CFM.set("showRemainingTime", nextValue);
    };
    const getSecondaryTime = () => {
        if (secondaryPref) {
            return " -" + Spicetify.Player.formatTime(curDuration - curProgress);
        } else {
            return Spicetify.Player.formatTime(curDuration);
        }
    };

    React.useEffect(() => {
        // console.log("Progress Effect called");
        if (state === "mousemove") {
            hideProgressBar();
        } else {
            setVisibility(true);
        }
        const updateInterval = setInterval(updateProgress, 500);

        Spicetify.Player.addEventListener("songchange", updateDuration);
        setDragListener();
        return () => {
            // console.log("Progress Effect cleared");
            clearInterval(updateInterval);
            if (progressTimer.current) clearTimeout(progressTimer.current);
            Spicetify.Player.removeEventListener("songchange", updateDuration);
            resetDragListener();
        };
    }, [state]);

    return (
        <div id="fsd-progress-container" style={{ opacity: visibility ? 1 : 0 }}>
            <div className="progress-number" id="fsd-elapsed">
                {Spicetify.Player.formatTime(curProgress)}
            </div>
            <div
                id="fsd-progress-bar"
                ref={progSlider}
                className={classNames({ dragging: changingProgress.isChanging })}>
                <div
                    id="fsd-progress-bar-inner"
                    style={{ width: (curProgress / curDuration) * 100 + "%" }}>
                    <div id="progress-thumb" />
                </div>
            </div>
            <div className="progress-number" id="fsd-duration" onClick={updateSecondaryPref}>
                {getSecondaryTime()}
            </div>
        </div>
    );
};

export default SeekableProgressBar;
