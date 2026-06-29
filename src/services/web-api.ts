import { Colors } from "../types/fullscreen";
import Utils from "../utils/utils";

const colorsCache = new Map<string, Colors>();
const MAX_COLOR_CACHE_ENTRIES = 20;

class WebAPI {
    static getToken() {
        return Spicetify.Platform.AuthorizationAPI._state.token.accessToken;
    }

    static async getAlbumInfo(id: string) {
        return this.fetchJson(`https://api.spotify.com/v1/albums/${encodeURIComponent(id)}`, {
            headers: {
                Authorization: `Bearer ${WebAPI.getToken()}`,
            },
        });
    }

    static async getArtistInfo(id: string) {
        const variables = encodeURIComponent(JSON.stringify({ uri: `spotify:artist:${id}` }));
        return this.fetchJson(
            `https://api-partner.spotify.com/pathfinder/v1/query?operationName=queryArtistOverview&variables=${variables}&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22d66221ea13998b2f81883c5187d174c8646e4041d67f5b1e103bc262d447e3a0%22%7D%7D`,
            {
                headers: {
                    Authorization: `Bearer ${WebAPI.getToken()}`,
                },
            },
        ).then((res) => res.data.artist);
    }

    static async searchArt(name: string) {
        const params = new URLSearchParams({ q: name, type: "artist", limit: "2" });
        return this.fetchJson(`https://api.spotify.com/v1/search?${params}`, {
            headers: {
                Authorization: `Bearer ${WebAPI.getToken()}`,
            },
        });
    }

    private static async fetchJson(url: string, init: RequestInit) {
        const response = await fetch(url, init);
        if (!response.ok) {
            throw new Error(`Spotify request failed (${response.status})`);
        }
        return response.json();
    }

    static async colorExtractor(uri: string) {
        const cached = colorsCache.get(uri);
        if (cached) return cached;
        const body = await Spicetify.extractColorPreset(uri);
        if (body && body.length) {
            const colorMap = body[0];
            const list: Colors = {};
            if (colorMap.isFallback) throw new Error("No colors returned.");
            list["VIBRANT"] = Utils.rgbToHex(colorMap.colorLight.rgb);
            list["DARK_VIBRANT"] = Utils.rgbToHex(colorMap.colorDark.rgb);
            if (colorsCache.size >= MAX_COLOR_CACHE_ENTRIES) {
                colorsCache.delete(colorsCache.keys().next().value);
            }
            colorsCache.set(uri, list);
            return list;
        }
        throw new Error("No colors returned.");
    }
}

export default WebAPI;
