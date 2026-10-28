import { tr } from "@/i18n";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, InputNumber, Select } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { ArrowUp, ChevronLeft, ChevronRight, Copy, Loader2, Play, RotateCcw, Sparkles, X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { TRANSITION_LABEL } from "@/lib/drama/storyboard";
import type { DramaCast, DramaEpisodeDetail, DramaModelChoice, DramaSegment, DramaShot, DramaShotPatch, DramaTake, DramaTransition } from "@/services/api/drama";
import { dramaChoiceKey } from "@/lib/drama/model-choice";

import { DramaModelPicker } from "../drama-model-picker";

import { CAST_KIND_LABEL, mediaBusy, MediaThumb } from "../drama-shared";
import { SegmentTakes, type TakeReviewInput } from "./segment-takes";
import { promptReady, referenceMissingReason, secondsLabel, SegmentInputs, SegmentStatus, SegmentVideo, videoWaitLabel } from "./segment-parts";

const SHOT_SIZES = [tr("特写"), tr("近景"), tr("中景"), tr("全景"), tr("远景")];
const CAMERAS = [tr("固定"), tr("推"), tr("拉"), tr("摇"), tr("跟"), tr("环绕"), tr("升降"), tr("手持")];

const PROMPT_NOTICE: Record<DramaSegment["promptStatus"], string> = {
    none: "还没有撰写本段视频提示词",
    queued: "排队撰写中…",
    running: "正在撰写本段视频提示词…",
    ready: "",
    stale: "本段镜头或设定改过，提示词已过期，请重新撰写",
    failed: "撰写失败",
};

type Props = {
    detail?: DramaEpisodeDetail;
    segmentIndex?: number;
    shotId?: string;
    castById: Map<string, DramaCast>;
    aspectRatio: string;
    busy: boolean;
    writing: boolean;
    onClose: () => void;
    onNavigate: (segmentIndex: number, shotId?: string) => void;
    onPatchShot: (shot: DramaShot, patch: DramaShotPatch) => void;
    onSavePrompt: (segment: DramaSegment, override: string) => void;
    /** 指定本段参考图；null 恢复按镜头自动取。 */
    onSaveReferences: (segment: DramaSegment, castIds: string[] | null) => void;
    onWritePrompt: (segment: DramaSegment) => void;
    onGenerate: (segment: DramaSegment, model?: DramaModelChoice) => void;
    reprocessing: boolean;
    onReprocess: (segment: DramaSegment) => void;
    onSelectTake: (take: DramaTake) => void;
    onReviewTake: (take: DramaTake, review: TakeReviewInput) => void;
    defaultVideoModel: DramaModelChoice;
    onOpenCast: (castId: string) => void;
};

/**
 * 剧情段弹窗：左侧是段视频、生成依据（首帧与参考图）和段内镜头脚本，右侧是本段完整视频提示词。
 * 提示词区展示的就是提交时发送的全文：开头的参考图对应说明由系统追加，正文可直接修改。
 */
export function SegmentDialog({
    detail,
    segmentIndex,
    shotId,
    castById,
    aspectRatio,
    busy,
    writing,
    reprocessing,
    defaultVideoModel,
    onClose,
    onNavigate,
    onPatchShot,
    onSavePrompt,
    onSaveReferences,
    onWritePrompt,
    onGenerate,
    onReprocess,
    onSelectTake,
    onReviewTake,
    onOpenCast,
}: Props) {
    const segments = detail?.segments || [];
    const position = segments.findIndex((item) => item.index === segmentIndex);
    const segment = position >= 0 ? segments[position] : undefined;
    const shots = segment ? (detail?.shots || []).filter((shot) => shot.segmentIndex === segment.index) : [];
    const shot = shots.find((item) => item.id === shotId);
    return (
        <AppModal
            open={Boolean(segment)}
            onCancel={onClose}
            footer={null}
            title={null}
            closable={false}
            flush
            centered
            width="min(1280px, calc(100vw - 48px))"
            rootClassName="drama-root drama-sd-root"
            aria-label={segment ? tr("第 {0} 段", segment.index + 1) : tr("剧情段")}
        >
            {segment && detail ? (
                <div className="drama-sd">
                    <header className="drama-sd-head">
                        <div className="min-w-0">
                            <div className="drama-eyebrow">{tr("第 {0} 集 · 第 {1} / {2} 段 · {3} 镜 · {4}", detail.episode.number, segment.index + 1, segments.length, shots.length, secondsLabel(segment.durationMs))}</div>
                            <div className="drama-sd-title">
                                <h2>{segment.title}</h2>
                                <SegmentStatus segment={segment} />
                            </div>
                        </div>
                        <div className="drama-sd-nav">
                            <Tooltip title={tr("上一段")}>
                                <Button icon={<ChevronLeft className="size-4" />} aria-label={tr("上一段")} disabled={position <= 0} onClick={() => onNavigate(segments[position - 1].index)} />
                            </Tooltip>
                            <Tooltip title={tr("下一段")}>
                                <Button icon={<ChevronRight className="size-4" />} aria-label={tr("下一段")} disabled={position >= segments.length - 1} onClick={() => onNavigate(segments[position + 1].index)} />
                            </Tooltip>
                            <Button type="text" icon={<X className="size-4" />} aria-label={tr("关闭")} onClick={onClose} />
                        </div>
                    </header>
                    <div className="drama-sd-body">
                        <aside className="drama-sd-side thin-scrollbar">
                            <SegmentVideo segment={segment} aspectRatio={aspectRatio} />
                            {segment.videoStatus === "failed" && segment.videoError ? (
                                <div className="drama-sd-error">
                                    <strong>{segment.videoReprocessable ? tr("视频已生成，后处理失败") : tr("视频生成失败")}</strong>
                                    <span>{segment.videoError}</span>
                                    {segment.videoReprocessable ? (
                                        <>
                                            <span>{tr("重新处理只针对这条已生成的视频，不会重新生成或扣费。")}</span>
                                            <div className="drama-sd-error-actions">
                                                <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={reprocessing} disabled={busy} onClick={() => onReprocess(segment)}>
                                                    {tr("重新处理视频")}
                                                </Button>
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            ) : null}
                            {segment.videoStatus === "queued" && segment.videoWait ? (
                                <div className="drama-sd-error is-wait" role="status">
                                    <strong>{tr("视频尚未提交")}</strong>
                                    <span>{segment.videoWait}</span>
                                </div>
                            ) : null}
                            <SegmentTakes key={`takes-${segment.id}`} segment={segment} aspectRatio={aspectRatio} busy={busy} onSelect={onSelectTake} onReview={onReviewTake} />
                            <SegmentGenerate key={segment.id} segment={segment} busy={busy} defaultVideoModel={defaultVideoModel} onGenerate={(model) => onGenerate(segment, model)} />
                            <section className="drama-sd-block">
                                <div className="drama-sd-label">
                                    <span>{tr("生成依据")}</span>
                                    <small>
                                        {segment.request.seconds ? tr("生成 {0} 秒", segment.request.seconds) : ""}
                                        {segment.videoModel?.label ? ` · ${segment.videoModel.label}` : ""}
                                    </small>
                                </div>
                                <SegmentInputs segment={segment} castById={castById} onOpenCast={onOpenCast} frameOnly />
                                <ReferenceEditor segment={segment} castById={castById} busy={busy} onChange={(ids) => onSaveReferences(segment, ids)} onOpenCast={onOpenCast} />
                                {segment.request.warning ? <p className="drama-sg-note is-warn">{segment.request.warning}</p> : null}
                            </section>
                            <section className="drama-sd-block">
                                <div className="drama-sd-label">
                                    <span>{tr("本段镜头")}</span>
                                    <small>{tr("改动后本段提示词与视频需要重新生成")}</small>
                                </div>
                                <div className="drama-sd-shots">
                                    {shots.map((item) => (
                                        <button key={item.id} type="button" className="drama-sd-shot" aria-pressed={item.id === shot?.id} onClick={() => onNavigate(segment.index, item.id === shot?.id ? undefined : item.id)}>
                                            <b>{item.position + 1}</b>
                                            <span>{item.dialogue ? `${item.speaker || tr("旁白")}：${item.dialogue}` : item.action || item.imagePrompt}</span>
                                            <em>{secondsLabel(item.durationMs)}</em>
                                        </button>
                                    ))}
                                </div>
                                {shot ? <ShotEditor key={shot.id} shot={shot} onPatch={(patch) => onPatchShot(shot, patch)} /> : null}
                            </section>
                        </aside>
                        <section className="drama-sd-main" aria-label={tr("完整视频提示词")}>
                            <SegmentPrompt segment={segment} writing={writing} onSave={(override) => onSavePrompt(segment, override)} onWrite={() => onWritePrompt(segment)} />
                        </section>
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

const CAST_KIND_ORDER: DramaCast["kind"][] = ["character", "prop", "scene"];

function moveItem(ids: string[], from: number, to: number) {
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

/**
 * 本段参考图：默认按镜头自动取（角色、道具、场景依次编号），可以增删、调整顺序；排在前面的优先随请求发送。
 * 改动后参考图编号变化，模型撰写的提示词标记过期，需要重新撰写。
 */
function ReferenceEditor({ segment, castById, busy, onChange, onOpenCast }: { segment: DramaSegment; castById: Map<string, DramaCast>; busy: boolean; onChange: (ids: string[] | null) => void; onOpenCast: (id: string) => void }) {
    const { request } = segment;
    const ids = request.references.map((ref) => ref.castId);
    const sent = request.references.filter((ref) => ref.sent).length;
    const custom = segment.referenceMode === "custom";
    const options = useMemo(() => {
        const used = new Set(request.references.map((ref) => ref.castId));
        return CAST_KIND_ORDER.map((kind) => ({
            label: CAST_KIND_LABEL[kind],
            options: [...castById.values()].filter((cast) => cast.kind === kind && !used.has(cast.id)).map((cast) => ({ value: cast.id, label: cast.imageStatus === "ready" && cast.imageResourceId ? cast.name : tr("{0}（暂无参考图）", cast.name) })),
        })).filter((group) => group.options.length);
    }, [castById, request.references]);
    return (
        <div className="drama-ref-editor">
            <div className="drama-ref-editor-head">
                <b>{custom ? tr("手动指定参考图") : tr("按镜头自动取参考图")}</b>
                <small>
                    {tr("发送")} {sent}/{tr("{0} 张 · 本段最多 {1} 张", request.references.length, request.referenceCapacity)}
                    {request.modelMaxImages ? tr(" · 模型上限 {0} 张（含首帧）", request.modelMaxImages) : ""}
                </small>
                {custom ? (
                    <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} disabled={busy} onClick={() => onChange(null)}>
                        {tr("恢复自动")}
                    </Button>
                ) : null}
            </div>
            {request.references.length ? (
                <ol className="drama-ref-list">
                    {request.references.map((ref, index) => {
                        const cast = castById.get(ref.castId);
                        return (
                            <li key={ref.castId} className={ref.sent ? "" : "is-missing"}>
                                <button type="button" className="drama-ref-thumb" aria-label={tr("查看{0}设定", ref.name)} onClick={() => onOpenCast(ref.castId)}>
                                    {cast?.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt={ref.name} /> : <span>{CAST_KIND_LABEL[ref.kind]}</span>}
                                </button>
                                <span className="drama-ref-text">
                                    <b>
                                        {ref.label} · {ref.name}
                                    </b>
                                    <small>
                                        {CAST_KIND_LABEL[ref.kind]} · {ref.sent ? tr("随请求发送") : tr("未附图：{0}", referenceMissingReason(segment, cast))}
                                    </small>
                                </span>
                                <Tooltip title={tr("提前（优先发送）")}>
                                    <Button size="small" type="text" icon={<ArrowUp className="size-3.5" />} aria-label={tr("提前{0}", ref.name)} disabled={busy || index === 0} onClick={() => onChange(moveItem(ids, index, index - 1))} />
                                </Tooltip>
                                <Tooltip title={tr("不作为本段参考图")}>
                                    <Button size="small" type="text" icon={<X className="size-3.5" />} aria-label={tr("移除{0}", ref.name)} disabled={busy} onClick={() => onChange(ids.filter((id) => id !== ref.castId))} />
                                </Tooltip>
                            </li>
                        );
                    })}
                </ol>
            ) : (
                <p className="drama-sg-note">{tr("本段不发送参考图，按文字设定生成。")}</p>
            )}
            <Select
                className="w-full"
                size="small"
                showSearch
                value={null}
                placeholder={tr("添加参考图：角色、道具或场景")}
                optionFilterProp="label"
                options={options}
                disabled={busy || !options.length}
                aria-label={tr("添加参考图")}
                onChange={(id: string | null) => {
                    if (id) onChange([...ids, id]);
                }}
            />
            <p className="drama-sg-note">{tr("调整后参考图编号会变，模型撰写的视频提示词需要重新撰写；手写的提示词请自行核对编号。")}</p>
        </div>
    );
}

/** 本段视频模型与生成：换模型只对本段生效，与全剧默认相同时不写段级覆盖。 */
function SegmentGenerate({ segment, busy, defaultVideoModel, onGenerate }: { segment: DramaSegment; busy: boolean; defaultVideoModel: DramaModelChoice; onGenerate: (model?: DramaModelChoice) => void }) {
    const baseline = segment.videoModel?.logicalModelId || segment.videoModel?.modelKey ? segment.videoModel : defaultVideoModel;
    const [choice, setChoice] = useState<DramaModelChoice>(baseline);
    const changed = dramaChoiceKey(choice) !== dramaChoiceKey(baseline);
    const running = mediaBusy(segment.videoStatus);
    return (
        <div className="drama-sd-generate">
            <DramaModelPicker capability="video" size="sm" value={choice} onChange={setChoice} placeholder={tr("视频模型")} />
            <Button type="primary" icon={<Play className="size-4" />} disabled={busy || !promptReady(segment) || running} onClick={() => onGenerate(changed ? choice : undefined)}>
                {running
                    ? segment.videoStatus === "queued" && segment.videoWait
                        ? videoWaitLabel(segment.videoWait)
                        : segment.request.firstFramePending
                          ? tr("排队中 · 等第 {0} 段", segment.index)
                          : tr("视频生成中")
                    : segment.videoResourceId && segment.videoStatus !== ""
                      ? tr("重新生成本段视频")
                      : tr("生成本段视频")}
            </Button>
        </div>
    );
}

function SegmentPrompt({ segment, writing, onSave, onWrite }: { segment: DramaSegment; writing: boolean; onSave: (override: string) => void; onWrite: () => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState(segment.videoPrompt);
    useEffect(() => setDraft(segment.videoPrompt), [segment.videoPrompt]);
    const busy = segment.promptStatus === "queued" || segment.promptStatus === "running";
    const notice = segment.custom && segment.promptStatus === "stale" ? "" : PROMPT_NOTICE[segment.promptStatus];
    const dirty = draft.trim() !== segment.videoPrompt.trim();
    const commit = () => {
        const next = draft.trim();
        if (!dirty) return;
        if (!next) {
            setDraft(segment.videoPrompt);
            return;
        }
        onSave(next === segment.generated.trim() ? "" : next);
    };
    const sent = [segment.request.header, draft.trim()].filter(Boolean).join("\n\n");
    return (
        <div className="drama-sd-pane">
            <div className="drama-sd-pane-bar">
                <span className="drama-sd-pane-caption">
                    {tr("完整视频提示词")}
                    {segment.custom ? <em>{tr("已改写")}</em> : null}
                </span>
                <span className="drama-sd-pane-tools">
                    {!busy && segment.promptStatus !== "none" ? (
                        <Button size="small" type="text" icon={<Sparkles className="size-3.5" />} loading={writing} onClick={onWrite}>
                            {tr("重新撰写")}
                        </Button>
                    ) : null}
                    {segment.custom ? (
                        <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={() => onSave("")}>
                            {tr("恢复模型版本")}
                        </Button>
                    ) : null}
                    <Button
                        size="small"
                        type="text"
                        icon={<Copy className="size-3.5" />}
                        disabled={!draft}
                        onClick={() =>
                            void navigator.clipboard.writeText(sent).then(
                                () => message.success(tr("已复制发送全文")),
                                () => message.error(tr("复制失败")),
                            )
                        }
                    >
                        {tr("复制发送全文")}
                    </Button>
                </span>
            </div>
            {notice && segment.videoPrompt ? <PromptNotice segment={segment} text={notice} /> : null}
            {segment.request.header ? (
                <div className="drama-sd-header" aria-label={tr("系统追加的参考图说明")}>
                    <span>{tr("提交时加在开头")}</span>
                    <pre>{segment.request.header}</pre>
                </div>
            ) : null}
            {!segment.videoPrompt && !draft && !busy ? (
                <div className="drama-sd-write">
                    <span>
                        {notice}
                        {segment.promptStatus === "failed" && segment.promptError ? `：${segment.promptError}` : ""}
                    </span>
                    <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={writing} onClick={onWrite}>
                        {segment.promptStatus === "none" ? "让模型撰写" : "重新撰写"}
                    </Button>
                </div>
            ) : null}
            {segment.videoPrompt || draft || !busy ? (
                <Input.TextArea
                    className="drama-sd-text thin-scrollbar"
                    value={draft}
                    aria-label={tr("完整视频提示词")}
                    placeholder={tr("也可以直接在这里手写本段完整视频提示词，失焦保存；开头的参考图说明由系统自动追加。")}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            commit();
                            (event.target as HTMLTextAreaElement).blur();
                        }
                        if (event.key === "Escape" && dirty) {
                            event.stopPropagation();
                            setDraft(segment.videoPrompt);
                            (event.target as HTMLTextAreaElement).blur();
                        }
                    }}
                />
            ) : (
                <div className="drama-sd-empty">
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                    <span>{notice}</span>
                    <small>{tr("写好后自动显示")}</small>
                </div>
            )}
            <div className="drama-sd-pane-foot">
                {dirty ? <span className="is-dirty">{tr("未保存 · 失焦或 ⌘↵ 保存，Esc 放弃")}</span> : <span>{tr("直接修改正文，失焦自动保存")}</span>}
                <span>{tr("{0} 字", draft.length)}</span>
            </div>
        </div>
    );
}

function PromptNotice({ segment, text }: { segment: DramaSegment; text: ReactNode }) {
    const busy = segment.promptStatus === "queued" || segment.promptStatus === "running";
    return (
        <div className={`drama-sd-notice is-${segment.promptStatus}`}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            <span>
                {text}
                {segment.promptStatus === "failed" && segment.promptError ? `：${segment.promptError}` : ""}
            </span>
        </div>
    );
}

/** 单个镜头的剧本内容；镜头是撰写段提示词的素材，不再单独生成媒体。 */
export function ShotEditor({ shot, onPatch }: { shot: DramaShot; onPatch: (patch: DramaShotPatch) => void }) {
    return (
        <div className="drama-sd-form">
            <FieldText label={tr("台词")} value={shot.dialogue} placeholder={tr("无台词")} onSave={(value) => onPatch({ dialogue: value })} />
            <div className="drama-sd-row">
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>{tr("说话人")}</span>
                    </span>
                    <Input
                        defaultValue={shot.speaker}
                        key={`${shot.id}-speaker-${shot.speaker}`}
                        placeholder={tr("旁白")}
                        aria-label={tr("说话人")}
                        onBlur={(event) => {
                            if (event.target.value.trim() !== shot.speaker) onPatch({ speaker: event.target.value });
                        }}
                    />
                </label>
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>{tr("时长")}</span>
                    </span>
                    <InputNumber
                        key={`${shot.id}-${shot.durationMs}`}
                        className="!w-full"
                        min={1}
                        max={60}
                        step={0.5}
                        precision={1}
                        defaultValue={shot.durationMs / 1000}
                        suffix={tr("秒")}
                        aria-label={tr("镜头时长")}
                        onBlur={(event) => {
                            const seconds = Number(event.target.value);
                            if (Number.isFinite(seconds) && Math.abs(seconds * 1000 - shot.durationMs) >= 50) onPatch({ durationSeconds: seconds });
                        }}
                        onPressEnter={(event) => (event.target as HTMLInputElement).blur()}
                    />
                </label>
            </div>
            <div className="drama-sd-row is-three">
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>{tr("景别")}</span>
                    </span>
                    <Select className="w-full" value={shot.shotSize || undefined} placeholder={tr("自动")} aria-label={tr("景别")} options={SHOT_SIZES.map((value) => ({ value, label: value }))} onChange={(value) => onPatch({ shotSize: value })} />
                </label>
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>{tr("运镜")}</span>
                    </span>
                    <Select className="w-full" value={shot.camera || undefined} placeholder={tr("自动")} aria-label={tr("运镜")} options={CAMERAS.map((value) => ({ value, label: value }))} onChange={(value) => onPatch({ camera: value })} />
                </label>
                <label className="drama-sd-field">
                    <span className="drama-sd-label">
                        <span>{tr("转场")}</span>
                    </span>
                    <Select
                        className="w-full"
                        value={(shot.transition || "cut") as DramaTransition}
                        aria-label={tr("转场")}
                        options={(Object.keys(TRANSITION_LABEL) as DramaTransition[]).map((value) => ({ value, label: TRANSITION_LABEL[value] }))}
                        disabled={shot.position === 0}
                        onChange={(value) => onPatch({ transition: value })}
                    />
                </label>
            </div>
            <FieldText label={tr("动作")} value={shot.action} rows={2} onSave={(value) => onPatch({ action: value })} />
            <FieldText label={tr("起幅画面")} value={shot.imagePrompt} rows={2} onSave={(value) => onPatch({ imagePrompt: value })} />
            {shot.sourceQuote ? (
                <div className="drama-sd-quote">
                    <span className="drama-sd-label">
                        <span>{tr("原文")}</span>
                    </span>
                    <p>「{shot.sourceQuote}」</p>
                </div>
            ) : null}
        </div>
    );
}

function FieldText({ label, value, placeholder, rows = 1, onSave }: { label: string; value: string; placeholder?: string; rows?: number; onSave: (value: string) => void }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (
        <label className="drama-sd-field">
            <span className="drama-sd-label">
                <span>{label}</span>
                {draft !== value ? <small className="is-dirty">{tr("未保存")}</small> : null}
            </span>
            <Input.TextArea
                value={draft}
                placeholder={placeholder}
                autoSize={{ minRows: rows, maxRows: 5 }}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    if (draft.trim() !== value.trim()) onSave(draft);
                }}
            />
        </label>
    );
}
