# Fullscape

An immersive now-playing experience for Spicetify.

Fullscape turns Spotify's now-playing view into a polished full-screen experience with artwork, animated backgrounds, playback controls, track information, optional lyrics, and multilingual settings. The extension builds to `dist/fullscape.js`.

## Install

0. Install [Spicetify](https://spicetify.app/#install).
1. Download `fullscape.js` from the [latest GitHub Release](https://github.com/kasou-sekai/Fullscape/releases/latest), or build `dist/fullscape.js` locally.
2. Copy `fullscape.js` into your Spicetify extensions directory:
    - Linux/macOS: `~/.config/spicetify/Extensions` (or `$XDG_CONFIG_HOME/spicetify/Extensions`)
    - Windows: `%appdata%/spicetify/Extensions`
3. Enable and apply the extension:

    ```bash
    spicetify config extensions fullscape.js
    spicetify apply
    ```

## Uninstall

1. Print the installed file location:

    ```bash
    spicetify path -e fullscape.js
    ```

2. Disable Fullscape and apply the change:

    ```bash
    spicetify config extensions fullscape.js-
    spicetify apply
    ```

3. Delete the `fullscape.js` file at the location printed in step 1.

To also remove Fullscape-owned browser data, open Spotify developer tools, select the **Console** tab, and run:

```js
(() => {
    const ownedPrefixes = ["fullscape:"];
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && ownedPrefixes.some((prefix) => key.startsWith(prefix))) {
            localStorage.removeItem(key);
        }
    }

    const request = indexedDB.deleteDatabase("fullscape-release-cache");
    request.onsuccess = () => console.info("Fullscape data removed.");
    request.onerror = () => console.error("Unable to remove Fullscape data.", request.error);
    request.onblocked = () => console.warn("Close other Spotify windows and run this again.");
})();
```

This removes only data owned by Fullscape. It does not remove the shared cache maintained by LyricShiori.

## Updates

With **Automatically check for updates** enabled, Fullscape checks the latest stable GitHub Release at startup and caches the result for six hours. A detected update is installed only after confirmation.

After confirmation, Fullscape verifies the tagged jsDelivr script against the SHA-256 checksum published with the matching GitHub Release, caches the verified copy, and reloads Spotify. Turn automatic checks off in **Settings → Updates** to select a stable release manually or return to the installed bundle.

## Develop

- Install dependencies: `npm install`
- Run static checks: `npm run check`
- Run tests: `npm test`
- Build the committed distribution: `npm run build-local`
- Watch source files: `npm run watch`

## Release

1. Set the stable semantic version without creating a tag:

    ```bash
    npm version 1.1.0 --no-git-tag-version
    ```

2. Run checks, tests, and rebuild the committed distribution:

    ```bash
    npm run check
    npm test
    npm run build-local
    ```

3. Add the reviewed release copy to `.github/release-notes/v1.1.0.md`.
4. Commit the version files, source changes, release notes, and `dist/fullscape.js`.
5. Create and push the matching annotated tag:

    ```bash
    git tag -a v1.1.0 -m "Fullscape v1.1.0"
    git push origin master
    git push origin v1.1.0
    ```

The release workflow verifies that the tag matches `package.json`, rebuilds the distribution, creates `fullscape.js.sha256`, and publishes both files in a GitHub Release.

## Acknowledgements

This extension is based on [daksh2k/Spicetify-stuff](https://github.com/daksh2k/Spicetify-stuff).

Lyrics rendering and animation reference [solstice23/refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease).

The fluid animated background is powered by [Better Lyrics/Kawarp](https://github.com/better-lyrics/kawarp), using its [`@kawarp/core`](https://www.npmjs.com/package/@kawarp/core) WebGL renderer.
