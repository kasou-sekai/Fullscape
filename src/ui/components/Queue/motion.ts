type VerticalBounds = Pick<DOMRect, "top" | "bottom" | "height">;

export function getQueueTileMotion(
    bounds: VerticalBounds,
    viewport: VerticalBounds,
    scrollTop = Number.POSITIVE_INFINITY,
) {
    if (bounds.height <= 0 || viewport.height <= 0) return null;
    const revealDepth = Math.min(96, viewport.height * 0.16);
    const visibleHeight = Math.max(
        0,
        Math.min(bounds.bottom, viewport.bottom) - Math.max(bounds.top, viewport.top),
    );
    const visibleProgress = Math.min(1, visibleHeight / bounds.height);
    const initialTopProtection = Math.max(0, Math.min(1, 1 - scrollTop / revealDepth));
    const clippedAtTop = bounds.top < viewport.top;
    const linearProgress = clippedAtTop
        ? Math.max(visibleProgress, initialTopProtection)
        : visibleProgress;
    const progress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    return {
        progress,
        scaleX: 0.08 + progress * 0.92,
        scaleY: 0.015 + progress * 0.985,
        blur: (1 - progress) * 16,
        translateY: (clippedAtTop ? -14 : 14) * (1 - progress),
        origin: clippedAtTop ? "center bottom" : "center top",
    };
}
