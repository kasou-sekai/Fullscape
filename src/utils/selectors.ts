class HtmlSelectors {
    private static readonly EXTRA_BAR_SELECTORS = [
        ".main-nowPlayingBar-right",
        ".Y6soMMBElF7EQDbJv8Xb",
    ];
    static getExtraBarSelector(): HTMLElement | null {
        const nowPlayingBar = document.querySelector('[data-testid="now-playing-bar"]');
        // Spotify's current desktop layout has hashed classes. These controls
        // share the right-hand flex container, including when fullscreen is hidden.
        for (const testId of ["fullscreen-mode-button", "pip-toggle-button", "lyrics-button"]) {
            const controls = nowPlayingBar?.querySelector(`[data-testid="${testId}"]`)?.parentElement;
            if (controls && controls !== nowPlayingBar) return controls;
        }
        for (const selector of this.EXTRA_BAR_SELECTORS) {
            const bar = document.querySelector<HTMLElement>(selector);
            if (bar) return (bar.firstElementChild as HTMLElement | null) ?? bar;
        }
        return null;
    }
}

export default HtmlSelectors;
