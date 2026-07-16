import WebAPI from "../services/web-api";
import CFM from "./config";
import { Colors, Settings } from "../types/fullscape";
import Utils from "./utils";

class ColorExtractor {
    private static readonly DEFAULT_FALLBACK_COLOR = "0,0,0";
    private static readonly BRIGHTNESS_THRESHOLD = 0.3;

    // RGB color coefficients for luminance calculation
    private static readonly LUMINANCE_COEFFICIENTS = {
        RED: 0.299,
        GREEN: 0.587,
        BLUE: 0.114,
    };

    /**
     * Extracts and determines the main color and contrast color based on image and user settings
     * @param imageURL - URL of the image to extract colors from
     * @returns Promise resolving to [mainColor, contrastColor] as RGB strings
     */
    static async getMainColor(imageURL: string): Promise<[string, string]> {
        const imageColors = await WebAPI.colorExtractor(imageURL).catch((err) => {
            console.warn("Color extraction failed:", err);
            return null;
        });

        const imageProminentColor = this.getAlbumArtColor(imageColors);
        const isLightBackground = this.calculateBackgroundLightness(
            imageProminentColor,
            this.calculateBrightnessAdjustedThreshold(),
        );
        return this.determineColors(isLightBackground);
    }

    /**
     * Extracts color from album or artist art
     */
    private static getAlbumArtColor(imageColors: Colors | undefined): string {
        const color = imageColors?.PROMINENT ?? imageColors?.VIBRANT ?? imageColors?.DARK_VIBRANT;
        if (!color) {
            return this.DEFAULT_FALLBACK_COLOR;
        }
        return Utils.hexToRgb(color) ?? this.DEFAULT_FALLBACK_COLOR;
    }

    /**
     * Calculates brightness-adjusted threshold for album/artist art modes
     */
    private static calculateBrightnessAdjustedThreshold(): number {
        const backgroundBrightness = CFM.get(
            "backgroundBrightness",
        ) as Settings["backgroundBrightness"];
        return 260 - backgroundBrightness * 100;
    }

    /**
     * Determines if background is light based on luminance calculation
     */
    private static calculateBackgroundLightness(rgbColor: string, threshold: number): boolean {
        const [red, green, blue] = rgbColor.split(",").map(Number);
        const luminance =
            red * this.LUMINANCE_COEFFICIENTS.RED +
            green * this.LUMINANCE_COEFFICIENTS.GREEN +
            blue * this.LUMINANCE_COEFFICIENTS.BLUE;
        return luminance > threshold;
    }

    /**
     * Determines final main and contrast colors based on background lightness and mode
     */
    private static determineColors(isLightBackground: boolean): [string, string] {
        const darkColor = "0,0,0";
        const lightColor = "255,255,255";
        const brightnessThreshold =
            Number(CFM.get("backgroundBrightness")) > this.BRIGHTNESS_THRESHOLD;
        const useDarkText = isLightBackground && brightnessThreshold;
        return useDarkText ? [darkColor, lightColor] : [lightColor, darkColor];
    }
}

export default ColorExtractor;
