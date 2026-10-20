class HtmlSelectors {
    private static readonly EXTRA_BAR_SELECTORS = [
        ".main-nowPlayingBar-right",
        ".Y6soMMBElF7EQDbJv8Xb",
    ];
    static getExtraBarSelector(): HTMLElement | null {
        for (const selector of this.EXTRA_BAR_SELECTORS) {
            const bar = document.querySelector<HTMLElement>(selector);
            if (bar) return (bar.firstElementChild as HTMLElement | null) ?? bar;
        }
        return null;
    }
}

export default HtmlSelectors;
