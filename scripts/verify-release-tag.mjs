import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const releaseTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? process.argv[2];
const expectedTag = `v${packageJson.version}`;

if (!releaseTag) {
    console.error("Set RELEASE_TAG, GITHUB_REF_NAME, or pass a tag as the first argument.");
    process.exit(1);
}

if (releaseTag !== expectedTag) {
    console.error(`Release tag ${releaseTag} does not match package version ${expectedTag}.`);
    process.exit(1);
}

if (!/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
    console.error(`Release tag ${releaseTag} is not a stable semantic version tag.`);
    process.exit(1);
}

console.log(`Release tag ${releaseTag} matches package.json.`);
