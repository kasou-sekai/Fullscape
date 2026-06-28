const ALLOWED_TAGS = new Set([
    "A",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "DEL",
    "EM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HR",
    "KBD",
    "LI",
    "OL",
    "P",
    "PRE",
    "STRONG",
    "UL",
]);
const DROP_CONTENT_TAGS = new Set(["IFRAME", "OBJECT", "SCRIPT", "STYLE"]);

function isSafeLink(value: string) {
    if (value.startsWith("#") || value.startsWith("/")) return true;
    try {
        const url = new URL(value);
        return ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch {
        return false;
    }
}

export function sanitizeHtml(html: string) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const elements = Array.from(document.body.querySelectorAll("*"));

    elements.forEach((element) => {
        if (DROP_CONTENT_TAGS.has(element.tagName)) {
            element.remove();
            return;
        }
        if (!ALLOWED_TAGS.has(element.tagName)) {
            element.replaceWith(...Array.from(element.childNodes));
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const isAllowed =
                element.tagName === "A" &&
                (attribute.name === "href" || attribute.name === "title");
            if (!isAllowed) element.removeAttribute(attribute.name);
        });

        if (element instanceof HTMLAnchorElement) {
            const href = element.getAttribute("href");
            if (!href || !isSafeLink(href)) element.removeAttribute("href");
            element.rel = "noopener noreferrer";
        }
    });

    return document.body.innerHTML;
}
