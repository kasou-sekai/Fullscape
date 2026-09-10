import CFM from "../../../utils/config";
import translations from "../../../resources/strings";
import { DOM } from "../../elements";

/** Cover interactions live as long as the current display markup. */
export class Cover {
    private static events: AbortController | null = null;
    private static dialog: HTMLDialogElement | null = null;
    private static animation: Animation | null = null;
    private static closing = false;
    private static source = "";

    private static get strings() {
        return (translations[CFM.getGlobal("locale") as string] || translations["en-US"]).cover;
    }

    static attach() {
        this.teardown();
        const events = (this.events = new AbortController());
        const options = { signal: events.signal };
        const cover = DOM.cover;
        const hitbox = cover.parentElement;
        cover.tabIndex = 0;
        cover.setAttribute("role", "button");
        cover.setAttribute("aria-label", this.strings.enlarge);
        cover.setAttribute("aria-haspopup", "dialog");
        hitbox.addEventListener(
            "pointerdown",
            (event) => {
                // A mouse click should not leave a keyboard focus ring around the artwork.
                if (event.pointerType === "mouse") cover.blur();
            },
            options,
        );
        const press = (event: PointerEvent) => {
            if (event.pointerType !== "mouse" || this.dialog) return;
            const rect = cover.parentElement.getBoundingClientRect();
            const x = Math.max(
                -1,
                Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2),
            );
            const y = Math.max(
                -1,
                Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2),
            );
            cover.classList.add("is-pressing");
            cover.style.transform = window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "none"
                : `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg) scale(0.975)`;
        };
        hitbox.addEventListener("pointerenter", press, options);
        hitbox.addEventListener("pointermove", press, options);
        hitbox.addEventListener(
            "pointerleave",
            () => {
                cover.style.transform = "";
                cover.classList.remove("is-pressing");
            },
            options,
        );
        hitbox.addEventListener("click", () => void this.open(), options);
        hitbox.addEventListener("dblclick", (event) => event.stopPropagation(), options);
        cover.addEventListener(
            "keydown",
            (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                void this.open();
            },
            options,
        );
    }

    static updateImage() {
        this.dismiss();
        this.source = DOM.coverImg.src;
        const ratio = DOM.coverImg.naturalWidth / DOM.coverImg.naturalHeight || 1;
        DOM.cover.parentElement.style.width = `${Math.min(1, ratio) * 100}%`;
        DOM.cover.style.paddingBottom = `${(1 / ratio) * 100}%`;
    }

    private static async open() {
        if (this.dialog || !this.source) return;
        const cover = DOM.cover;
        const dialog = document.createElement("dialog");
        dialog.className = "fullscape-cover-viewer";
        dialog.setAttribute("aria-label", this.strings.artwork);
        const image = document.createElement("img");
        image.src = this.source;
        image.alt = DOM.title.textContent || this.strings.artwork;
        image.draggable = false;
        // Decode before hiding the source so the modal never paints an empty frame.
        this.dialog = dialog;
        try {
            await image.decode();
        } catch {
            if (this.dialog === dialog) this.dismiss();
            return;
        }
        if (this.dialog !== dialog) return;
        const rect = cover.getBoundingClientRect();
        dialog.append(image);
        DOM.container.append(dialog);
        dialog.showModal();
        const fit = () => {
            const ratio = DOM.coverImg.naturalWidth / DOM.coverImg.naturalHeight || 1;
            const width = Math.min(
                Math.max(1, window.innerWidth - 64),
                Math.max(1, window.innerHeight - 64) * ratio,
            );
            image.style.width = `${width}px`;
            image.style.height = `${width / ratio}px`;
        };
        fit();
        const resize = () => {
            if (this.dialog !== dialog) return;
            if (this.closing) this.dismiss();
            else {
                this.animation?.cancel();
                fit();
            }
        };
        window.addEventListener("resize", resize, { signal: this.events.signal });
        dialog.addEventListener("close", () => window.removeEventListener("resize", resize), {
            once: true,
        });
        const target = image.getBoundingClientRect();
        const from = `translate(${rect.left - target.left}px, ${rect.top - target.top}px) scale(${rect.width / target.width}, ${rect.height / target.height})`;
        this.animation = image.animate([{ transform: from }, { transform: "none" }], {
            duration: this.duration(),
            easing: "cubic-bezier(0.22, 1.18, 0.36, 1)",
        });
        cover.style.visibility = "hidden";
        cover.style.transform = "";
        cover.classList.remove("is-pressing");
        DOM.container.classList.add("fullscape-cover-expanded");
        dialog.classList.add("is-open");
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog || event.target === image) this.close();
        });
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            this.close();
        });
        // Keep Spotify shortcuts and the settings context menu out of the viewer.
        dialog.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                this.close();
            }
        });
        dialog.addEventListener("contextmenu", (event) => event.stopPropagation());
        dialog.addEventListener("dblclick", (event) => event.stopPropagation());
    }

    private static duration() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380;
    }

    static close() {
        if (!this.dialog || this.closing) return;
        const dialog = this.dialog;
        const image = dialog.querySelector("img");
        if (!image) {
            this.dismiss();
            return;
        }
        this.closing = true;
        const current = getComputedStyle(image).transform;
        this.animation?.cancel();
        const target = DOM.cover.getBoundingClientRect();
        const rect = image.getBoundingClientRect();
        this.animation = image.animate(
            [
                { transform: current },
                {
                    transform: `translate(${target.left - rect.left}px, ${target.top - rect.top}px) scale(${target.width / rect.width}, ${target.height / rect.height})`,
                },
            ],
            {
                duration: this.duration(),
                easing: "cubic-bezier(0.22, 1.18, 0.36, 1)",
                fill: "forwards",
            },
        );
        dialog.classList.remove("is-open");
        // Restore the surrounding content while the artwork returns to its slot.
        DOM.container.classList.remove("fullscape-cover-expanded");
        void this.animation.finished
            .then(() => {
                if (this.dialog !== dialog) return;
                this.dismiss();
            })
            .catch(() => undefined);
    }

    private static dismiss() {
        this.animation?.cancel();
        this.animation = null;
        this.dialog?.close();
        this.dialog?.remove();
        this.dialog = null;
        this.closing = false;
        DOM.container?.classList.remove("fullscape-cover-expanded");
        if (DOM.cover) {
            DOM.cover.style.visibility = "";
            DOM.cover.style.transform = "";
            DOM.cover.classList.remove("is-pressing");
        }
    }

    static teardown() {
        this.dismiss();
        this.events?.abort();
        this.events = null;
        if (DOM.cover) {
            DOM.cover.style.transform = "";
            DOM.cover.classList.remove("is-pressing");
        }
    }
}
