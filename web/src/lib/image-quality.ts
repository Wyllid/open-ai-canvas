import { tr } from "@/i18n";
const IMAGE_QUALITY_LABELS: Record<string, string> = {
    auto: tr("自动"),
    low: tr("低"),
    medium: tr("中"),
    high: tr("高"),
    xhigh: tr("超高"),
    max: tr("最高"),
    "1k": "1K",
    "2k": "2K",
    "4k": "4K",
};

export function imageQualityLabel(value: string) {
    const normalized = String(value || "").trim().toLowerCase();
    return IMAGE_QUALITY_LABELS[normalized] || value;
}

export function imageQualityDescription(value: string) {
    switch (String(value || "").trim().toLowerCase()) {
        case "auto":
            return tr("由模型决定");
        case "low":
            return tr("更快生成");
        case "medium":
            return tr("均衡模式");
        case "high":
            return tr("优先速度");
        case "xhigh":
            return tr("优先质量");
        case "max":
            return tr("优先细节");
        case "1k":
            return tr("标准清晰度");
        case "2k":
            return tr("更高清晰度");
        case "4k":
            return tr("最高清晰度");
        default:
            return tr("模型支持的质量/分辨率");
    }
}

export function isImageResolutionTier(value: string) {
    return ["1k", "2k", "4k"].includes(String(value || "").trim().toLowerCase());
}
