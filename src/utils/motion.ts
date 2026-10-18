/** Shared timing for CSS transitions and imperative animations. */
export const MOTION = {
    feedback: 160,
    content: 240,
    layout: 380,
    handoff: 520,
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    spring: "cubic-bezier(0.22, 1.12, 0.36, 1)",
} as const;

export function initializeMotionTokens() {
    const style = document.documentElement.style;
    for (const key of ["feedback", "content", "layout", "handoff"] as const) {
        style.setProperty(`--fs-motion-${key}`, `${MOTION[key]}ms`);
    }
    style.setProperty("--fs-motion-ease", MOTION.ease);
    style.setProperty("--fs-motion-spring", MOTION.spring);
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
