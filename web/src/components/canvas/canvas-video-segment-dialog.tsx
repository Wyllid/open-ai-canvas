import { tr } from "@/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Segmented } from "antd";
import { AudioLines, Check, ListVideo, Plus, Scissors, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { buildTimelineImportSegments, type CanvasTimelineSegmentItem } from "@/lib/canvas/canvas-video-timeline-segments";
import { listVideoReferenceModels } from "@/lib/canvas/canvas-video-regeneration";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelRequestOptions, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resolveMediaUrl } from "@/services/file-storage";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { type CanvasConnection, type CanvasNodeData, type CanvasVideoEditOperation } from "@/types/canvas";
import type { TimelineProject } from "@/types/timeline";
import { Select } from "@/components/ui/base/select";

export type CanvasVideoSegmentItem = CanvasTimelineSegmentItem;

export type CanvasVideoSegmentParams = {
    mode: "audio" | "video";
    action?: "extract" | "create-generation-nodes";
    startMs: number;
    endMs: number;
    prompt?: string;
    segments?: CanvasVideoSegmentItem[];
    model?: string;
    operation?: CanvasVideoEditOperation;
};

type CanvasVideoSegmentDialogProps = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    open: boolean;
    mode: "audio" | "video";
    config: AiConfig;
    timeline?: TimelineProject | null;
    onClose: () => void;
    onConfirm: (params: CanvasVideoSegmentParams) => void;
};

const MIN_SEGMENT_MS = 100;

export function CanvasVideoSegmentDialog({ node, nodes, connections, open, mode, config, timeline, onClose, onConfirm }: CanvasVideoSegmentDialogProps) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const videoRef = useRef<HTMLVideoElement>(null);
    const segmentsSeededRef = useRef(false);
    const [videoUrl, setVideoUrl] = useState("");
    const [videoError, setVideoError] = useState(false);
    const [durationMs, setDurationMs] = useState(0);
    const [startSec, setStartSec] = useState(0);
    const [endSec, setEndSec] = useState(0);
    const [prompt, setPrompt] = useState("");
    const [segments, setSegments] = useState<CanvasVideoSegmentItem[]>([]);
    const [model, setModel] = useState("");
    const [operation, setOperation] = useState<CanvasVideoEditOperation>("extend");
    const [videoAction, setVideoAction] = useState<"extract" | "create-generation-nodes">("extract");
    const eligibleModels = useMemo(() => listVideoReferenceModels(config), [config]);

    // 打开弹窗时解析视频地址，读取时长并初始化起止时间。
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setVideoUrl("");
        setVideoError(false);
        setDurationMs(0);
        setStartSec(0);
        setEndSec(0);
        setPrompt("");
        setSegments([]);
        setVideoAction("extract");
        segmentsSeededRef.current = false;
        const defaultModel = config.videoModel || config.model || "";
        const initialModel = eligibleModels.includes(defaultModel) ? defaultModel : eligibleModels[0] || defaultModel;
        setModel(initialModel);
        const profile = initialModel ? modelCapabilityConfigFor(config, initialModel).video : undefined;
        setOperation(profile?.operations.includes("extend") ? "extend" : (profile?.operations[0] as CanvasVideoEditOperation | undefined) || "extend");
        const storageKey = node.metadata?.storageKey || "";
        const fallback = node.metadata?.content || "";
        void resolveMediaUrl(storageKey, fallback).then((url) => {
            if (!cancelled) setVideoUrl(url);
        });
        return () => {
            cancelled = true;
        };
    }, [config, eligibleModels, node, open]);

    // 视频模式等待时长元数据就绪后，默认放入一个完整时长的片段。
    useEffect(() => {
        if (!open || mode !== "video" || segmentsSeededRef.current || !durationMs) return;
        segmentsSeededRef.current = true;
        setSegments([{ id: nanoid(), startMs: 0, endMs: durationMs, sourceNodeId: node.id }]);
    }, [durationMs, mode, open]);

    const isVideoMode = mode === "video";
    const createsGenerationNodes = videoAction === "create-generation-nodes";
    const durationSec = durationMs > 0 ? durationMs / 1000 : 0;
    const hasTimelineVideoClips = Boolean(timeline?.clips.some((clip) => clip.kind === "video"));
    const hasPrompt = Boolean(prompt.trim());
    const modelRequirements = useMemo<ModelRequirements>(
        () => ({
            capability: "video",
            input: { textCount: createsGenerationNodes && hasPrompt ? 1 : 0, imageCount: 0, videoCount: createsGenerationNodes ? 1 : 0, audioCount: 0, characterCount: 0 },
            videoOperation: operation,
            videoSeconds: config.videoSeconds,
			options: modelRequestOptions(config, "video"),
        }),
        [config.videoSeconds, createsGenerationNodes, hasPrompt, operation],
    );
    const resolvedModel = resolveCompatibleModel(config, model, modelRequirements) || model;
    const videoProfile = useMemo(() => (resolvedModel ? modelCapabilityConfigFor(config, resolvedModel).video : undefined), [config, resolvedModel]);
    const defaultModel = config.videoModel || config.model || "";
    const defaultModelSupported = eligibleModels.includes(defaultModel);
    const hasEligibleModels = eligibleModels.length > 0;
    const firstEligibleModel = eligibleModels[0] || "";

    // 切换模型后保持所选模式仍然有效，优先回退到“视频续写”。
    useEffect(() => {
        if (!videoProfile?.operations.length || videoProfile.operations.includes(operation)) return;
        setOperation(videoProfile.operations.includes("extend") ? "extend" : (videoProfile.operations[0] as CanvasVideoEditOperation));
    }, [operation, videoProfile]);

    const operationOptions = (videoProfile?.operations || []).map((value) => {
        const operation = value as CanvasVideoEditOperation;
        return { value: operation, label: videoOperationLabel(operation) };
    });

    const rangeMs = useMemo(() => {
        const start = Math.max(0, Math.round((startSec || 0) * 1000));
        const end = durationMs > 0 ? Math.min(durationMs, Math.round((endSec || 0) * 1000)) : Math.round((endSec || 0) * 1000);
        return { startMs: start, endMs: Math.max(start, end) };
    }, [durationMs, endSec, startSec]);

    const addManualSegment = () => {
        const last = segments[segments.length - 1];
        const maxEndMs = durationMs || last?.endMs || 0;
        const startMs = last ? Math.min(maxEndMs, last.endMs) : 0;
        const endMs = Math.max(startMs + MIN_SEGMENT_MS, maxEndMs);
        setSegments((current) => [...current, { id: nanoid(), startMs, endMs, sourceNodeId: node.id }]);
    };

    const importTimelineSegments = () => {
        try {
            const result = buildTimelineImportSegments(node, nodes, connections, timeline, durationMs);
            if (!result.ok) {
                message.warning(result.error);
                return;
            }
            setSegments(result.segments);
            setPrompt((current) => current || tr("按时间线截取的 {0} 段视频，保持画面主体与镜头，重新生成每一段", result.segments.length));
            message.success(tr("已从时间线导入 {0} 个片段", result.segments.length));
        } catch (error) {
            console.warn("时间线片段导入失败", error);
            message.warning(tr("读取时间线片段失败，请刷新后重试"));
        }
    };

    const updateSegment = (id: string, patch: Partial<Pick<CanvasVideoSegmentItem, "startMs" | "endMs">>) => {
        setSegments((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    };

    const removeSegment = (id: string) => {
        setSegments((current) => current.filter((item) => item.id !== id));
    };

    const handleConfirm = () => {
        if (isVideoMode) {
            if (createsGenerationNodes && !model) {
                message.warning(tr("请选择视频模型"));
                return;
            }
            if (!segments.length) {
                message.warning(tr("请至少添加一个截取片段"));
                return;
            }
            for (const segment of segments) {
                if (segment.endMs - segment.startMs < MIN_SEGMENT_MS) {
                    message.warning(tr("片段时长至少 0.1 秒"));
                    return;
                }
            }
            onConfirm({
                mode: "video",
                action: videoAction,
                startMs: 0,
                endMs: 0,
                segments: segments.map(({ id, startMs, endMs, sourceNodeId, sourceStorageKey, sourceUrl }) => ({ id, startMs, endMs, sourceNodeId, sourceStorageKey, sourceUrl })),
                model: createsGenerationNodes ? resolvedModel : undefined,
                operation: createsGenerationNodes ? operation : undefined,
                prompt: createsGenerationNodes ? prompt.trim() : undefined,
            });
            return;
        }
        if (!durationMs) {
            message.warning(tr("视频时长未就绪，请稍候再试"));
            return;
        }
        if (rangeMs.endMs - rangeMs.startMs < MIN_SEGMENT_MS) {
            message.warning(tr("片段时长至少 0.1 秒"));
            return;
        }
        onConfirm({ mode: "audio", startMs: rangeMs.startMs, endMs: rangeMs.endMs });
    };

    const title = (
        <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                {isVideoMode ? <Scissors className="size-4" /> : <AudioLines className="size-4" />}
            </span>
            <div className="min-w-0">
                <div className="truncate font-semibold leading-6">{isVideoMode ? tr("截取视频片段") : tr("从视频提取声音")}</div>
                <div className="truncate text-xs opacity-45">{node.title || tr("视频节点")}</div>
            </div>
        </div>
    );

    return (
        <Modal title={title} open={open} onCancel={onClose} footer={null} width={680} centered destroyOnHidden>
            <div className="space-y-4">
                <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-xl border bg-black" style={{ borderColor: theme.toolbar.border }}>
                    {videoUrl ? (
                        <video
                            ref={videoRef}
                            src={videoUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="block max-h-[var(--video-segment-preview-max-height)] w-full"
                            onLoadedMetadata={(event) => {
                                const video = event.currentTarget;
                                if (Number.isFinite(video.duration) && video.duration > 0) {
                                    const totalMs = Math.round(video.duration * 1000);
                                    setDurationMs(totalMs);
                                    setEndSec(totalMs / 1000);
                                }
                            }}
                            onError={() => setVideoError(true)}
                        />
                    ) : (
                        <div className="grid h-40 w-full place-items-center text-xs opacity-60">{videoError ? tr("视频预览加载失败，请检查素材是否仍然可用") : tr("正在加载视频…")}</div>
                    )}
                </div>

                {isVideoMode ? (
                    <div className="space-y-2">
                        {createsGenerationNodes && !defaultModelSupported ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs" style={{ background: theme.accent.primarySoft + "1a", borderColor: theme.accent.primarySoft, color: theme.node.muted }}>
                                <span className="min-w-0 flex-1">
                                    {hasEligibleModels
                                        ? tr("当前默认模型{0}不支持参考视频，已自动切换到「{1}」。", defaultModel ? `「${modelDisplayName(config, defaultModel)}」` : "", modelDisplayName(config, firstEligibleModel))
                                        : tr("当前配置中没有支持参考视频的视频模型，请先到设置里配置 Seedance / Agent Plan / NewAPI 渠道。")}
                                </span>
                                {!hasEligibleModels ? (
                                    <Button size="small" type="primary" onClick={() => navigateToSettings({ section: "channels", continueCreation: true })}>
                                        {tr("去设置配置渠道")}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="opacity-60">{tr("时长")}</span>
                                <span>{durationSec ? formatSegmentTime(durationSec) : tr("未知")}</span>
                                <span className="opacity-60">{tr("已选")}</span>
                                <span>{tr("{0} 段", segments.length)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button size="small" icon={<Plus className="size-3.5" />} disabled={!durationSec} onClick={addManualSegment}>
                                    {tr("添加片段")}
                                </Button>
                                <Button size="small" icon={<ListVideo className="size-3.5" />} disabled={!hasTimelineVideoClips} onClick={importTimelineSegments}>
                                    {tr("从时间线导入")}
                                </Button>
                            </div>
                        </div>

                        {segments.length ? (
                            <div className="thin-scrollbar max-h-56 space-y-2 overflow-y-auto pr-1">
                                {segments.map((segment, index) => (
                                    <div key={segment.id} className="rounded-lg border px-2 py-2" style={{ borderColor: theme.toolbar.border }}>
                                        <div className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
                                            <span className="w-14 shrink-0 text-xs font-medium">{tr("片段")} {index + 1}</span>
                                            <div className="flex min-w-0 items-center gap-1">
                                                <span className="shrink-0 text-xs opacity-60">{tr("起点")}</span>
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    max={Math.max(0, durationSec - 0.1)}
                                                    step={0.1}
                                                    value={segment.startMs / 1000}
                                                    onChange={(value) => updateSegment(segment.id, { startMs: Math.round((value ?? 0) * 1000) })}
                                                    className="w-full"
                                                    aria-label={tr("片段 {0} 起点（秒）", index + 1)}
                                                />
                                            </div>
                                            <div className="flex min-w-0 items-center gap-1">
                                                <span className="shrink-0 text-xs opacity-60">{tr("终点")}</span>
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    max={Math.max(0, durationSec)}
                                                    step={0.1}
                                                    value={segment.endMs / 1000}
                                                    onChange={(value) => updateSegment(segment.id, { endMs: Math.round((value ?? 0) * 1000) })}
                                                    className="w-full"
                                                    aria-label={tr("片段 {0} 终点（秒）", index + 1)}
                                                />
                                            </div>
                                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} aria-label={tr("删除片段 {0}", index + 1)} onClick={() => removeSegment(segment.id)} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed px-3 py-3 text-xs opacity-55" style={{ borderColor: theme.toolbar.border }}>
                                {tr("还没有片段：手动添加起点/终点，或从时间线导入该节点的已有片段。")}
                            </div>
                        )}

                        <div className="rounded-xl px-3 py-2" style={{ background: theme.toolbar.itemHover }}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-medium">{tr("截取后")}</div>
                                    <div className="mt-0.5 text-xs opacity-45">{tr("默认只创建片段，生成由你稍后决定。")}</div>
                                </div>
                                <Segmented size="small" value={videoAction} options={[{ label: tr("仅创建片段"), value: "extract" }, { label: tr("创建生成节点"), value: "create-generation-nodes" }]} onChange={(value) => setVideoAction(value as "extract" | "create-generation-nodes")} />
                            </div>
                        </div>

                        {createsGenerationNodes ? (
                            <>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <label className="block min-w-0">
                                        <div className="mb-2 text-sm font-medium">{tr("生成节点模型")}</div>
                                        <ModelPicker config={config} value={resolvedModel} onChange={setModel} capability="video" requirements={modelRequirements} fullWidth onMissingConfig={() => message.warning(tr("请先配置支持参考视频的视频模型"))} />
                                    </label>
                                    <label className="block min-w-0">
                                        <div className="mb-2 text-sm font-medium">{tr("生成模式")}</div>
                                        <Select className="w-full" size="small" value={operation} options={operationOptions} placeholder={tr("选择生成模式")} onChange={(value) => setOperation(value as CanvasVideoEditOperation)} />
                                    </label>
                                </div>

                                <label className="block">
                                    <div className="mb-2 text-sm font-medium">{tr("生成提示词")}</div>
                                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} value={prompt} placeholder={tr("描述后续要生成的视频内容…")} onChange={(event) => setPrompt(event.target.value)} />
                                    <div className="mt-1 text-xs opacity-45">{tr("每个片段会连接一个待生成视频节点，但不会自动提交任务。你可以继续调整参考素材、模型和提示词。")}</div>
                                </label>
                            </>
                        ) : (
                            <div className="text-xs opacity-45">{tr("片段将作为独立视频节点创建并保持选中，不需要配置视频模型。")}</div>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: theme.toolbar.border }}>
                        <div className="flex items-center gap-2">
                            <span className="opacity-60">{tr("时长")}</span>
                            <span>{durationSec ? formatSegmentTime(durationSec) : tr("未知")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="opacity-60">{tr("起点")}</span>
                            <InputNumber size="small" min={0} max={Math.max(0, durationSec - 0.1)} step={0.1} value={startSec} onChange={(value) => setStartSec(value ?? 0)} className="w-28" aria-label={tr("片段起点（秒）")} />
                            <Button
                                size="small"
                                type="text"
                                icon={<SkipBack className="size-3.5" />}
                                aria-label={tr("跳转到起点")}
                                onClick={() => {
                                    if (videoRef.current) videoRef.current.currentTime = startSec;
                                }}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="opacity-60">{tr("终点")}</span>
                            <InputNumber size="small" min={0} max={Math.max(0, durationSec)} step={0.1} value={endSec} onChange={(value) => setEndSec(value ?? 0)} className="w-28" aria-label={tr("片段终点（秒）")} />
                            <Button
                                size="small"
                                type="text"
                                icon={<SkipForward className="size-3.5" />}
                                aria-label={tr("跳转到终点")}
                                onClick={() => {
                                    if (videoRef.current) videoRef.current.currentTime = endSec;
                                }}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="opacity-60">{tr("片段")}</span>
                            <span>{formatSegmentTime((rangeMs.endMs - rangeMs.startMs) / 1000)}</span>
                        </div>
                        <Button
                            size="small"
                            disabled={!durationSec}
                            onClick={() => {
                                setStartSec(0);
                                setEndSec(durationSec);
                            }}
                        >
                            {tr("使用全部")}
                        </Button>
                        <div className="w-full text-xs opacity-45">{tr("提取的 MP3 会保存到素材库，并生成一个音频节点放在当前视频节点下游。")}</div>
                    </div>
                )}

                <div className="flex items-center justify-end gap-2">
                    <Button onClick={onClose}>{tr("取消")}</Button>
                    <Button type="primary" icon={<Check className="size-4" />} disabled={isVideoMode ? !segments.length : !durationSec} onClick={handleConfirm}>
                        {isVideoMode ? (createsGenerationNodes ? tr("截取 {0} 段并创建生成节点", segments.length) : tr("截取 {0} 段", segments.length)) : tr("提取音频")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function videoOperationLabel(operation: CanvasVideoEditOperation) {
    const labels: Record<CanvasVideoEditOperation, string> = {
        text_to_video: tr("文生视频"),
        image_to_video: tr("图生视频"),
        reference_to_video: tr("全模态参考"),
        extend: tr("视频续写"),
        inpaint: tr("局部修改"),
        replace_element: tr("元素替换"),
        camera_motion: tr("运镜调整"),
        style_transfer: tr("风格迁移"),
        audio_to_video: tr("音频生视频"),
        compare_versions: tr("版本对比"),
        concat: tr("拼接成片"),
        enhance: tr("画质增强"),
    };
    return labels[operation] || operation;
}

function formatSegmentTime(seconds: number) {
    const total = Math.max(0, seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rawSeconds = total % 60;
    const secs = rawSeconds % 1 === 0 ? String(Math.floor(rawSeconds)).padStart(2, "0") : rawSeconds.toFixed(1).padStart(4, "0");
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}
