import type { Typography } from "../types/fullscape";

export const typographyWeights = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export function getTypography({ preset, family, weight }: Typography): Typography {
    return {
        preset: preset === "serif" || preset === "custom" ? preset : "default",
        family: family.trim().slice(0, 120),
        weight: typographyWeights.includes(weight) ? weight : 0,
    };
}

export function applyTypography(settings: Typography) {
    const { preset, family, weight } = getTypography(settings);
    const root = document.documentElement;
    root.dataset.fullscapeFont = preset;
    root.toggleAttribute("data-fullscape-font-weight", weight !== 0);
    if (weight) root.style.setProperty("--fullscape-font-weight", String(weight));
    else root.style.removeProperty("--fullscape-font-weight");

    if (preset === "custom" && family) {
        root.style.setProperty("--fullscape-custom-font", `"${CSS.escape(family)}", sans-serif`);
    } else {
        root.style.removeProperty("--fullscape-custom-font");
    }
}
