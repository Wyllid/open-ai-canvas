import { tr } from "@/i18n";
import type { CSSProperties } from "react";
import { AlertCircle, ImageUp, FileText, Film, Music2 } from "lucide-react";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { uploadPreviewBlur, uploadVeilOpacity } from "@/lib/canvas/canvas-file-upload";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { uploadPreviewUrl } from "@/services/canvas-upload-preview";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import "./canvas-file-upload.css";

export function CanvasFileUploadContent({ node, theme, reduceMotion = false }: { node: CanvasNodeData; theme: CanvasTheme; reduceMotion?: boolean }) {
    const { upload } = useCanvasNodeActions();
    const failed = node.metadata?.fileUpload === "error";
    const percent = node.metadata?.fileUploadProgress;
    const saving = !failed && percent === 100;
    const label = node.type === CanvasNodeType.Image ? tr("图片") : node.type === CanvasNodeType.Video ? tr("视频") : node.type === CanvasNodeType.Audio ? tr("音频") : tr("文本");
    const Icon = failed ? AlertCircle : node.type === CanvasNodeType.Video ? Film : node.type === CanvasNodeType.Audio ? Music2 : node.type === CanvasNodeType.Text ? FileText : ImageUp;
    const previewUrl = failed ? "" : uploadPreviewUrl(node.id);
    const detail = failed ? node.metadata?.errorDetails || tr("请重新选择文件上传") : saving ? tr("文件已传输，正在保存与处理") : percent !== undefined ? tr("已上传 {0}%", percent) : tr("正在准备文件");
    const style = { "--upload-surface": theme.node.fill, "--upload-text": theme.node.text, "--upload-muted": theme.node.muted } as CSSProperties;
    const progressbar = !failed ? <span role="progressbar" aria-label={tr("{0}上传进度", label)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={detail} className="sr-only" /> : null;

    if (previewUrl) {
        // 有本地预览时不再叠加任何卡片：整张画面从磨砂逐渐变清晰，进度只用角落的小标签表达。
        const { blur, scale } = uploadPreviewBlur(percent);
        const saturate = 0.8 + 0.2 * ((percent ?? 0) / 100);
        const previewStyle = { filter: `blur(${blur.toFixed(1)}px) saturate(${saturate.toFixed(2)})`, transform: `scale(${scale.toFixed(3)})` };
        return (
            <div className="canvas-file-upload" data-preview="true" data-state={saving ? "saving" : "uploading"} data-static={reduceMotion || undefined} style={style}>
                {node.type === CanvasNodeType.Video ? (
                    <video className="canvas-file-upload-preview" style={previewStyle} src={previewUrl} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
                ) : (
                    <img className="canvas-file-upload-preview" style={previewStyle} src={previewUrl} alt="" aria-hidden="true" decoding="async" draggable={false} />
                )}
                <div className="canvas-file-upload-frost" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
                <span className="canvas-file-upload-chip" aria-hidden="true">
                    <span className="canvas-file-upload-chip-dot" />
                    {saving ? tr("处理中") : percent !== undefined ? `${percent}%` : tr("准备中")}
                </span>
                <span className="sr-only" role="status" aria-live="polite" aria-busy="true">{tr("正在上传{0}，{1}", label, detail)}</span>
                {progressbar}
            </div>
        );
    }

    return (
        <div className="canvas-file-upload" data-state={failed ? "error" : saving ? "saving" : "uploading"} data-static={reduceMotion || failed || undefined} style={style}>
            <div className="canvas-file-upload-glow" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
            <div className="canvas-file-upload-frost" aria-hidden="true" style={{ opacity: uploadVeilOpacity(percent) }} />
            <div className="canvas-file-upload-copy" role="status" aria-live="polite" aria-busy={!failed}>
                <Icon className="size-5" aria-hidden="true" />
                <span className="canvas-file-upload-label">{failed ? tr("{0}上传未完成", label) : tr("正在上传{0}", label)}</span>
                <span className="canvas-file-upload-detail">{detail}</span>
                {progressbar}
                {failed && upload ? <button type="button" data-canvas-no-zoom className="canvas-file-upload-retry" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); upload(node); }}>{tr("重新选择文件")}</button> : null}
            </div>
        </div>
    );
}
