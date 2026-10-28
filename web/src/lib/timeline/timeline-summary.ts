import { tr } from "@/i18n";
// 时间线确定性摘要：把 TimelineProject 压缩成稳定、可控长度的中文上下文，供 AI 编辑和诊断使用。
// 同一输入永远产出同一输出（无时间戳/无随机），供命令引用 id 与 AI 面板上下文注入。

import type { TimelineClip, TimelineProject, TimelineTrack } from "@/types/timeline";

/** 片段逐行列出的上限；超出后折叠为一行汇总，防止超长时间线撑爆模型上下文。 */
export const SUMMARY_MAX_CLIP_LINES = 60;
/** 标题/文本在摘要中的最大展示长度。 */
export const SUMMARY_MAX_TEXT_CHARS = 24;

const KIND_LABELS: Record<string, string> = {
    video: tr("视频"),
    audio: tr("音频"),
    subtitle: tr("字幕"),
    text: tr("文本"),
    image: tr("图片"),
};

export function formatMs(ms: number): string {
    const total = Math.max(0, Math.round(ms));
    const s = Math.floor(total / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
}

function clipLine(clip: TimelineClip): string {
    const label = (clip.title || clip.text || "").trim().slice(0, SUMMARY_MAX_TEXT_CHARS);
    const source = clip.directMedia?.title?.slice(0, SUMMARY_MAX_TEXT_CHARS) ?? "";
    const text = label || source || clip.nodeId.slice(0, 12);
    return tr("  - clip {0} | {1} | 轨道 {2} | {3}-{4}ms | {5}", clip.id, clip.kind, clip.trackId, clip.startMs, clip.startMs + clip.durationMs, text);
}

function trackLine(track: TimelineTrack): string {
    const flags = [
        track.visible === false ? tr("隐藏") : null,
        track.muted ? tr("静音") : null,
    ]
        .filter(Boolean)
        .join("/");
    return tr("  - {0} | {1}轨 | {2}{3}", track.id, KIND_LABELS[track.kind] ?? track.kind, track.label, flags ? ` | ${flags}` : "");
}

/** 生成中文时间线摘要（确定性、纯文本）。 */
export function summarizeTimeline(project: TimelineProject): string {
    const lines: string[] = [];
    const subtitleClips = project.clips.filter((c) => c.kind === "subtitle");
    const nodeIds = new Set(project.clips.map((c) => c.nodeId));
    const directCount = project.clips.filter((c) => c.directMedia).length;

    lines.push(tr("时间线：总时长 {0}，{1} 条轨道，{2} 个片段（字幕 {3}，直连素材 {4}，引用节点 {5} 个）。", formatMs(project.durationMs), project.tracks.length, project.clips.length, subtitleClips.length, directCount, nodeIds.size));
    lines.push(tr("轨道（顺序从上到下）："));
    for (const track of [...project.tracks].sort((a, b) => a.order - b.order)) {
        lines.push(trackLine(track));
    }
    lines.push(tr("片段："));
    if (project.clips.length === 0) {
        lines.push(tr("  （空时间线）"));
    } else {
        const shown = project.clips.slice(0, SUMMARY_MAX_CLIP_LINES);
        for (const clip of shown) {
            lines.push(clipLine(clip));
        }
        const hidden = project.clips.length - shown.length;
        if (hidden > 0) lines.push(tr("  …其余 {0} 个片段省略", hidden));
    }
    if (subtitleClips.length > 0) {
        const totalChars = subtitleClips.reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
        lines.push(tr("字幕共 {0} 字。", totalChars));
    }
    return lines.join("\n");
}
