# Full Screen (Spicetify Extension)

Full-screen now-playing extension for Spicetify. Builds into `dist/fullScreen.js`.

## Install

1. Copy `dist/fullScreen.js` into your Spicetify extensions directory
    - Linux/macOS: `~/.config/spicetify/Extensions` (or `$XDG_CONFIG_HOME/spicetify/Extensions`)
    - Windows: `%appdata%/spicetify/Extensions`
2. Enable and apply:
    ```bash
    spicetify config extensions fullScreen.js
    spicetify apply
    ```

## Develop

-   Install deps: `npm install`
-   Local build: `npm run build-local` (outputs to `dist`)
-   Watch mode: `npm run watch`
