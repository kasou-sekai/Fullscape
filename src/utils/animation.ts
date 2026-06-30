import Kawarp from "@kawarp/core";
import { Settings } from "../types/fullscreen";
import { AudioAnalysis, getAudioAnalysis, getAudioMotion } from "../services/audio-analysis";
import CFM from "./config";

let transitionFrameId: number | null = null;
let rotationFrameId: number | null = null;
let rotationGeneration = 0;
let fluidRenderer: Kawarp | null = null;
let fluidCanvas: HTMLCanvasElement | null = null;
let fluidFallbackCanvas: HTMLCanvasElement | null = null;
let fluidMotionTimer: ReturnType<typeof setInterval> | null = null;
let fluidAnalysis: AudioAnalysis | null = null;
let fluidTrackUri = "";
let fluidAnalysisGeneration = 0;
let fluidHasImage = false;
let fluidIsPlaying = false;
let fluidSmoothedSpeedMultiplier = 1;
let fluidSmoothedWarpPulse = 0;

const FLUID_RENDER_SCALE = 0.7;
const FLUID_MOTION_INTERVAL_MS = 80;
const FLUID_BASE_WARP_INTENSITY = 0.82;
const FLUID_BASE_SCALE = 1.1;
const FLUID_BASE_SATURATION = 1.45;

function cancelTransitionAnimation() {
    if (transitionFrameId !== null) {
        cancelAnimationFrame(transitionFrameId);
        transitionFrameId = null;
    }
}

export function animateCanvas(
    prevImg: HTMLImageElement,
    nextImg: HTMLImageElement,
    back: HTMLCanvasElement,
    fromResize = false,
) {
    cancelTransitionAnimation();
    const configTransitionTime = Math.min(
        10,
        Math.max(0, Number(CFM.get("backAnimationTime")) || 0),
    );
    const { innerWidth: width, innerHeight: height } = window;
    back.width = width;
    back.height = height;

    const ctx = back.getContext("2d") as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    const blur = Math.min(200, Math.max(0, Number(CFM.get("blurSize")) || 0));
    ctx.filter = `brightness(${CFM.get("backgroundBrightness")}) blur(${blur}px)`;

    const vals = getSizeValues(width, height, nextImg.width, nextImg.height);
    const x = vals.x - blur * 2;
    const y = vals.y - blur * 2;
    const sizeX = vals.width + blur * 4;
    const sizeY = vals.height + blur * 4;

    if (fromResize) {
        ctx.globalAlpha = 1;
        ctx.drawImage(nextImg, x, y, sizeX, sizeY);
        return;
    }

    let prevTimeStamp: number,
        start: number,
        done = false;

    const animate = (timestamp: number) => {
        if (start === undefined) start = timestamp;

        const elapsed = timestamp - start;

        if (prevTimeStamp !== timestamp) {
            const factor = Math.min(elapsed / (configTransitionTime * 1000), 1.0);
            ctx.globalAlpha = 1;
            ctx.drawImage(prevImg, x, y, sizeX, sizeY);
            ctx.globalAlpha = Math.sin((Math.PI / 2) * factor);
            ctx.drawImage(nextImg, x, y, sizeX, sizeY);
            if (factor === 1.0) done = true;
        }
        if (elapsed < configTransitionTime * 1000) {
            prevTimeStamp = timestamp;
            if (!done) transitionFrameId = requestAnimationFrame(animate);
        } else {
            transitionFrameId = null;
        }
    };

    transitionFrameId = requestAnimationFrame(animate);
}

let prevColor = "#000000";
export async function animateColor(nextColor: string, back: HTMLCanvasElement, fromConfig = false) {
    cancelTransitionAnimation();
    const configTransitionTime = Math.min(
        10,
        Math.max(0, Number(CFM.get("backAnimationTime")) || 0),
    );
    const { innerWidth: width, innerHeight: height } = window;
    back.width = width;
    back.height = height;

    const ctx = back.getContext("2d") as CanvasRenderingContext2D;

    if (fromConfig) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = nextColor;
        ctx.fillRect(0, 0, width, height);
        return;
    }

    let previousTimeStamp: number,
        done = false,
        start: number;
    const animate = (timestamp: number) => {
        if (start === undefined) start = timestamp;
        const elapsed = timestamp - start;

        if (previousTimeStamp !== timestamp) {
            const factor = Math.min(elapsed / (configTransitionTime * 1000), 1.0);
            ctx.globalAlpha = 1;
            ctx.fillStyle = prevColor;
            ctx.fillRect(0, 0, width, height);
            ctx.globalAlpha = Math.sin((Math.PI / 2) * factor);
            ctx.fillStyle = nextColor;
            ctx.fillRect(0, 0, width, height);
            if (factor === 1.0) done = true;
        }
        if (elapsed < configTransitionTime * 1000) {
            previousTimeStamp = timestamp;
            if (!done) transitionFrameId = requestAnimationFrame(animate);
        } else {
            prevColor = nextColor;
            transitionFrameId = null;
        }
    };

    transitionFrameId = requestAnimationFrame(animate);
}

let isAnimationRunning = false;

function cancelRotationAnimation() {
    rotationGeneration += 1;
    if (rotationFrameId !== null) {
        cancelAnimationFrame(rotationFrameId);
        rotationFrameId = null;
    }
}

function getFluidTransitionDuration() {
    return Math.min(5000, Math.max(0, Number(CFM.get("backAnimationTime")) || 0) * 1000);
}

function getFluidBaseSpeed() {
    return Math.min(1.8, Math.max(0.45, 0.45 + rotationSpeed * 3.2));
}

function getFluidOptions() {
    const blurSize = Math.min(200, Math.max(0, Number(CFM.get("blurSize")) || 0));
    return {
        warpIntensity: FLUID_BASE_WARP_INTENSITY,
        blurPasses: Math.min(16, Math.max(4, Math.round(blurSize / 8) + 4)),
        animationSpeed: getFluidBaseSpeed(),
        transitionDuration: getFluidTransitionDuration(),
        saturation: FLUID_BASE_SATURATION,
        tintIntensity: 0.05,
        dithering: 0.006,
        scale: FLUID_BASE_SCALE,
    };
}

function resizeFluidCanvas() {
    if (!fluidCanvas || !fluidRenderer) return;
    const width = Math.max(1, Math.round(window.innerWidth * FLUID_RENDER_SCALE));
    const height = Math.max(1, Math.round(window.innerHeight * FLUID_RENDER_SCALE));
    if (fluidCanvas.width === width && fluidCanvas.height === height) return;
    fluidCanvas.width = width;
    fluidCanvas.height = height;
    fluidRenderer.resize();
}

function disposeFluidAnimation() {
    fluidAnalysisGeneration += 1;
    if (fluidMotionTimer !== null) {
        clearInterval(fluidMotionTimer);
        fluidMotionTimer = null;
    }
    if (fluidRenderer) {
        try {
            fluidRenderer.dispose();
        } catch (error) {
            console.warn("Unable to dispose fluid background:", error);
        }
    }
    if (fluidCanvas) {
        fluidCanvas.style.opacity = "0";
    }
    if (fluidFallbackCanvas) {
        fluidFallbackCanvas.style.removeProperty("opacity");
    }
    fluidRenderer = null;
    fluidCanvas = null;
    fluidFallbackCanvas = null;
    fluidAnalysis = null;
    fluidTrackUri = "";
    fluidHasImage = false;
    fluidIsPlaying = false;
    fluidSmoothedSpeedMultiplier = 1;
    fluidSmoothedWarpPulse = 0;
}

function getBeatMotionSettings() {
    const getValue = (key: keyof Settings, fallback: number, min: number, max: number) => {
        const value = Number(CFM.get(key));
        return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
    };
    return {
        scaleAmount: getValue("beatScaleAmount", 0.18, 0, 0.4),
        warpAmount: getValue("beatWarpAmount", 0.08, 0, 0.18),
        saturationAmount: getValue("beatSaturationAmount", 0.2, 0, 0.6),
        speedAmount: getValue("beatSpeedAmount", 0.2, 0, 0.6),
        attack: getValue("beatAttack", 0.8, 0.05, 1),
        release: getValue("beatRelease", 0.08, 0.01, 0.5),
    };
}

function smoothMotionValue(current: number, target: number, attack: number, release: number) {
    const rate = target > current ? attack : release;
    return current + (target - current) * rate;
}

function updateFluidDebug(
    status: string,
    currentTime: number,
    rawBeat = 0,
    speed = 0,
    warp = FLUID_BASE_WARP_INTENSITY,
    scale = FLUID_BASE_SCALE,
) {
    const debug = document.querySelector<HTMLElement>("#fsd-background-debug");
    if (!debug) return;

    const beatStrength = Math.min(1, Math.max(0, fluidSmoothedWarpPulse));
    debug.style.setProperty("--debug-beat-strength", beatStrength.toFixed(3));
    debug.classList.toggle("beat-active", rawBeat >= 0.12);

    const setText = (selector: string, value: string) => {
        const element = debug.querySelector<HTMLElement>(selector);
        if (element) element.textContent = value;
    };
    const minutes = Math.floor(Math.max(0, currentTime) / 60);
    const seconds = (Math.max(0, currentTime) % 60).toFixed(1).padStart(4, "0");
    setText("[data-debug-status]", status);
    setText("[data-debug-beat]", rawBeat.toFixed(2));
    setText("[data-debug-smooth]", fluidSmoothedWarpPulse.toFixed(2));
    setText("[data-debug-speed]", speed.toFixed(2));
    setText("[data-debug-warp]", warp.toFixed(3));
    setText("[data-debug-scale]", scale.toFixed(3));
    setText("[data-debug-time]", `${minutes}:${seconds}`);
}

function syncFluidMotion() {
    if (!fluidRenderer) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isPlaying = !reduceMotion && Spicetify.Player.isPlaying();
    if (!isPlaying) {
        if (fluidIsPlaying) fluidRenderer.stop();
        fluidIsPlaying = false;
        updateFluidDebug(reduceMotion ? "REDUCED" : "PAUSED", Spicetify.Player.getProgress() / 1000);
        return;
    }

    if (!fluidIsPlaying) {
        fluidRenderer.start();
        fluidIsPlaying = true;
    }

    const currentTime = Spicetify.Player.getProgress() / 1000;
    const motion = fluidAnalysis
        ? getAudioMotion(fluidAnalysis, currentTime)
        : { ambientSpeedMultiplier: 1, warpPulse: 0 };
    const beatBounce = Boolean(CFM.get("beatBounce"));
    const motionSettings = getBeatMotionSettings();
    const targetSpeedMultiplier =
        motion.ambientSpeedMultiplier + (beatBounce ? motion.warpPulse * motionSettings.speedAmount : 0);
    fluidSmoothedSpeedMultiplier = smoothMotionValue(
        fluidSmoothedSpeedMultiplier,
        Math.min(1.65, Math.max(0.7, targetSpeedMultiplier)),
        motionSettings.attack,
        motionSettings.release,
    );
    fluidSmoothedWarpPulse = smoothMotionValue(
        fluidSmoothedWarpPulse,
        motion.warpPulse,
        motionSettings.attack,
        motionSettings.release,
    );
    const baseSpeed = getFluidBaseSpeed();
    const animationSpeed = Math.min(
        3,
        Math.max(0.1, baseSpeed * fluidSmoothedSpeedMultiplier),
    );
    const effectPulse = beatBounce ? fluidSmoothedWarpPulse : 0;
    const warpIntensity = Math.min(
        1,
        FLUID_BASE_WARP_INTENSITY + effectPulse * motionSettings.warpAmount,
    );
    const scale = Math.min(1.5, FLUID_BASE_SCALE + effectPulse * motionSettings.scaleAmount);
    const saturation = Math.min(
        2.2,
        FLUID_BASE_SATURATION + effectPulse * motionSettings.saturationAmount,
    );
    fluidRenderer.setOptions({
        animationSpeed,
        warpIntensity,
        scale,
        saturation,
    });
    updateFluidDebug(
        beatBounce ? (fluidAnalysis ? "ANALYSIS" : "BASE") : "BOUNCE OFF",
        currentTime,
        motion.warpPulse,
        animationSpeed,
        warpIntensity,
        scale,
    );
}

function updateFluidTrack(trackUri: string) {
    if (fluidTrackUri === trackUri) return;
    fluidTrackUri = trackUri;
    fluidAnalysis = null;
    const generation = ++fluidAnalysisGeneration;
    void getAudioAnalysis(trackUri).then((analysis) => {
        if (generation !== fluidAnalysisGeneration || trackUri !== fluidTrackUri) return;
        fluidAnalysis = analysis;
        syncFluidMotion();
    });
}

export function animatedFluidCanvas(
    back: HTMLCanvasElement,
    canvas: HTMLCanvasElement,
    bgImg: HTMLImageElement,
    trackUri: string,
    fromResize = false,
) {
    cancelTransitionAnimation();
    cancelRotationAnimation();
    isAnimationRunning = true;

    try {
        if (!fluidRenderer || fluidCanvas !== canvas) {
            disposeFluidAnimation();
            fluidCanvas = canvas;
            fluidFallbackCanvas = back;
            fluidRenderer = new Kawarp(canvas, getFluidOptions());
            fluidMotionTimer = setInterval(syncFluidMotion, FLUID_MOTION_INTERVAL_MS);
        } else {
            fluidRenderer.setOptions(getFluidOptions());
        }

        resizeFluidCanvas();
        const brightness = Math.min(1, Math.max(0, Number(CFM.get("backgroundBrightness")) || 0));
        canvas.style.filter = `brightness(${brightness})`;

        if (!fromResize || !fluidHasImage) {
            const hadImage = fluidHasImage;
            const shouldAnimate =
                Spicetify.Player.isPlaying() &&
                !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const transitionDuration = getFluidTransitionDuration();
            const renderImmediately = !shouldAnimate || !hadImage;
            if (renderImmediately) fluidRenderer.setOptions({ transitionDuration: 0 });
            fluidRenderer.loadImageElement(bgImg);
            fluidHasImage = true;
            if (renderImmediately) {
                fluidRenderer.renderFrame(0);
                fluidRenderer.setOptions({ transitionDuration });
            }
            updateFluidTrack(trackUri);
        }

        canvas.style.opacity = "1";
        back.style.opacity = "0";
        syncFluidMotion();
        return true;
    } catch (error) {
        console.warn("Fluid background unavailable; using canvas fallback:", error);
        updateFluidDebug("FALLBACK", Spicetify.Player.getProgress() / 1000);
        disposeFluidAnimation();
        return false;
    }
}

export const modifyIsAnimationRunning = (value: boolean) => {
    isAnimationRunning = value;
    if (!value) {
        cancelTransitionAnimation();
        cancelRotationAnimation();
        disposeFluidAnimation();
    }
};

let rotationSpeed = CFM.get("animationSpeed") as Settings["animationSpeed"];

export const modifyRotationSpeed = (value: number) => {
    rotationSpeed = Math.min(2, Math.max(0, value));
    syncFluidMotion();
};

export function animatedRotatedCanvas(back: HTMLCanvasElement, bgImg: HTMLImageElement) {
    modifyIsAnimationRunning(false);
    isAnimationRunning = true;
    const generation = ++rotationGeneration;
    const ctx = back.getContext("2d") as CanvasRenderingContext2D;

    back.width = window.innerWidth;
    back.height = window.innerHeight;

    const blur = Math.min(200, Math.max(Number(CFM.get("blurSize")) || 0, 28));
    const brightness = Math.min(Math.max(Number(CFM.get("backgroundBrightness")) || 0, 0), 0.7);

    ctx.filter = `saturate(2) brightness(${brightness}) blur(${blur}px)`;

    const radius = Math.min(back.width, back.height);

    let rotationAngle = 0;
    let lastFrameTime = 0;
    const frameInterval = 1000 / 30;

    function draw(timestamp: number) {
        if (!isAnimationRunning || generation !== rotationGeneration) return;
        if (timestamp - lastFrameTime < frameInterval) {
            rotationFrameId = requestAnimationFrame(draw);
            return;
        }
        const elapsedFrames = lastFrameTime ? (timestamp - lastFrameTime) / (1000 / 60) : 1;
        lastFrameTime = timestamp;
        ctx.clearRect(0, 0, back.width, back.height);

        ctx.save();
        ctx.translate(0, 0);
        ctx.rotate(((2 * Math.PI) / 360) * rotationAngle);
        ctx.drawImage(bgImg, -radius, -radius, radius * 2, radius * 2);
        ctx.restore();

        ctx.save();
        ctx.translate(back.width / 2, 0);
        ctx.rotate(((2 * Math.PI) / 360) * rotationAngle + Math.PI);
        ctx.drawImage(bgImg, -radius, -radius, radius * 2, radius * 2);
        ctx.restore();

        rotationAngle += rotationSpeed * elapsedFrames;
        rotationFrameId = requestAnimationFrame(draw);
    }
    rotationFrameId = requestAnimationFrame(draw);
}

function getSizeValues(
    parentWidth: number,
    parentHeight: number,
    childWidth: number,
    childHeight: number,
) {
    const doRatio = childWidth / childHeight;
    const cRatio = parentWidth / parentHeight;
    let width = parentWidth;
    let height = parentHeight;

    if (doRatio < cRatio) {
        height = width / doRatio;
    } else {
        width = height * doRatio;
    }

    return {
        width,
        height,
        x: (parentWidth - width) / 2,
        y: (parentHeight - height) / 2,
    };
}
