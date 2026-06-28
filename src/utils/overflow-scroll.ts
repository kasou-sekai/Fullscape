const EDGE_PAUSE_MS = 3000;
const SCROLL_SPEED_PX_PER_SECOND = 45;
const END_PADDING_PX = 5;

export interface OverflowScrollTiming {
    duration: number;
    leaveLeftOffset: number;
    reachRightOffset: number;
    leaveRightOffset: number;
}

export function getOverflowScrollTiming(maxOverflow: number): OverflowScrollTiming {
    const travelMs =
        ((Math.max(0, maxOverflow) + END_PADDING_PX) / SCROLL_SPEED_PX_PER_SECOND) * 1000;
    const duration = EDGE_PAUSE_MS * 2 + travelMs * 2;

    return {
        duration,
        leaveLeftOffset: EDGE_PAUSE_MS / duration,
        reachRightOffset: (EDGE_PAUSE_MS + travelMs) / duration,
        leaveRightOffset: (EDGE_PAUSE_MS * 2 + travelMs) / duration,
    };
}

export function createOverflowScrollAnimation(
    track: HTMLElement,
    overflow: number,
    timing: OverflowScrollTiming = getOverflowScrollTiming(overflow),
) {
    const distance = Math.max(0, overflow) + END_PADDING_PX;

    return track.animate(
        [
            { transform: "translateX(0)", offset: 0 },
            { transform: "translateX(0)", offset: timing.leaveLeftOffset },
            {
                transform: `translateX(-${distance}px)`,
                offset: timing.reachRightOffset,
            },
            {
                transform: `translateX(-${distance}px)`,
                offset: timing.leaveRightOffset,
            },
            { transform: "translateX(0)", offset: 1 },
        ],
        {
            duration: timing.duration,
            iterations: Infinity,
            easing: "linear",
            fill: "both",
        },
    );
}
