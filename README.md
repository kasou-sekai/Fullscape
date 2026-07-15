# Full Screen (Spicetify Extension)

Full-screen now-playing extension for Spicetify. Builds into `dist/fullScreen.js`.

## Install

0. Install [Spicetify](https://spicetify.app/#install)
1. Download `fullScreen.js` from the [latest GitHub Release](https://github.com/kasou-sekai/Spotify-Full-Screen-Playing/releases/latest), or build `dist/fullScreen.js` locally.
2. Copy `fullScreen.js` into your Spicetify extensions directory
    - Linux/macOS: `~/.config/spicetify/Extensions` (or `$XDG_CONFIG_HOME/spicetify/Extensions`)
    - Windows: `%appdata%/spicetify/Extensions`
3. Enable and apply:

    ```bash
    spicetify config extensions fullScreen.js
    spicetify apply
    ```

## Uninstall

### Remove the extension

1. Print the installed file location before deleting it:

    ```bash
    spicetify path -e fullScreen.js
    ```

2. Remove Full Screen from Spicetify's enabled extensions and apply the change:

    ```bash
    spicetify config extensions fullScreen.js-
    spicetify apply
    ```

3. Delete the `fullScreen.js` file at the location printed in step 1. Common locations are `~/.config/spicetify/Extensions/fullScreen.js` on Linux/macOS and `%appdata%\spicetify\Extensions\fullScreen.js` on Windows.

These steps stop the extension from loading, but they intentionally leave its settings and caches available in case it is installed again.

### Remove all Full Screen settings and caches

Full Screen stores its settings, lyric cache, update metadata, and confirmed GitHub Release scripts inside Spotify's browser storage. To remove only data owned by Full Screen:

1. Enable Spotify developer tools if they are not already available, then restart Spotify:

    ```bash
    spicetify enable-devtools
    spicetify restart
    ```

2. Open Spotify developer tools with `Ctrl+Shift+I` on Windows/Linux or `Cmd+Option+I` on macOS, select the **Console** tab, and run:

    ```js
    (() => {
        const exactKeys = new Set([
            "full-screen-playing:config",
            "full-screen:lyrics-bridge-debug",
        ]);
        const ownedPrefixes = [
            "full-screen:update:",
            "full-screen:lyrics-cache-",
            "full-screen:lyrics-bridge-trace-",
        ];

        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
            const key = localStorage.key(index);
            if (
                key &&
                (exactKeys.has(key) || ownedPrefixes.some((prefix) => key.startsWith(prefix)))
            ) {
                localStorage.removeItem(key);
            }
        }

        const request = indexedDB.deleteDatabase("full-screen-release-cache");
        request.onsuccess = () => console.info("Full Screen data removed.");
        request.onerror = () =>
            console.error("Unable to remove Full Screen release cache.", request.error);
        request.onblocked = () => console.warn("Close other Spotify windows and run this again.");
    })();
    ```

3. Complete the extension removal steps above if `fullScreen.js` is still enabled or installed.

The IndexedDB deletion removes every automatically downloaded and confirmed GitHub Release, while the targeted local-storage cleanup removes Full Screen settings, lyrics, update prompts, cached release lists, and diagnostic traces. It does not remove the shared cache maintained by the separate LyricShiori service; manage that cache through LyricShiori itself if it is installed.

Using Developer Tools → **Application** → **Storage** → **Clear site data** is a broader alternative, but it also deletes Spotify and other extensions' browser data and may require reconfiguration or sign-in. The targeted script above is recommended.

## Updates

With **Automatically check for updates** enabled, the extension checks the latest stable GitHub Release at startup and caches the result for six hours. Detection only shows a prompt: Full Screen never switches to a newly detected version until the user confirms.

After confirmation, Spotify verifies the tagged jsDelivr script against the SHA-256 checksum published with the matching GitHub Release, then caches the verified copy and reloads it. If persistent browser storage is unavailable, the verified version can still run through the network fallback. No terminal command is needed. Turn automatic checks off in **Settings → Updates** to reveal a version selector populated dynamically from stable GitHub Releases. The selector can switch to an earlier release or return to the locally installed bundle; every switch requires confirmation.

To make a manually deployed file authoritative again, turn automatic checks off, select **Installed bundle**, then replace `fullScreen.js` if needed and run:

```bash
spicetify apply
```

No Spicetify Marketplace installation is required for this update channel.

## Develop

-   Install deps: `npm install`

-   Local build: `npm run build-local` (outputs to `dist`)

-   Watch mode: `npm run watch`

## Release

1. Set the stable semantic version without creating a tag:

    ```bash
    npm version 0.2.0 --no-git-tag-version
    ```

2. Check and rebuild the committed distribution:

    ```bash
    npm run check
    npm run build-local
    ```

3. Add the reviewed release copy to `.github/release-notes/v0.2.0.md`.
4. Commit `package.json`, `package-lock.json`, source changes, release notes, and `dist/fullScreen.js`.
5. Create and push the matching annotated tag:

    ```bash
    git tag -a v0.2.0 -m "Full Screen v0.2.0"
    git push origin master
    git push origin v0.2.0
    ```

The release workflow rejects a tag that does not match `package.json` or have matching reviewed release notes, rebuilds and verifies the committed distribution, creates `fullScreen.js.sha256`, and publishes both files in a GitHub Release.

For stronger protection against a published tag or asset being replaced later, enable immutable releases in the repository's GitHub settings.

## Acknowledgements

This extension is based on [daksh2k/Spicetify-stuff](https://github.com/daksh2k/Spicetify-stuff).

Lyrics rendering and animation reference [solstice23/refined-now-playing-netease](https://github.com/solstice23/refined-now-playing-netease).

The fluid animated background is powered by [Better Lyrics/Kawarp](https://github.com/better-lyrics/kawarp), using its [`@kawarp/core`](https://www.npmjs.com/package/@kawarp/core) WebGL renderer for Kawase blur and domain-warping effects.
