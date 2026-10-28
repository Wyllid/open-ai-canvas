import { tr } from "@/i18n";
export const modelTagColors = [
    { value: "purple", label: tr("紫色") },
    { value: "blue", label: tr("蓝色") },
    { value: "green", label: tr("绿色") },
    { value: "gold", label: tr("金色") },
    { value: "orange", label: tr("橙色") },
    { value: "pink", label: tr("粉色") },
] as const;

export type ModelTag = { text: string; color: typeof modelTagColors[number]["value"] };

export function videoReferenceCapabilityTag(references?: { maxImages?: number; maxVideos?: number; maxAudios?: number }): ModelTag | undefined {
    if (!references) return undefined;
    const counts = [
        [tr("图"), references.maxImages],
        [tr("视"), references.maxVideos],
        [tr("音"), references.maxAudios],
    ] as const;
    const text = counts
        .filter(([, count]) => typeof count === "number" && Number.isFinite(count) && count > 0)
        .map(([label, count]) => `${label}×${count}`)
        .join(" · ");
    return text ? { text, color: "green" } : undefined;
}
