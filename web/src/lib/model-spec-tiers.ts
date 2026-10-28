import { videoResolutionComparisonKey } from "@/lib/video-generation-options";

// 规格档（SKU）的分辨率比较键；"*" 表示不限。
export function normalizeTierResolution(value: string) {
    const raw = String(value || "").trim();
    if (!raw || raw === "*") return "*";
    return videoResolutionComparisonKey(raw);
}
