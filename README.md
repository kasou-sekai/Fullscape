# Full Screen (Spicetify Extension)

Full-screen now-playing extension for Spicetify. Builds into `dist/fullScreen.js`.

## Install

0. Install [Spicetify](https://spicetify.app/#install)
1. Copy `dist/fullScreen.js` into your Spicetify extensions directory
    - Linux/macOS: `~/.config/spicetify/Extensions` (or `$XDG_CONFIG_HOME/spicetify/Extensions`)
    - Windows: `%appdata%/spicetify/Extensions`
2. Enable and apply:

    ```bash
    spicetify config extensions fullScreen.js
    spicetify apply
    ```

## Develop

- Install deps: `npm install`

- Local build: `npm run build-local` (outputs to `dist`)

- Watch mode: `npm run watch`

## Acknowledgements

This extension is based on [daksh2k/Spicetify-stuff](https://github.com/daksh2k/Spicetify-stuff).

Lyrics rendering and animation reference [solstice23/refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease).

The fluid animated background is powered by [Better Lyrics/Kawarp](https://github.com/better-lyrics/kawarp), using its [`@kawarp/core`](https://www.npmjs.com/package/@kawarp/core) WebGL renderer for Kawase blur and domain-warping effects.
