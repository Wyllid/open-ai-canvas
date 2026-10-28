import { tr } from "@/i18n";
import { extractCharacterBreakdownJson, parseCharacterBreakdown, type CharacterBreakdown } from "./canvas-character-reference";

export type ChapterAssetDefinition = { name: string; description: string; prompt: string };
export type ChapterAssetBreakdown = { characters: CharacterBreakdown[]; scenes: ChapterAssetDefinition[]; props: ChapterAssetDefinition[] };

export function parseChapterAssetBreakdown(raw: string): ChapterAssetBreakdown {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const value: unknown = extractCharacterBreakdownJson(text, true);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(tr("章节资产结果必须是 JSON 对象"));
    const payload = value as Record<string, unknown>;
    if (!Array.isArray(payload.characters) || !Array.isArray(payload.scenes) || !Array.isArray(payload.props)) {
        throw new Error(tr("章节资产结果缺少角色、场景或道具数组，请重新提取"));
    }
    const parseAssets = (items: unknown[], label: string): ChapterAssetDefinition[] => items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(tr("{0}资产格式无效", label));
        const asset = item as Record<string, unknown>;
        for (const key of ["name", "description", "prompt"]) {
            if (typeof asset[key] !== "string" || !asset[key].trim()) throw new Error(tr("{0}资产缺少有效的 {1}", label, key));
        }
        return { name: (asset.name as string).trim(), description: (asset.description as string).trim(), prompt: (asset.prompt as string).trim() };
    });
    return {
        characters: payload.characters.length ? parseCharacterBreakdown(JSON.stringify({ characters: payload.characters })) : [],
        scenes: parseAssets(payload.scenes, tr("场景")),
        props: parseAssets(payload.props, tr("道具")),
    };
}
