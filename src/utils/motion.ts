export const MAX_BACKGROUND_TRANSITION_SECONDS = 5;

/** Shared timing for CSS transitions and imperative animations. */
export const MOTION = {
    feedback: 160,
    content: 240,
    layout: 380,
    handoff: 520,
    controlsIdle: 3000,
    coverPress: 80,
    queuePress: 100,
    artworkOpacity: 200,
    queueCaptionReveal: 260,
    artworkSettle: 90,
    panel: 180,
    lyric: 520,
    lyricFade: 500,
    lyricBackgroundDelay: 120,
    lyricRevealDelay: 80,
    beatRefresh: 80,
    beatColor: 120,
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    spring: "cubic-bezier(0.22, 1.12, 0.36, 1)",
    lyricEase: "cubic-bezier(0.3, 0.15, 0.2, 1)",
} as const;

export function initializeMotionTokens() {
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(MOTION)) {
        const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        style.setProperty(
            `--fs-motion-${cssKey}`,
            typeof value === "number" ? `${value}ms` : value,
        );
    }
}

export function prefersReducedMotion() {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

const animations = new WeakMap<HTMLElement, Animation>();

export function cancelFeedback(element: HTMLElement) {
    animations.get(element)?.cancel();
    animations.delete(element);
}

/** Replace feedback without an old completion cancelling a newer interaction. */
export function animateFeedback(
    element: HTMLElement | null,
    frames: Keyframe[],
    duration: number = MOTION.content,
) {
    if (!element) return;
    cancelFeedback(element);
    if (prefersReducedMotion() || typeof element.animate !== "function") return;
    const animation = element.animate(frames, { duration, easing: MOTION.ease });
    animations.set(element, animation);
    void animation.finished
        .catch(() => undefined)
        .then(() => {
            if (animations.get(element) === animation) animations.delete(element);
        });
}

export function frameSmoothing(elapsedMs: number, frameRate = 0.28) {
    return 1 - Math.pow(1 - frameRate, Math.min(64, Math.max(0, elapsedMs)) / (1000 / 60));
}
