import { tr } from "@/i18n";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Checkbox, Input, InputNumber, Select, Switch } from "antd";
import { AlertCircle, ArrowRight, CheckCheck, Clapperboard, Film, Gem, Inbox, Lock, MapPinned, Maximize2, PauseCircle, RefreshCw, RotateCcw, ScrollText, Sparkles, Upload, UserRound, UsersRound, Wand2 } from "lucide-react";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { dramaChoiceKey } from "@/lib/drama/model-choice";
import {
    getDramaCastImpact,
    regenerateDramaCast,
    regenerateDramaCasts,
    setDramaCastImage,
    updateDramaCast,
    updateDramaSettings,
    type DramaCapability,
    type DramaCast,
    type DramaCastKind,
    type DramaInboxItem,
    type DramaMediaMode,
    type DramaReviewMode,
    type DramaSummary,
} from "@/services/api/drama";

import { aspectRatioValue, CAST_KIND_LABEL, MEDIA_MODE_LABEL, mediaBusy, MediaThumb, parseList } from "../drama-shared";
import { AssetSchemePicker } from "../asset-scheme";
import { DramaModelPicker, useDramaModelCatalog } from "../drama-model-picker";
import { PromptSkillField } from "../prompt-skill";
import { StoryboardRules } from "../storyboard-rules";
import { uploadResourceFile } from "@/services/api/resources";

// 制作台的三个整页视图：设定（角色 / 道具 / 场景）、待处理、制作设置。都在主区域内展示，不使用抽屉遮挡。

// ===== 设定 =====

const CAST_KIND_ICON: Record<DramaCastKind, ReactNode> = { character: <UserRound className="size-6 opacity-30" />, prop: <Gem className="size-6 opacity-30" />, scene: <MapPinned className="size-6 opacity-30" /> };
const CAST_KINDS: DramaCastKind[] = ["character", "prop", "scene"];

type CastFilter = "all" | "failed" | "busy" | "locked";

/** 资产参考图统一横版 16:9；角色按参考图方案的画幅（内置方案均为 16:9）。图片完整显示不裁切，占位与成图同尺寸。 */
const ASSET_IMAGE_RATIO = "16:9";

function castRatio(kind: DramaCastKind, ratios: CastRatios) {
    const ratio = (kind === "character" && ratios.character) || ASSET_IMAGE_RATIO;
    const [width, height] = ratio.split(":").map(Number);
    const orientation = width && height ? (width > height ? "is-wide" : width < height ? "is-tall" : "is-square") : "is-tall";
    return { style: { "--drama-cast-ratio": aspectRatioValue(ratio) } as CSSProperties, orientation };
}

export type CastRatios = { character: string };

const castImageLoading = <span className="drama-cast-media-state is-loading" role="status" aria-label={tr("参考图加载中")} />;
const castImageFailed = (
    <span className="drama-cast-media-state">
        <AlertCircle className="size-3.5" />
        {tr("图片加载失败")}
    </span>
);

export function CastPanel({
    projectId,
    cast,
    ratios,
    focusId,
    retrying,
    assetsPending,
    releasing,
    onFocus,
    onRetry,
    onChanged,
    onReleaseAssets,
}: {
    projectId: string;
    cast: DramaCast[];
    ratios: CastRatios;
    focusId: string;
    retrying: boolean;
    assetsPending: boolean;
    releasing: boolean;
    onFocus: (id: string) => void;
    onRetry: () => void;
    onChanged: () => void;
    onReleaseAssets: () => void;
}) {
    const [kind, setKind] = useState<DramaCastKind>("character");
    const [filter, setFilter] = useState<CastFilter>("all");
    const focused = cast.find((item) => item.id === focusId);
    useEffect(() => {
        if (focused) setKind(focused.kind);
    }, [focused]);
    const ofKind = cast.filter((item) => item.kind === kind);
    const failed = cast.filter((item) => item.imageStatus === "failed").length;
    const count = (predicate: (item: DramaCast) => boolean) => ofKind.filter(predicate).length;
    const filters: Array<[CastFilter, string, number]> = [
        ["all", tr("全部"), ofKind.length],
        ["failed", tr("失败"), count((item) => item.imageStatus === "failed")],
        ["busy", tr("生成中"), count((item) => mediaBusy(item.imageStatus))],
        ["locked", tr("已锁定"), count((item) => item.locked)],
    ];
    const list = ofKind.filter((item) => {
        if (filter === "failed") return item.imageStatus === "failed";
        if (filter === "busy") return mediaBusy(item.imageStatus);
        if (filter === "locked") return item.locked;
        return true;
    });
    const active = focused && focused.kind === kind ? focused : list[0];
    const kindRatio = castRatio(kind, ratios);
    return (
        <div className="drama-view drama-cast-layout">
            <section className="drama-view-main">
                <div className="drama-view-head">
                    <div className="drama-tabs" role="tablist" aria-label={tr("设定类型")}>
                        {CAST_KINDS.map((value) => (
                            <button key={value} type="button" role="tab" className="drama-tab" aria-selected={kind === value} onClick={() => setKind(value)}>
                                {CAST_KIND_LABEL[value]}
                                <span className="drama-tab-count">{cast.filter((item) => item.kind === value).length}</span>
                            </button>
                        ))}
                    </div>
                    <div className="drama-filters" role="group" aria-label={tr("筛选")}>
                        {filters.map(([key, label, value]) => (
                            <button key={key} type="button" className={`drama-filter ${key === "failed" && value ? "is-alert" : ""}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                                {label}
                                <b>{value}</b>
                            </button>
                        ))}
                    </div>
                    {failed ? (
                        <Button className="!ml-auto" icon={<RotateCcw className="size-4" />} loading={retrying} onClick={onRetry}>
                            {tr("重试失败的 {0} 个", failed)}
                        </Button>
                    ) : null}
                </div>
                <div className="drama-view-scroll thin-scrollbar">
                    {assetsPending && cast.some((item) => item.imageStatus === "") ? (
                        <div className="drama-banner is-ready is-flush">
                            <Sparkles className="size-5 shrink-0 text-[var(--workspace-accent)]" />
                            <div className="drama-banner-text">
                                <strong>{tr("参考图还没有生成")}</strong>
                                <span>{tr("先核对角色、道具与场景的名称和外观描述，满意后再生成参考图；也可以在右侧单独生成某一个。参考图会随剧情段视频请求一起发送，保持人物和道具一致。")}</span>
                            </div>
                            <Button type="primary" icon={<Sparkles className="size-4" />} loading={releasing} onClick={onReleaseAssets}>
                                {tr("生成全部参考图")}
                            </Button>
                        </div>
                    ) : null}
                    <div className={`drama-cast-grid ${kindRatio.orientation}`}>
                        {list.map((item) => (
                            <button key={item.id} type="button" className="drama-cast-card" aria-current={item.id === active?.id} onClick={() => onFocus(item.id)}>
                                <div className="drama-cast-card-media" style={kindRatio.style}>
                                    {item.imageResourceId ? <MediaThumb resourceId={item.imageResourceId} alt={item.name} loading={castImageLoading} failed={castImageFailed} /> : null}
                                    {!item.imageResourceId || mediaBusy(item.imageStatus) || item.imageStatus === "failed" || item.imageStatus === "" ? (
                                        <div className={`drama-shot-placeholder ${mediaBusy(item.imageStatus) ? "is-busy" : ""}`}>
                                            {item.imageStatus === "failed" ? (
                                                <span className="drama-cast-card-failed">
                                                    <AlertCircle className="size-3.5" />
                                                    {tr("生成失败")}
                                                </span>
                                            ) : item.imageResourceId ? (
                                                tr("更新中…")
                                            ) : (
                                                CAST_KIND_ICON[item.kind]
                                            )}
                                        </div>
                                    ) : null}
                                    {item.locked ? (
                                        <span className="drama-shot-flags">
                                            <span className="drama-flag is-lock">
                                                <Lock className="size-3" />
                                            </span>
                                        </span>
                                    ) : null}
                                </div>
                                <div className="drama-cast-card-body">
                                    <strong>{item.name}</strong>
                                    <span>{item.role || parseList(item.aliasesJson).join("、") || item.description || "—"}</span>
                                </div>
                            </button>
                        ))}
                    </div>
                    {!list.length ? (
                        <div className="drama-empty">
                            <UserRound className="size-7" />
                            <span>{ofKind.length ? tr("没有符合筛选的设定") : tr("作品圣经建立后，{0}会出现在这里", CAST_KIND_LABEL[kind])}</span>
                        </div>
                    ) : null}
                </div>
            </section>
            <aside className="drama-view-side thin-scrollbar">
                {active ? (
                    <CastEditor key={active.id} projectId={projectId} cast={active} ratios={ratios} onChanged={onChanged} />
                ) : (
                    <div className="drama-empty is-compact">
                        <span>{tr("选择一个设定查看详情")}</span>
                    </div>
                )}
            </aside>
        </div>
    );
}

function CastEditor({ projectId, cast, ratios, onChanged }: { projectId: string; cast: DramaCast; ratios: CastRatios; onChanged: () => void }) {
    const { message } = App.useApp();
    const [previewing, setPreviewing] = useState(false);
    const [name, setName] = useState(cast.name);
    const [aliases, setAliases] = useState(parseList(cast.aliasesJson));
    const [appearance, setAppearance] = useState(cast.appearance);
    const [voiceInstructions, setVoiceInstructions] = useState(cast.voiceInstructions);
    const [restyle, setRestyle] = useState(true);
    const impactQuery = useQuery({ queryKey: ["drama", projectId, "cast-impact", cast.id], queryFn: ({ signal }) => getDramaCastImpact(projectId, cast.id, signal) });
    const dirty = name !== cast.name || appearance !== cast.appearance || voiceInstructions !== cast.voiceInstructions || aliases.join("|") !== parseList(cast.aliasesJson).join("|");
    const fields = { name, aliases, appearance, voiceInstructions };
    const save = useMutation({
        mutationFn: () => updateDramaCast(projectId, cast.id, fields),
        onSuccess: () => {
            message.success(tr("设定已保存"));
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("保存失败")),
    });
    const lock = useMutation({ mutationFn: (locked: boolean) => updateDramaCast(projectId, cast.id, { locked }), onSuccess: onChanged });
    const regenerate = useMutation({
        mutationFn: async () => {
            if (dirty) await updateDramaCast(projectId, cast.id, fields);
            return regenerateDramaCast(projectId, cast.id, restyle);
        },
        onSuccess: (result) => {
            message.success(result.affectedSegments ? tr("正在重新生成参考图；{0} 个剧情段的视频需重新生成", result.affectedSegments) : tr("正在重新生成参考图"));
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("操作失败")),
    });
    // 上传的形象图直接成为参考图并锁定：不会被重新生成覆盖，剧情段视频按这张图生成。
    const fileRef = useRef<HTMLInputElement>(null);
    const upload = useMutation({
        mutationFn: async (file: File) => {
            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
            return setDramaCastImage(projectId, cast.id, resource.id, restyle);
        },
        onSuccess: (result) => {
            message.success(result.affectedSegments ? tr("已替换并锁定形象；{0} 个剧情段的视频需重新生成", result.affectedSegments) : tr("已替换并锁定形象，之后的剧情段视频按这张图生成"));
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("上传失败")),
    });
    const impact = impactQuery.data;
    const isCharacter = cast.kind === "character";
    const kindLabel = CAST_KIND_LABEL[cast.kind];
    return (
        <div className="drama-editor">
            <div className="drama-cast-hero" style={castRatio(cast.kind, ratios).style}>
                {cast.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt={cast.name} loading={castImageLoading} failed={castImageFailed} /> : null}
                {cast.imageResourceId ? (
                    <button type="button" className="drama-cast-hero-zoom" aria-label={tr("放大查看{0}的参考图", cast.name)} title={tr("点击放大查看")} onClick={() => setPreviewing(true)}>
                        <span className="drama-cast-hero-zoom-hint" aria-hidden="true">
                            <Maximize2 className="size-3.5" />
                        </span>
                    </button>
                ) : null}
                {!cast.imageResourceId || mediaBusy(cast.imageStatus) || cast.imageStatus === "failed" ? (
                    <div className={`drama-shot-placeholder ${mediaBusy(cast.imageStatus) ? "is-busy" : ""}`}>
                        {cast.imageStatus === "failed" ? (
                            <span className="drama-cast-card-failed">
                                <AlertCircle className="size-4" />
                                {tr("参考图生成失败")}
                            </span>
                        ) : mediaBusy(cast.imageStatus) ? (
                            tr("参考图生成中…")
                        ) : (
                            tr("尚未生成参考图：确认描述后点下方生成，或上传已有的形象图")
                        )}
                    </div>
                ) : null}
            </div>
            <div className="drama-editor-row">
                <span className="drama-eyebrow">
                    {kindLabel}
                    {tr("设定")}
                </span>
                <label className="drama-switch-label">
                    <Lock className="size-3.5" />
                    {tr("锁定形象")}
                    <Switch size="small" checked={cast.locked} loading={lock.isPending} onChange={(checked) => lock.mutate(checked)} />
                </label>
            </div>
            <Field label={tr("名称")}>
                <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} aria-label={tr("名称")} />
            </Field>
            {isCharacter ? (
                <Field label={tr("别名与称呼")} hint={tr("剧本里这些称呼都会归到此角色")}>
                    <Select mode="tags" className="w-full" value={aliases} onChange={setAliases} tokenSeparators={[",", "，", "、"]} placeholder={tr("输入后回车")} open={false} suffixIcon={null} aria-label={tr("别名与称呼")} />
                </Field>
            ) : null}
            <Field label={APPEARANCE_LABEL[cast.kind]} hint={tr("用于参考图与剧情段视频提示词")}>
                <Input.TextArea value={appearance} autoSize={{ minRows: 4, maxRows: 10 }} onChange={(event) => setAppearance(event.target.value)} aria-label={APPEARANCE_LABEL[cast.kind]} />
            </Field>
            {isCharacter ? (
                <Field label={tr("声线")} hint={tr("写进视频提示词，由视频模型生成对白")}>
                    <Input value={voiceInstructions} placeholder={tr("少年音，坚毅，语速偏快")} onChange={(event) => setVoiceInstructions(event.target.value)} aria-label={tr("声线")} />
                </Field>
            ) : null}
            <div className="drama-editor-impact">
                <Checkbox checked={restyle} onChange={(event) => setRestyle(event.target.checked)}>
                    {tr("让引用它的剧情段视频重新生成")}
                </Checkbox>
                {impact ? <span>{tr("{0} 集 · {1} 段", impact.episodes, impact.segments)}</span> : null}
            </div>
            <div className="drama-editor-actions">
                <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                    {tr("保存设定")}
                </Button>
                <Button icon={<Upload className="size-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                    {tr("上传形象图")}
                </Button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    aria-label={tr("上传{0}的形象图", cast.name)}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        if (!file.type.startsWith("image/")) {
                            message.warning(tr("请选择 PNG、JPG 或 WebP 图片"));
                            return;
                        }
                        if (file.size > 20 * 1024 * 1024) {
                            message.warning(tr("图片不超过 20MB"));
                            return;
                        }
                        upload.mutate(file);
                    }}
                />
                <Button type="primary" className="drama-editor-wide" icon={<RefreshCw className="size-4" />} disabled={cast.locked || mediaBusy(cast.imageStatus)} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                    {cast.imageResourceId ? (dirty ? tr("保存并重新生成") : tr("重新生成")) : dirty ? tr("保存并生成参考图") : tr("生成参考图")}
                </Button>
            </div>
            <p className="drama-editor-note">{tr("旧版本保留在版本记录中；锁定后参考图不会被重新生成。上传的形象图会自动锁定，生成剧情段视频时随请求发送，并要求外貌、发型与服装以它为准。")}</p>
            {previewing && cast.imageResourceId ? <CanvasImagePreview storageKey={`resource:${cast.imageResourceId}`} alt={tr("{0} · {1}参考图", cast.name, kindLabel)} onClose={() => setPreviewing(false)} /> : null}
        </div>
    );
}

const APPEARANCE_LABEL: Record<DramaCastKind, string> = { character: tr("外貌描述"), prop: tr("外形描述"), scene: tr("环境描述") };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <div className="drama-field">
            <div className="drama-field-label">
                <span>{label}</span>
                {hint ? <small>{hint}</small> : null}
            </div>
            {children}
        </div>
    );
}

// ===== 待处理 =====

type InboxGroup = {
    key: string;
    kind: DramaInboxItem["kind"];
    severity: DramaInboxItem["severity"];
    title: string;
    reason: string;
    items: DramaInboxItem[];
};

const KIND_ORDER: DramaInboxItem["kind"][] = ["paused", "media_ready", "review", "episode_error", "cast_failed", "segment_failed"];
const MEDIA_LABEL: Record<NonNullable<DramaInboxItem["media"]>, string> = { prompt: tr("提示词"), video: tr("视频") };

/** 同类、同原因的问题折叠成一组：12 个角色同样的失败只占一张卡。 */
function groupInbox(items: DramaInboxItem[]): InboxGroup[] {
    const groups = new Map<string, InboxGroup>();
    for (const item of items) {
        const reason = item.kind === "review" ? "" : item.detail;
        const key = [item.kind, item.castKind || "", item.media || "", reason].join("|");
        const group = groups.get(key);
        if (group) group.items.push(item);
        else groups.set(key, { key, kind: item.kind, severity: item.severity, title: "", reason, items: [item] });
    }
    for (const group of groups.values()) {
        const count = group.items.length;
        const first = group.items[0];
        if (group.kind === "paused") group.title = tr("制作已暂停");
        else if (group.kind === "media_ready") group.title = first.title;
        else if (group.kind === "review") group.title = count > 1 ? tr("{0} 集视频提示词等待审阅", count) : first.title;
        else if (group.kind === "episode_error") group.title = count > 1 ? tr("{0} 集改编遇到问题", count) : first.title;
        else if (group.kind === "cast_failed") group.title = tr("{0} 个{1}参考图生成失败", count, CAST_KIND_LABEL[first.castKind || "character"]);
        else group.title = tr("{0} 个剧情段{1}生成失败", count, MEDIA_LABEL[first.media || "video"]);
    }
    return [...groups.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.items.length - a.items.length);
}

const GROUP_ICON: Record<DramaInboxItem["kind"], ReactNode> = {
    paused: <PauseCircle className="size-[18px]" />,
    media_ready: <Sparkles className="size-[18px]" />,
    review: <CheckCheck className="size-[18px]" />,
    episode_error: <ScrollText className="size-[18px]" />,
    cast_failed: <UserRound className="size-[18px]" />,
    segment_failed: <Film className="size-[18px]" />,
};

const MEDIA_ICON: Record<NonNullable<DramaInboxItem["media"]>, ReactNode> = {
    prompt: <ScrollText className="size-3" />,
    video: <Film className="size-3" />,
};

const CHIP_LIMIT = 24;

export function InboxPanel({
    items,
    castById,
    retrying,
    retryingGroup,
    releasing,
    onRetryAll,
    onRetryGroup,
    onOpen,
    onOpenSettings,
    onReleaseAll,
}: {
    items: DramaInboxItem[];
    castById: Map<string, DramaCast>;
    retrying: boolean;
    retryingGroup: string;
    onRetryAll: () => void;
    onRetryGroup: (key: string, items: DramaInboxItem[]) => void;
    onOpen: (item: DramaInboxItem) => void;
    onOpenSettings: () => void;
    releasing: boolean;
    onReleaseAll: () => void;
}) {
    const groups = useMemo(() => groupInbox(items), [items]);
    const failures = items.filter((item) => item.severity === "error").length;
    const reviews = items.filter((item) => item.kind === "review").length;
    return (
        <div className="drama-view">
            <section className="drama-view-main">
                <div className="drama-view-head">
                    <h2 className="drama-view-title">{tr("待处理")}</h2>
                    {items.length ? (
                        <div className="drama-inbox-summary">
                            {failures ? (
                                <span className="is-err">
                                    <AlertCircle className="size-3.5" />
                                    {tr("{0} 项失败", failures)}
                                </span>
                            ) : null}
                            {reviews ? (
                                <span className="is-info">
                                    <CheckCheck className="size-3.5" />
                                    {tr("{0} 集待审阅", reviews)}
                                </span>
                            ) : null}
                            <span>{tr("共 {0} 类", groups.length)}</span>
                        </div>
                    ) : null}
                    {failures ? (
                        <Button className="!ml-auto" icon={<RotateCcw className="size-4" />} loading={retrying} onClick={onRetryAll}>
                            {tr("全部重试")}
                        </Button>
                    ) : null}
                </div>
                <div className="drama-view-scroll thin-scrollbar">
                    {groups.length ? (
                        <div className="drama-inbox">
                            {groups.map((group) => {
                                const retryable = group.kind === "cast_failed" || group.kind === "segment_failed";
                                return (
                                    <article key={group.key} className={`drama-inbox-card is-${group.severity}`}>
                                        <header className="drama-inbox-card-head">
                                            <span className={`drama-inbox-icon is-${group.severity}`}>{GROUP_ICON[group.kind]}</span>
                                            <div className="min-w-0 flex-1">
                                                <h3>{group.title}</h3>
                                                {group.kind === "review" ? (
                                                    <p>{tr("核对各段视频提示词与参考图后继续生成视频")}</p>
                                                ) : group.kind === "cast_failed" ? (
                                                    <p>{tr("可修改外观描述后重新生成，或直接重试")}</p>
                                                ) : group.kind === "media_ready" ? (
                                                    <p>{group.items[0].detail}</p>
                                                ) : null}
                                            </div>
                                            <div className="drama-inbox-card-actions">
                                                {group.kind === "paused" ? (
                                                    <Button size="small" onClick={onOpenSettings}>
                                                        {tr("去设置")}
                                                    </Button>
                                                ) : null}
                                                {group.kind === "media_ready" ? (
                                                    <Button size="small" type="primary" icon={<Sparkles className="size-3.5" />} loading={releasing} onClick={onReleaseAll}>
                                                        {tr("全部开始生成")}
                                                    </Button>
                                                ) : null}
                                                {retryable ? (
                                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={retryingGroup === group.key} onClick={() => onRetryGroup(group.key, group.items)}>
                                                        {tr("重试")}
                                                        {group.items.length > 1 ? tr(" {0} 项", group.items.length) : ""}
                                                    </Button>
                                                ) : null}
                                                {group.items.length === 1 && group.kind !== "paused" && group.kind !== "media_ready" ? (
                                                    <Button size="small" type={group.kind === "review" ? "primary" : "default"} onClick={() => onOpen(group.items[0])}>
                                                        {group.kind === "review" ? tr("去审阅") : tr("查看")}
                                                        <ArrowRight className="size-3.5" />
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </header>
                                        {group.reason && group.kind !== "media_ready" ? (
                                            <div className="drama-inbox-reason" title={group.reason}>
                                                <span>{tr("原因")}</span>
                                                <code>{group.reason}</code>
                                            </div>
                                        ) : null}
                                        {group.items.length > 1 || group.kind === "cast_failed" ? (
                                            <div className="drama-inbox-chips">
                                                {group.items.slice(0, CHIP_LIMIT).map((item) => (
                                                    <InboxChip key={item.id} item={item} cast={item.castId ? castById.get(item.castId) : undefined} onOpen={onOpen} />
                                                ))}
                                                {group.items.length > CHIP_LIMIT ? <span className="drama-inbox-more">{tr("另有 {0} 项", group.items.length - CHIP_LIMIT)}</span> : null}
                                            </div>
                                        ) : null}
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="drama-empty is-tall">
                            <Inbox className="size-8" />
                            <strong>{tr("一切顺利")}</strong>
                            <span>{tr("没有需要你处理的事项，流水线会在需要确认或出错时提醒你。")}</span>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

function InboxChip({ item, cast, onOpen }: { item: DramaInboxItem; cast?: DramaCast; onOpen: (item: DramaInboxItem) => void }) {
    let content: ReactNode;
    if (item.kind === "cast_failed") {
        content = (
            <>
                <span className="drama-avatar">{cast?.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt="" /> : item.title.slice(0, 1)}</span>
                {item.title}
            </>
        );
    } else if (item.kind === "segment_failed") {
        content = (
            <>
                {item.media ? MEDIA_ICON[item.media] : null}
                {tr("第 {0} 集 · 第 {1} 段", item.episodeNumber, item.segmentIndex + 1)}
            </>
        );
    } else if (item.kind === "review") {
        content = (
            <>
                <Clapperboard className="size-3" />
                {item.title}
            </>
        );
    } else {
        content = item.title;
    }
    return (
        <button type="button" className={`drama-inbox-chip ${item.kind === "cast_failed" ? "has-avatar" : ""}`} title={item.detail} onClick={() => onOpen(item)}>
            {content}
        </button>
    );
}

// ===== 制作设置 =====

const CAPABILITY_META: Record<DramaCapability, { label: string; hint: string }> = {
    text: { label: tr("改编与分镜"), hint: tr("改编剧本、拆分剧情段与镜头") },
    image: { label: tr("参考图"), hint: tr("角色、道具与场景参考图") },
    video: { label: tr("剧情段视频"), hint: tr("每段一个带对白与音效的视频，可按段换模型") },
};
const REVIEW_LABEL: Record<DramaReviewMode, { title: string; detail: string }> = {
    sample: { title: tr("先看样片"), detail: tr("第 1 集成片确认后继续其余集") },
    every: { title: tr("每集确认"), detail: tr("每集生成视频前停下来审阅段视频提示词") },
    auto: { title: tr("全自动"), detail: tr("不打断，直接跑到成片") },
};
const CONCURRENCY = [2, 4, 6, 8, 12, 16];

export function SettingsPanel({ projectId, summary, cast, onChanged }: { projectId: string; summary: DramaSummary; cast: DramaCast[]; onChanged: () => void }) {
    const { message, modal } = App.useApp();
    const current = summary.production.settings;
    const [settings, setSettings] = useState(current);
    useEffect(() => {
        setSettings(summary.production.settings);
    }, [summary.production.settings]);
    const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(current), [current, settings]);
    const save = useMutation({
        mutationFn: () => updateDramaSettings(projectId, { settings }),
        onSuccess: () => {
            message.success(tr("设置已保存，新任务会使用新配置"));
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("保存失败")),
    });
    const [restyleSegments, setRestyleSegments] = useState(true);
    const regenerateAll = useMutation({
        mutationFn: (kind: DramaCastKind) => regenerateDramaCasts(projectId, kind, restyleSegments),
        onSuccess: (result, kind) => {
            message.success(
                tr(
                    "已按当前方案重做 {0} 个{1}参考图{2}{3}",
                    result.queued,
                    CAST_KIND_LABEL[kind],
                    result.skipped ? tr("，{0} 个已锁定或正在生成", result.skipped) : "",
                    result.affectedSegments ? tr("，{0} 个剧情段需重新生成", result.affectedSegments) : "",
                ),
            );
            onChanged();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("操作失败")),
    });
    const catalogQuery = useDramaModelCatalog();
    const videoOption = catalogQuery.data?.options.video?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(settings.models.video));
    const sampleCharacter = cast.find((item) => item.kind === "character" && item.appearance);
    const sampleScene = cast.find((item) => item.kind === "scene" && item.appearance);
    const countOf = (kind: DramaCastKind) => cast.filter((item) => item.kind === kind).length;
    return (
        <div className="drama-view">
            <section className="drama-view-main">
                <div className="drama-view-head">
                    <h2 className="drama-view-title">{tr("制作设置")}</h2>
                    <span className="drama-view-sub">{dirty ? tr("有未保存的修改") : tr("修改只影响之后新开始的任务")}</span>
                    <div className="ml-auto flex gap-2">
                        <Button
                            disabled={!dirty}
                            onClick={() => {
                                setSettings(current);
                            }}
                        >
                            {tr("还原")}
                        </Button>
                        <Button type="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                            {tr("保存设置")}
                        </Button>
                    </div>
                </div>
                <div className="drama-view-scroll thin-scrollbar">
                    <div className="drama-cfg">
                        <div className="drama-cfg-main">
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("分镜规则")} detail={tr("对之后改编的集生效；已改编的集可在剧本页“重新改编”")} icon={<Clapperboard className="size-4" />} />
                                <StoryboardRules
                                    value={settings.storyboard}
                                    onChange={(storyboard) => setSettings({ ...settings, storyboard })}
                                    episodeSeconds={settings.episodeSeconds}
                                    onEpisodeSecondsChange={(episodeSeconds) => setSettings({ ...settings, episodeSeconds })}
                                    maxVideoSeconds={videoOption?.maxVideoSeconds}
                                    videoModelLabel={settings.models.video?.label}
                                    bare
                                />
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("视频提示词技能")} detail={tr("撰写剧情段视频提示词时遵循的写作方法；对之后撰写的段生效")} icon={<ScrollText className="size-4" />} />
                                <PromptSkillField value={settings.promptSkill} onChange={(promptSkill) => setSettings({ ...settings, promptSkill })} />
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("参考图方案")} detail={tr("参考图随剧情段视频请求一起发送，是人物与道具保持一致的锚点；修改只影响之后生成的参考图")} icon={<UsersRound className="size-4" />} />
                                <AssetSchemePicker
                                    value={settings.assets}
                                    onChange={(assets) => setSettings({ ...settings, assets })}
                                    sample={{ style: settings.stylePrompt, characterName: sampleCharacter?.name, characterAppearance: sampleCharacter?.appearance, sceneName: sampleScene?.name, sceneAppearance: sampleScene?.appearance }}
                                />
                                <div className="drama-settings-regen">
                                    <div>
                                        <strong>{tr("按当前方案重做已有参考图")}</strong>
                                        <span>
                                            {CAST_KINDS.map((kind) => tr("{0} 个{1}", countOf(kind), CAST_KIND_LABEL[kind])).join(" · ")}
                                            {tr("；锁定的设定不会变。")}
                                            {dirty ? tr("请先保存设置。") : ""}
                                        </span>
                                    </div>
                                    <Checkbox checked={restyleSegments} onChange={(event) => setRestyleSegments(event.target.checked)}>
                                        {tr("同时让引用它们的剧情段视频重新生成")}
                                    </Checkbox>
                                    {CAST_KINDS.map((kind) => (
                                        <Button
                                            key={kind}
                                            disabled={dirty || !countOf(kind)}
                                            loading={regenerateAll.isPending && regenerateAll.variables === kind}
                                            onClick={() =>
                                                modal.confirm({
                                                    title: tr("按当前方案重做 {0} 个{1}参考图？", countOf(kind), CAST_KIND_LABEL[kind]),
                                                    content: tr("每张参考图都会重新生成并计费{0}。旧版本保留在版本记录中。", restyleSegments ? tr("，引用它们且已生成的剧情段视频需要重新生成") : ""),
                                                    okText: tr("开始重做"),
                                                    cancelText: tr("取消"),
                                                    centered: true,
                                                    onOk: () => regenerateAll.mutateAsync(kind),
                                                })
                                            }
                                        >
                                            {tr("重做")}
                                            {CAST_KIND_LABEL[kind]}
                                        </Button>
                                    ))}
                                </div>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("制作模型")} detail={tr("只列出平台可无人值守执行的模型")} icon={<Wand2 className="size-4" />} />
                                <div className="drama-cfg-models">
                                    {(Object.keys(CAPABILITY_META) as DramaCapability[]).map((capability) => (
                                        <div key={capability} className="drama-cfg-model">
                                            <div className="drama-cfg-model-label">
                                                <strong>{CAPABILITY_META[capability].label}</strong>
                                                <small>{CAPABILITY_META[capability].hint}</small>
                                            </div>
                                            <DramaModelPicker
                                                capability={capability}
                                                value={settings.models[capability]}
                                                placeholder={tr("选择{0}模型", CAPABILITY_META[capability].label)}
                                                onChange={(choice) => setSettings({ ...settings, models: { ...settings.models, [capability]: choice } })}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                        <aside className="drama-cfg-side">
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("作品")} detail={tr("开工时确定")} />
                                <dl className="drama-cfg-kv">
                                    <div>
                                        <dt>{tr("画幅")}</dt>
                                        <dd>{current.aspectRatio}</dd>
                                    </div>
                                    <div>
                                        <dt>{tr("视觉风格")}</dt>
                                        <dd title={current.styleName}>{current.styleName || "—"}</dd>
                                    </div>
                                    <div>
                                        <dt>{tr("对白语言")}</dt>
                                        <dd>{current.language}</dd>
                                    </div>
                                </dl>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("审阅方式")} detail={tr("只在关键点打断你")} />
                                <CompactRadios
                                    label={tr("审阅方式")}
                                    value={settings.reviewMode}
                                    options={(Object.keys(REVIEW_LABEL) as DramaReviewMode[]).map((mode) => ({ value: mode, ...REVIEW_LABEL[mode] }))}
                                    onChange={(reviewMode) => setSettings({ ...settings, reviewMode })}
                                />
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("生成节奏")} detail={settings.mediaMode === "manual" ? tr("{0} 集等待生成视频", summary.episodes.filter((episode) => episode.awaitingMedia).length) : undefined} />
                                <CompactRadios
                                    label={tr("生成节奏")}
                                    value={settings.mediaMode}
                                    options={(Object.keys(MEDIA_MODE_LABEL) as DramaMediaMode[]).map((mode) => ({ value: mode, ...MEDIA_MODE_LABEL[mode] }))}
                                    onChange={(mediaMode) => setSettings({ ...settings, mediaMode })}
                                />
                                {settings.mediaMode !== current.mediaMode && settings.mediaMode === "manual" ? <p className="drama-cfg-note">{tr("改为手动后，未放行的集停在当前阶段，已提交的任务会做完。")}</p> : null}
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("同时生成数")} detail={tr("受账号并发上限约束")} />
                                <div className="drama-tabs drama-cfg-seg" role="radiogroup" aria-label={tr("同时生成数")}>
                                    {CONCURRENCY.map((value) => (
                                        <button key={value} type="button" role="radio" className="drama-tab" aria-checked={settings.concurrency === value} onClick={() => setSettings({ ...settings, concurrency: value })}>
                                            {value}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="drama-cfg-card">
                                <SettingsTitle title={tr("每段最多参考图")} detail={tr("自动取参考图时的上限，人物优先；0 为按视频模型上限")} />
                                <InputNumber
                                    className="!w-full"
                                    min={0}
                                    max={20}
                                    precision={0}
                                    value={settings.referenceLimit || 0}
                                    onChange={(value) => setSettings({ ...settings, referenceLimit: value || 0 })}
                                    suffix={tr("张")}
                                    aria-label={tr("每段最多参考图")}
                                />
                                <p className="drama-cfg-note">{tr("超出的设定按文字描述生成，不附图。个别段需要更多参考图时，在剧情段弹窗里手动指定，只受模型上限约束。")}</p>
                            </section>
                        </aside>
                    </div>
                </div>
            </section>
        </div>
    );
}

/** 侧栏里的紧凑单选列表：一行标题，说明作为次要文字，选中态只改边框和底色。 */
function CompactRadios<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: Array<{ value: V; title: string; detail: string }>; onChange: (value: V) => void }) {
    return (
        <div className="drama-cfg-radios" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className="drama-cfg-radio" onClick={() => onChange(option.value)}>
                    <span className="drama-radio" aria-hidden />
                    <span className="min-w-0">
                        <strong>{option.title}</strong>
                        <small>{option.detail}</small>
                    </span>
                </button>
            ))}
        </div>
    );
}

function SettingsTitle({ title, detail, icon }: { title: string; detail?: string; icon?: ReactNode }) {
    return (
        <div className="drama-settings-title">
            <h3>
                {icon}
                {title}
            </h3>
            {detail ? <span>{detail}</span> : null}
        </div>
    );
}
