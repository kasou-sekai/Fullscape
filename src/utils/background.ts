import { DOM } from "../ui/elements";
import { animatedFluidCanvas, animatedRotatedCanvas, modifyIsAnimationRunning } from "./animation";

export class Background {
    private static updateSequence = 0;

    static stop() {
        this.updateSequence += 1;
        modifyIsAnimationRunning(false);
    }

    static async updateBackground(meta: Partial<Record<string, unknown>> = {}, fromResize = false) {
        const sequence = ++this.updateSequence;
        DOM.back.classList.add("animated");
        modifyIsAnimationRunning(true);
        this.loadBackgroundImage(meta?.image_xlarge_url as string, sequence, fromResize);
    }

    private static loadBackgroundImage(imageUrl: string, sequence: number, fromResize: boolean) {
        if (!imageUrl) return;
        const render = () => {
            if (sequence !== this.updateSequence) return;
            const fluidRendered = animatedFluidCanvas(
                DOM.back,
                DOM.fluidBack,
                DOM.backgroundImg,
                Spicetify.Player.data.item?.uri ?? "",
                fromResize,
            );
            if (!fluidRendered) animatedRotatedCanvas(DOM.back, DOM.backgroundImg);
        };

        DOM.backgroundImg.onload = render;
        DOM.backgroundImg.onerror = () => {
            if (sequence === this.updateSequence)
                console.warn("Unable to load the selected background image.");
        };
        if (fromResize && DOM.backgroundImg.complete && DOM.backgroundImg.naturalWidth > 0) {
            render();
        } else {
            DOM.backgroundImg.src = imageUrl;
        }
    }
}
