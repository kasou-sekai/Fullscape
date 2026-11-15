export type PlaybackStateEvent = {
    data?: { is_paused?: boolean; isPaused?: boolean };
};

export function getPlaybackPaused(event?: Event | PlaybackStateEvent): boolean | undefined {
    const data = (event as PlaybackStateEvent | undefined)?.data;
    return data?.is_paused ?? data?.isPaused;
}
