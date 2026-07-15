import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import jaJP from "./locales/ja-JP.json";
import koKR from "./locales/ko-KR.json";
import defaultsDeep from "lodash.defaultsdeep";

// Translation strings
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const translations: Record<string, any> = {
    "en-US": enUS,
    "zh-CN": defaultsDeep(zhCN, enUS),
    "zh-TW": defaultsDeep(zhTW, enUS),
    "ja-JP": defaultsDeep(jaJP, enUS),
    "ko-KR": defaultsDeep(koKR, enUS),
};

export default translations;
