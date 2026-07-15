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

## Updates

With **Automatically check for updates** enabled, the extension checks the latest stable GitHub Release at startup and caches the result for six hours. Detection only shows a prompt: Full Screen never switches to a newly detected version until the user confirms.

After confirmation, Spotify reloads and runs the exact semantic-version tag through jsDelivr. No terminal command is needed. Turn automatic checks off in **Settings → Updates** to reveal a version selector populated dynamically from stable GitHub Releases. The selector can switch to an earlier release or return to the locally installed bundle; every switch requires confirmation.

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
