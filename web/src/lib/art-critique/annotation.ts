import { tr } from "@/i18n";
import type { ArtCritiqueIssue, ArtCritiquePoint, ArtCritiqueTarget } from "./contracts";

export const ART_CRITIQUE_CATEGORY_COLORS = {
    composition: "#f97316",
    color: "#a855f7",
    lighting: "#eab308",
    proportion: "#06b6d4",
    other: "#ef4444",
} as const;

export const ART_CRITIQUE_SEVERITY_COLORS = {
    high: "#ef4444",
    medium: "#f59e0b",
    low: "#22c55e",
} as const;

export type ArtCritiqueBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ArtCritiqueLabelPlacement = {
    x: number;
    y: number;
};

/**
 * 小于这个跨度的框通常不是可读的目标框，而是模型把两个点放到了同一条线上。
 * 这是显示层的最低约束，避免错误数据变成一条横线或竖线。
 */
export const MIN_ART_CRITIQUE_BOX_SPAN = 0.025;

export function targetPolygon(target: ArtCritiqueTarget): ArtCritiquePoint[] {
    if (target.type === "global") return [];
    if (target.type === "points") return target.points;
    if (target.type === "box" && target.points.length >= 2) {
        const left = Math.min(target.points[0].x, target.points[1].x);
        const right = Math.max(target.points[0].x, target.points[1].x);
        const top = Math.min(target.points[0].y, target.points[1].y);
        const bottom = Math.max(target.points[0].y, target.points[1].y);
        return [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
        ];
    }
    return target.points;
}

export function targetBounds(target: ArtCritiqueTarget): ArtCritiqueBounds {
    const points = targetPolygon(target);
    if (!points.length) return { x: 0.04, y: 0.04, width: 0.92, height: 0.92 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
        x,
        y,
        width: Math.max(0.015, Math.max(...xs) - x),
        height: Math.max(0.015, Math.max(...ys) - y),
    };
}

export function isRenderableArtCritiqueTarget(target: ArtCritiqueTarget) {
    if (target.type === "global") return true;
    if (!target.points.length || target.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
    if (target.type === "point" || target.type === "points") return true;
    if (target.type === "box") {
        if (target.points.length < 2) return false;
        const [first, second] = target.points;
        return Math.abs(first.x - second.x) >= MIN_ART_CRITIQUE_BOX_SPAN && Math.abs(first.y - second.y) >= MIN_ART_CRITIQUE_BOX_SPAN;
    }
    if (target.type === "polygon") return polygonArea(target.points) >= MIN_ART_CRITIQUE_BOX_SPAN * MIN_ART_CRITIQUE_BOX_SPAN;
    return false;
}

/**
 * 对历史报告和模型返回的异常目标做显示层修复。
 * 这不会改写节点状态，但能保证旧报告重新打开时也不会出现零高度标注。
 */
export function repairIssueTarget(issue: ArtCritiqueIssue): ArtCritiqueIssue {
    if (isRenderableArtCritiqueTarget(issue.target)) return issue;
    const target = referenceTargetForIssue(issue);
    return {
        ...issue,
        target,
        targetSource: target.type === "global" ? "global" : "reference",
    };
}

type ArtCritiqueReferenceInput = Pick<ArtCritiqueIssue, "category" | "title" | "explanation" | "targetDescription">;

/**
 * Grounding 服务不可用时的保守兜底。
 *
 * 这里不是目标检测，而是把报告里的自然语言位置描述映射到一组固定的原图参考区域，
 * 让用户可以先知道“问题大概落在哪一带”。没有明确位置线索时仍返回 global。
 */
export function referenceTargetForIssue(issue: ArtCritiqueReferenceInput): ArtCritiqueTarget {
    const text = [issue.targetDescription, issue.title, issue.explanation].filter(Boolean).join(" ").toLowerCase();
    if (!text || matches(text, [tr("整体"), tr("全局"), tr("全图"), tr("总体"), "overall", "global", "whole image"])) return globalTarget();

    const left = matches(text, [tr("左侧"), tr("左边"), tr("左方"), tr("左上"), tr("左下"), "left"]);
    const right = matches(text, [tr("右侧"), tr("右边"), tr("右方"), tr("右上"), tr("右下"), "right"]);
    const top = matches(text, [tr("上方"), tr("顶部"), tr("上部"), tr("上半"), tr("天空"), "top", "upper"]);
    const bottom = matches(text, [tr("下方"), tr("底部"), tr("下部"), tr("下半"), tr("地面"), "bottom", "lower"]);
    const foreground = matches(text, [tr("前景"), tr("近景"), "foreground"]);
    const table = matches(text, [tr("桌"), tr("台面"), tr("台子"), tr("桌腿"), "table", "desk"]);
    const subject = matches(text, [tr("人物"), tr("少女"), tr("男孩"), tr("女孩"), tr("脸"), tr("面部"), tr("主体"), tr("人像"), tr("产品"), tr("物体"), "subject", "person", "face", "portrait"]);
    const head = matches(text, [tr("头部"), tr("发丝"), tr("发际"), "head", "hair"]);
    const scattered = matches(text, [tr("多处"), tr("多个"), tr("多块"), tr("散落"), tr("分散"), tr("亮点"), tr("光点"), tr("色块"), tr("高饱和"), tr("暖色"), tr("反光"), "highlight", "hotspot", "specular"]);

    if (table) {
        if (left && !right) return referenceBox(0.08, 0.53, 0.38, 0.38);
        if (right && !left) return referenceBox(0.54, 0.53, 0.38, 0.38);
        return referenceBox(0.16, 0.5, 0.68, 0.44);
    }

    if (foreground) {
        if (left && !right) return referenceBox(0.04, 0.05, 0.36, 0.9);
        if (right && !left) return referenceBox(0.6, 0.05, 0.36, 0.9);
        return referenceBox(0.16, 0.54, 0.68, 0.4);
    }

    const headClearance = head && matches(text, [tr("留白"), tr("拥挤"), tr("切线"), tr("贴近"), tr("轮廓"), tr("装饰"), "clearance"]);
    if (headClearance) {
        if (left && !right) return referenceBox(0.08, 0.08, 0.34, 0.34);
        if (right && !left) return referenceBox(0.58, 0.08, 0.34, 0.34);
        return referenceBox(0.34, 0.06, 0.42, 0.36);
    }

    if (scattered) return referencePoints({ left, right, top, bottom });

    if (head) {
        if (left && !right) return referenceBox(0.08, 0.08, 0.34, 0.34);
        if (right && !left) return referenceBox(0.58, 0.08, 0.34, 0.34);
        return referenceBox(0.34, 0.06, 0.42, 0.36);
    }

    if (subject) {
        if (left && top) return referenceBox(0.06, 0.06, 0.34, 0.34);
        if (right && top) return referenceBox(0.6, 0.06, 0.34, 0.34);
        if (left && bottom) return referenceBox(0.06, 0.6, 0.34, 0.34);
        if (right && bottom) return referenceBox(0.6, 0.6, 0.34, 0.34);
        if (left && !right) return referenceBox(0.06, 0.16, 0.34, 0.68);
        if (right && !left) return referenceBox(0.6, 0.16, 0.34, 0.68);
        if (top && !bottom) return referenceBox(0.24, 0.06, 0.52, 0.34);
        if (bottom && !top) return referenceBox(0.24, 0.6, 0.52, 0.34);
        return referenceBox(0.24, 0.16, 0.52, 0.68);
    }

    if (left && top) return referenceBox(0.06, 0.06, 0.34, 0.34);
    if (right && top) return referenceBox(0.6, 0.06, 0.34, 0.34);
    if (left && bottom) return referenceBox(0.06, 0.6, 0.34, 0.34);
    if (right && bottom) return referenceBox(0.6, 0.6, 0.34, 0.34);
    if (left && !right) return referenceBox(0.06, 0.2, 0.34, 0.6);
    if (right && !left) return referenceBox(0.6, 0.2, 0.34, 0.6);
    if (top && !bottom) return referenceBox(0.24, 0.06, 0.52, 0.34);
    if (bottom && !top) return referenceBox(0.24, 0.6, 0.52, 0.34);
    return globalTarget();
}

/**
 * 给标注标题分配稳定的起点。它不是精确排版引擎，但能处理最常见的上下重叠，
 * 并且始终把标题留在 SVG 视口内。
 */
export function layoutArtCritiqueLabels(issues: readonly ArtCritiqueIssue[]): ArtCritiqueLabelPlacement[] {
    const placements: ArtCritiqueLabelPlacement[] = [];
    issues.forEach((issue, index) => {
        const bounds = targetBounds(issue.target);
        const preferred = {
            // The label is a compact pill, so place its center just inside the
            // target's top-left corner instead of putting another marker on the image.
            x: clamp(bounds.x + 0.035, 0.04, 0.96),
            y: clamp(bounds.y + 0.035, 0.04, 0.96),
        };
        let next = preferred;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const collides = placements.some((placed) => Math.abs(placed.x - next.x) < 0.095 && Math.abs(placed.y - next.y) < 0.07);
            if (!collides) break;
            next = { x: preferred.x, y: clamp(preferred.y + (attempt + 1) * 0.07, 0.04, 0.96) };
        }
        placements[index] = next;
    });
    return placements;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function polygonArea(points: ArtCritiquePoint[]) {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
}

function referenceBox(x: number, y: number, width: number, height: number): ArtCritiqueTarget {
    return {
        type: "box",
        points: [
            { x, y },
            { x: x + width, y: y + height },
        ],
    };
}

function referencePoints({ left, right, top, bottom }: { left: boolean; right: boolean; top: boolean; bottom: boolean }): ArtCritiqueTarget {
    if (left && top) return { type: "points", points: [{ x: 0.18, y: 0.18 }, { x: 0.26, y: 0.3 }] };
    if (right && top) return { type: "points", points: [{ x: 0.74, y: 0.18 }, { x: 0.82, y: 0.3 }] };
    if (left && bottom) return { type: "points", points: [{ x: 0.18, y: 0.7 }, { x: 0.26, y: 0.82 }] };
    if (right && bottom) return { type: "points", points: [{ x: 0.74, y: 0.7 }, { x: 0.82, y: 0.82 }] };
    if (left && !right) return { type: "points", points: [{ x: 0.18, y: 0.25 }, { x: 0.2, y: 0.66 }] };
    if (right && !left) return { type: "points", points: [{ x: 0.76, y: 0.25 }, { x: 0.8, y: 0.66 }] };
    if (top && !bottom) return { type: "points", points: [{ x: 0.28, y: 0.18 }, { x: 0.72, y: 0.18 }] };
    if (bottom && !top) return { type: "points", points: [{ x: 0.28, y: 0.72 }, { x: 0.72, y: 0.72 }] };
    return { type: "points", points: [{ x: 0.26, y: 0.2 }, { x: 0.74, y: 0.2 }, { x: 0.52, y: 0.68 }] };
}

function globalTarget(): ArtCritiqueTarget {
    return { type: "global", points: [] };
}

function matches(text: string, values: string[]) {
    return values.some((value) => text.includes(value));
}
