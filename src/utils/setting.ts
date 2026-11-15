import { marked } from "marked";
import ICONS from "../constants";
import { Config, Settings } from "../types/fullscape";
import { sanitizeHtml } from "./sanitize-html";

function renderDescription(text: string) {
    return sanitizeHtml(marked.parse(text, { breaks: true }) as string);
}

export function headerText(text: string, subtext = "") {
    const container = document.createElement("div");
    container.classList.add("setting-subhead");
    const listHeader = document.createElement("h2");
    listHeader.innerText = text;
    container.append(listHeader);
    if (subtext) {
        const listSub = document.createElement("div");
        listSub.classList.add("setting-subhead-description");
        listSub.innerHTML = renderDescription(subtext);
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
    settingCard.innerHTML = `
        <div class="setting-container">
            <div class="setting-item">
                <label class="setting-title"></label>
                <div class="setting-action">${actionContent}</div>
            </div>
            <div class="setting-description">${renderDescription(description)}</div>
        </div>
    `;
    const titleElement = settingCard.querySelector(".setting-title");
    if (titleElement) titleElement.textContent = title;
    return settingCard;
}

export function createToggleControl(
    title: string,
    key: keyof Settings | keyof Config,
    checked: boolean,
    onChange: (checked: boolean) => void,
    description = "",
) {
    const card = getSettingCard(
        `<label class="switch">
            <input type="checkbox">
            <span class="slider"></span>
        </label>`,
        title,
        key,
        description,
    );
    const input = card.querySelector<HTMLInputElement>("input");
    if (input) {
        input.checked = checked;
        input.onchange = () => onChange(input.checked);
    }
    return card;
}

export function createRadioControl<T extends string>(
    title: string,
    key: keyof Settings,
    options: Record<T, string>,
    selected: T,
    onChange: (value: T) => void,
) {
    const card = getSettingCard("", title, key);
    const titleElement = card.querySelector<HTMLElement>(".setting-title");
    if (!titleElement) return card;
    titleElement.id = `fullscape-setting-${key}`;
    const group = document.createElement("div");
    group.className = "fullscape-setting-radio";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", titleElement.id);
    for (const value of Object.keys(options) as T[]) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `fullscape-${key}`;
        input.value = value;
        input.checked = value === selected;
        input.onchange = () => {
            if (input.checked) onChange(value);
        };
        label.append(input, options[value]);
        group.append(label);
    }
    card.querySelector(".setting-action")?.append(group);
    return card;
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

    function commitValue(nextValue: number) {
        let temp = Number(nextValue);
        if (temp < min) {
            temp = min;
        } else if (temp > max) {
            temp = max;
        }
        value = Number(Number(temp).toFixed(step >= 1 ? 0 : 2));
        (settingCard.querySelector(".adjust-value") as HTMLElement).innerText = `${value}${unit}`;
        const range = settingCard.querySelector<HTMLInputElement>(".adjust-range");
        if (range) range.value = String(value);
        plus?.classList.toggle("disabled", value === max);
        minus?.classList.toggle("disabled", value === min);
        onChange(value);
    }

    function adjustValue(dir: number) {
        commitValue(Number(value) + dir * step);
    }

    const settingCard = getSettingCard(
        `<div class="adjust-control">
            <div class="adjust-stepper">
                <button class="switch small minus">${ICONS.MINUS}</button>
                <p class="adjust-value">${value}${unit}</p>
                <button class="switch small plus"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.plus2px}</svg></button>
            </div>
            <input class="adjust-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>`,
        title,
        key,
        extraDescription,
    );
    const minus = settingCard.querySelector<HTMLElement>(".minus");
    const plus = settingCard.querySelector<HTMLElement>(".plus");
    const range = settingCard.querySelector<HTMLInputElement>(".adjust-range");
    if (minus && plus) {
        minus.classList.toggle("disabled", value === min);
        plus.classList.toggle("disabled", value === max);
        minus.onclick = () => adjustValue(-1);
        plus.onclick = () => adjustValue(1);
    }
    if (range) {
        range.oninput = (event) => commitValue(Number((event.target as HTMLInputElement).value));
    }
    return settingCard;
}
