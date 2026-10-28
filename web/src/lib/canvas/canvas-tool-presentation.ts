import { tr } from "@/i18n";
import type { ToolScope } from "@/services/api/tools";
// 各子 Tab 的独立标签集，与 backend internal/tools/seed/tools.json 的 tags 对齐
export const SUB_TAB_TAGS: Record<"style" | "motion", Array<{ id: string; label: string }>> = {
    style: [
        { id: "period", label: tr("古装") },
        { id: "city", label: tr("都市") },
        { id: "decade", label: tr("年代") },
        { id: "life", label: tr("生活") },
        { id: "science_fiction", label: tr("科幻") },
        { id: "type", label: tr("类型") },
        { id: "poetic", label: tr("写意") },
        { id: "animation", label: tr("动画") },
        { id: "drawing", label: tr("绘画") },
        { id: "myth", label: tr("神话") },
    ],
    motion: [
        { id: "basic", label: tr("基础控制") },
        { id: "follow", label: tr("人物跟拍") },
        { id: "reveal", label: tr("揭示转场") },
        { id: "emotion", label: tr("情绪强化") },
        { id: "aerial", label: tr("空间航拍") },
    ],
};

type FeedTab = ToolScope;

export const FEED_TABS: Array<{ id: FeedTab; label: string }> = [
    { id: "public", label: tr("公共") },
    { id: "favorites", label: tr("收藏") },
    { id: "custom", label: tr("自定义") },
];

export function toAbsoluteUrl(value?: string) {
    const text = (value || "").trim();
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith("/") && !text.startsWith("//")) return new URL(text, window.location.origin).href;
    return "";
}
