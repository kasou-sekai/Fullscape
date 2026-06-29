import { marked } from "marked";
import ICONS, { DEFAULTS } from "../constants";
import { Config, Settings } from "../types/fullscreen";
import CFM from "../utils/config";
import { sanitizeHtml } from "./sanitize-html";

export function headerText(text: string, subtext = "") {
    const container = document.createElement("div");
    container.classList.add("setting-subhead");
    const listHeader = document.createElement("h2");
    listHeader.innerText = text;
    container.append(listHeader);
    if (subtext) {
        const listSub = document.createElement("div");
        listSub.classList.add("setting-subhead-description");
        listSub.innerHTML = sanitizeHtml(marked.parse(subtext, { breaks: true }) as string);
        container.append(listSub);
    }
    return container;
}

export function getSettingCard(
    actionContent: string,
    title: string,
    key: keyof Settings | keyof Config,
    description = "",
) {
    const settingCard = document.createElement("div");
    settingCard.classList.add("setting-card");
    settingCard.setAttribute("setting-key", key);
    if (key in DEFAULTS) {
        settingCard.setAttribute(
            "setting-default",
            String(CFM.getGlobal(key as keyof Config) === DEFAULTS[key as keyof Config]),
        );
    } else {
        settingCard.setAttribute(
            "setting-default",
            String(CFM.get(key as keyof Settings) === DEFAULTS.def[key as keyof Settings]),
        );
    }
    settingCard.innerHTML = `
        <div class="setting-container">
            <div class="setting-item">
                <label class="setting-title"></label>
                <div class="setting-action">${actionContent}</div>
            </div>
            <div class="setting-description">${sanitizeHtml(marked.parse(description, { breaks: true }) as string)}</div>
        </div>
    `;
    const titleElement = settingCard.querySelector(".setting-title");
    if (titleElement) titleElement.textContent = title;
    return settingCard;
}

export function createAdjust(
    title: string,
    key: keyof Settings,
    unit = "",
    configValue: number,
    step: number,
    min: number,
    max: number,
    onChange: (_: string | number) => void,
    extraDescription = "",
) {
    let value = configValue;

    function adjustValue(dir: number) {
        let temp = Number(value) + dir * step;
        if (temp < min) {
            temp = min;
        } else if (temp > max) {
            temp = max;
        }
        value = Number(Number(temp).toFixed(step >= 1 ? 0 : 2));
        (settingCard.querySelector(".adjust-value") as HTMLElement).innerText = `${value}${unit}`;
        plus?.classList.toggle("disabled", value === max);
        minus?.classList.toggle("disabled", value === min);
        onChange(value);
    }
    const settingCard = getSettingCard(
        `<button class="switch small minus">${ICONS.MINUS}</button>
            <p class="adjust-value">${value}${unit}</p>
        <button class="switch small plus"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.plus2px}</button>`,
        title,
        key,
        extraDescription,
    );
    const minus = settingCard.querySelector<HTMLElement>(".minus");
    const plus = settingCard.querySelector<HTMLElement>(".plus");
    if (minus && plus) {
        minus.classList.toggle("disabled", value === min);
        plus.classList.toggle("disabled", value === max);
        minus.onclick = () => adjustValue(-1);
        plus.onclick = () => adjustValue(1);
    }
    return settingCard;
}
