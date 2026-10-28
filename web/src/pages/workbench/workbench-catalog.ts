import { tr } from "@/i18n";
import type { WorkbenchKind, WorkbenchReferenceSlot } from "@/services/api/workbench";

export const workbenchCategories = [
    { value: "recommended", label: tr("推荐") },
    { value: "people", label: tr("人物") },
    { value: "ecommerce", label: tr("电商") },
    { value: "product", label: tr("商品") },
    { value: "drama-character", label: tr("短剧角色") },
    { value: "drama-scene", label: tr("短剧场景") },
    { value: "storyboard", label: tr("短剧分镜") },
    { value: "short-video", label: tr("短视频") },
    { value: "scene", label: tr("场景") },
    { value: "enhancement", label: tr("增强") },
];

export function workbenchCategoryLabel(id: string) {
    return workbenchCategories.find((category) => category.value === id)?.label || id;
}

export function workbenchModeOptions(kind: WorkbenchKind) {
    return kind === "image"
        ? [
              { value: "image", label: tr("图片生成") },
              { value: "image_edit", label: tr("图片编辑") },
          ]
        : [{ value: "video", label: tr("视频生成") }];
}

export const workbenchMediaLabel = (kind: string) => (kind === "image" ? tr("图片") : kind === "video" ? tr("视频") : tr("音频"));

/** 用户可读的输入约束文案，避免在下拉标签里堆叠过长说明。 */
export function workbenchSlotRequirement(slot: WorkbenchReferenceSlot) {
    const media = slot.mediaTypes.map(workbenchMediaLabel).join(" / ");
    if (slot.required || slot.minCount > 0) return tr("{0} · 必填 {1}-{2} 个", media, slot.minCount, slot.maxCount);
    return tr("{0} · 可选，最多 {1} 个", media, slot.maxCount);
}
