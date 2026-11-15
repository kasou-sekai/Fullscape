export function hexToRgb(hex: string): string | null {
    const expandedHex = hex.replace(/^#?([\da-f])([\da-f])([\da-f])$/i, "$1$1$2$2$3$3");
    const channels = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(expandedHex);
    return channels
        ? channels
              .slice(1)
              .map((channel) => parseInt(channel, 16))
              .join(",")
        : null;
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}
