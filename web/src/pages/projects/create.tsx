import { tr } from "@/i18n";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Select } from "antd";
import { AlertTriangle, ArrowLeft, BookOpenText, ClipboardPaste, FileUp, Sparkles, Wand2 } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { DEFAULT_DRAMA_STYLE_ID, findDramaStyle } from "@/lib/drama/drama-styles";
import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { analyzeNovel, EPISODE_SOURCE_CHARS, sourceChars, titleFromFileName } from "@/lib/drama/novel-parse";
import { ApiError } from "@/services/api/request";
import { dramaChoiceKey } from "@/lib/drama/model-choice";
import { DEFAULT_STORYBOARD } from "@/lib/drama/storyboard";
import {
    createDrama,
    estimateDrama,
    type DramaAssetSettings,
    type DramaCapability,
    type DramaEpisodeMode,
    type DramaMediaMode,
    type DramaModels,
    type DramaReviewMode,
    type DramaSkillRef,
    type DramaSourceFormat,
    type DramaStoryboardSettings,
} from "@/services/api/drama";

import { formatCount, MEDIA_MODE_LABEL, SOURCE_FORMAT_LABEL, SourceFormatPicker } from "./drama-shared";
import { AssetSchemePicker, defaultAssetSettings, useAssetSchemes } from "./asset-scheme";
import { DramaModelPicker, useDramaModelCatalog } from "./drama-model-picker";
import { PromptSkillField } from "./prompt-skill";
import { EpisodeDurationInput, StoryboardRules } from "./storyboard-rules";
import { DramaStylePicker } from "./style-picker";
import "./drama.css";

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const RATIOS = [
    { value: "9:16", label: tr("竖屏 9:16"), w: 9, h: 16 },
    { value: "16:9", label: tr("横屏 16:9"), w: 16, h: 9 },
    { value: "1:1", label: tr("方形 1:1"), w: 12, h: 12 },
];
const LANGUAGES = [tr("中文普通话"), tr("粤语"), tr("英语"), tr("日语")];
const REVIEW_MODES: Array<{ value: DramaReviewMode; title: string; detail: string }> = [
    { value: "sample", title: tr("先看样片，满意后全剧自动"), detail: tr("先做完第 1 集成片，请你确认一次画风、角色和声线，之后所有集自动跑到成片。") },
    { value: "every", title: tr("每集确认提示词"), detail: tr("每集生成视频前停下来，等你审阅各剧情段的视频提示词与参考图。") },
    { value: "auto", title: tr("全自动"), detail: tr("不打断，直接从小说跑到成片，可随时在制作台修改重做。") },
];
const CAPABILITY_LABEL: Record<DramaCapability, string> = { text: tr("改编与分镜"), image: tr("角色与场景参考图"), video: tr("剧情段视频") };
const EPISODE_MODES: Array<{ value: DramaEpisodeMode; title: string; detail: string }> = [
    { value: "chapter", title: tr("每章一集，逐集制作"), detail: tr("每个“第 N 章 / 第 N 集”就是一集；可以只放第 1 集，做完再在制作台追加下一集。单集不超过 1.2 万字。") },
    { value: "auto", title: tr("整本导入，自动分集"), detail: tr("由模型把章节规划成集，适合一次导入整本小说；章节多时耗时更长。") },
];

export default function DramaCreatePage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [pasteMode, setPasteMode] = useState(searchParams.get("paste") === "1");
    const [pasteText, setPasteText] = useState("");
    const [sourceText, setSourceText] = useState("");
    const [sourceFormat, setSourceFormat] = useState<DramaSourceFormat>("novel");
    // 默认逐集：一次只让流水线处理一集，长篇整本导入容易让改编任务超时。
    const [chapterMode, setChapterMode] = useState<DramaEpisodeMode>("chapter");
    const episodeMode: DramaEpisodeMode = sourceFormat === "novel" ? chapterMode : "chapter";
    const perEpisode = episodeMode === "chapter";
    const analysis = useMemo(() => (sourceText ? analyzeNovel(sourceText, { perEpisode }) : null), [perEpisode, sourceText]);
    const [name, setName] = useState("");
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [episodeSeconds, setEpisodeSeconds] = useState(90);
    const [styleId, setStyleId] = useState(DEFAULT_DRAMA_STYLE_ID);
    const [language, setLanguage] = useState(LANGUAGES[0]);
    const [reviewMode, setReviewMode] = useState<DramaReviewMode>("sample");
    // 默认先只跑文本：先看剧情、镜头、设定和段提示词对不对，再决定花钱生成参考图与视频。
    const [mediaMode, setMediaMode] = useState<DramaMediaMode>("manual");
    const [storyboard, setStoryboard] = useState<DramaStoryboardSettings>(DEFAULT_STORYBOARD);
    const [promptSkill, setPromptSkill] = useState<DramaSkillRef>();
    const [models, setModels] = useState<Partial<DramaModels>>({});
    const assetCatalog = useAssetSchemes();
    const [assetDraft, setAssetDraft] = useState<DramaAssetSettings>();
    const assets = assetDraft || defaultAssetSettings(assetCatalog.data);
    const [previewIndex, setPreviewIndex] = useState(0);

    const style = findDramaStyle(styleId);
    const catalogQuery = useDramaModelCatalog();
    const resolvedModels = useMemo<DramaModels | undefined>(() => {
        const defaults = catalogQuery.data?.defaults;
        if (!defaults) return undefined;
        return { text: models.text || defaults.text, image: models.image || defaults.image, video: models.video || defaults.video };
    }, [catalogQuery.data, models]);
    const videoOption = catalogQuery.data?.options.video?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(resolvedModels?.video));
    const missingCapabilities = (Object.keys(CAPABILITY_LABEL) as DramaCapability[]).filter((capability) => catalogQuery.data && !dramaChoiceKey(resolvedModels?.[capability]));
    const settings = {
        aspectRatio,
        episodeSeconds,
        stylePrompt: style?.prompt || "",
        styleName: style?.name || "",
        language,
        reviewMode,
        mediaMode,
        storyboard,
        ...(promptSkill ? { promptSkill } : {}),
        concurrency: 4,
        models: resolvedModels,
        ...(assets ? { assets } : {}),
    };
    const estimateQuery = useQuery({
        queryKey: ["drama-estimate", analysis?.chapters.length, analysis?.words, episodeMode, episodeSeconds, JSON.stringify(storyboard), dramaChoiceKey(resolvedModels?.text), dramaChoiceKey(resolvedModels?.image), dramaChoiceKey(resolvedModels?.video)],
        queryFn: ({ signal }) => estimateDrama({ chapterCount: analysis!.chapters.length, wordCount: analysis!.words, settings, episodeMode }, signal),
        enabled: Boolean(analysis && resolvedModels),
        staleTime: 30_000,
    });
    const estimate = estimateQuery.data;

    const loadText = (text: string, fileName?: string) => {
        const result = analyzeNovel(text, { perEpisode });
        if (!result.chapters.length) {
            message.error(tr("没有读取到正文，请检查文件内容"));
            return;
        }
        setSourceText(text);
        if (fileName && !name) setName(titleFromFileName(fileName));
        if (!fileName && !name) setName(result.chapters[0]?.title.slice(0, 20) || tr("未命名短剧"));
    };
    const loadFile = async (file: File) => {
        if (!/\.(txt|md|markdown)$/i.test(file.name)) {
            message.warning(tr("目前支持 TXT 与 Markdown 文件"));
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            message.warning(tr("文件超过 40MB，请拆分后上传"));
            return;
        }
        loadText(decodeNovelText(await file.arrayBuffer()), file.name);
    };
    const handedFile = (location.state as { file?: File } | null)?.file;
    const handedRef = useRef(false);
    useEffect(() => {
        if (!handedFile || handedRef.current) return;
        handedRef.current = true;
        void loadFile(handedFile);
        // 文件只用于首次进入，清掉路由状态避免刷新或返回时重复解析。
        navigate(".", { replace: true, state: null });
    }, [handedFile]); // eslint-disable-line react-hooks/exhaustive-deps
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void loadFile(file);
    };

    const create = useMutation({
        mutationFn: () =>
            createDrama({
                name: name.trim(),
                chapters: analysis!.chapters.map((chapter) => ({ title: chapter.title, text: chapter.text })),
                settings: { ...settings, models: resolvedModels },
                start: true,
                sourceFormat,
                episodeMode,
            }),
        onSuccess: (summary) => navigate(`/projects/${summary.project.id}`, { replace: true }),
        onError: (error) => message.error(error instanceof ApiError || error instanceof Error ? error.message : tr("创建失败")),
    });
    const tooLong = Boolean(analysis?.issues.some((issue) => issue.kind === "too_long"));
    const canStart = Boolean(analysis && name.trim() && resolvedModels && missingCapabilities.length === 0 && !tooLong && !create.isPending);
    const unitLabel = perEpisode ? tr("集") : tr("章");

    const previewChapter = analysis?.chapters[previewIndex];
    const reset = () => {
        setSourceText("");
        setPasteText("");
        setName("");
        setPreviewIndex(0);
    };

    if (!analysis) {
        return (
            <WorkspacePage fluid scroll={false}>
                <div className="drama-root drama-compose-empty">
                    <header className="drama-compose-head">
                        <Link to="/projects">
                            <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} aria-label={tr("返回作品列表")} />
                        </Link>
                        <h1>{tr("新建短剧")}</h1>
                    </header>
                    <div className="drama-compose-formats">
                        <SourceFormatPicker value={sourceFormat} onChange={setSourceFormat} row />
                    </div>
                    <div
                        className={`drama-drop ${dragOver ? "is-over" : ""}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                    >
                        {pasteMode ? (
                            <div className="grid w-full max-w-[860px] gap-3">
                                <Input.TextArea
                                    autoFocus
                                    value={pasteText}
                                    onChange={(event) => setPasteText(event.target.value)}
                                    placeholder={tr(
                                        "{0}\n\n包含“第一章 / 第1集 / Chapter 1”这类标题时会自动拆分；{1}也可以只放第 1 集，之后在制作台逐集追加。",
                                        SOURCE_FORMAT_LABEL[sourceFormat].placeholder,
                                        sourceFormat === "novel" ? "" : tr("每个标题就是一集，"),
                                    )}
                                    autoSize={{ minRows: 14, maxRows: 24 }}
                                />
                                <div className="flex justify-end gap-2">
                                    <Button onClick={() => setPasteMode(false)}>{tr("取消")}</Button>
                                    <Button type="primary" disabled={!pasteText.trim()} onClick={() => loadText(pasteText)}>
                                        {tr("解析正文")}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <span className="drama-drop-icon">
                                    <BookOpenText className="size-7" />
                                </span>
                                <h2>
                                    {tr("拖入")}
                                    {SOURCE_FORMAT_LABEL[sourceFormat].title}
                                    {tr("文件，剩下的交给流水线")}
                                </h2>
                                <p>
                                    {tr("TXT 或 Markdown，自动识别 GBK / UTF-8 编码与“第 N 章 / 第 N 集”标题。可以只放第 1 集，做完再在制作台追加下一集；")}
                                    {sourceFormat === "novel" ? tr("引号里的对白会逐字保留为台词。") : tr("台词逐字保留，不会被改写。")}
                                </p>
                                <Button type="primary" size="large" icon={<FileUp className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                                    {tr("选择")}
                                    {SOURCE_FORMAT_LABEL[sourceFormat].title}
                                    {tr("文件")}
                                </Button>
                                <button type="button" className="drama-link inline-flex items-center gap-1" onClick={() => setPasteMode(true)}>
                                    <ClipboardPaste className="size-3.5" />
                                    {tr("没有文件？直接粘贴")}
                                </button>
                                <div className="drama-drop-steps">
                                    {[sourceFormat === "storyboard" ? tr("导入分镜") : tr("解析分集"), tr("建立角色、道具与场景"), sourceFormat === "novel" ? tr("改编剧本与段提示词") : tr("拆镜与段提示词"), tr("按剧情段生成视频"), tr("合成成片")].map(
                                        (step, index) => (
                                            <span key={step}>
                                                <b>{index + 1}</b>
                                                {step}
                                            </span>
                                        ),
                                    )}
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".txt,.md,.markdown,text/plain,text/markdown"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void loadFile(file);
                                        event.target.value = "";
                                    }}
                                />
                            </>
                        )}
                    </div>
                </div>
            </WorkspacePage>
        );
    }

    return (
        <WorkspacePage fluid scroll={false}>
            <div className="drama-root drama-compose">
                {/* 左：小说目录 */}
                <aside className="drama-compose-novel">
                    <header className="drama-compose-head">
                        <Link to="/projects">
                            <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} aria-label={tr("返回作品列表")} />
                        </Link>
                        <h1>{tr("新建短剧")}</h1>
                        <Button size="small" type="text" className="!ml-auto" onClick={reset}>
                            {tr("换素材")}
                        </Button>
                    </header>
                    <div className="drama-stats">
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.chapters.length)}</div>
                            <div className="drama-stat-label">{perEpisode ? tr("段原文") : tr("章节")}</div>
                        </div>
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.words)}</div>
                            <div className="drama-stat-label">{tr("字")}</div>
                        </div>
                        <div className="drama-stat">
                            <div className="drama-stat-value">{estimate ? `≈${estimate.episodes}` : "—"}</div>
                            <div className="drama-stat-label">{tr("集")}</div>
                        </div>
                    </div>
                    {analysis.issues.length ? (
                        <div className="drama-issues">
                            {analysis.issues.map((issue) => (
                                <div key={issue.kind} className="drama-issue">
                                    <AlertTriangle className="size-3.5" />
                                    {issue.message}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div className="drama-chapter-list thin-scrollbar" role="listbox" aria-label={tr("章节")}>
                        {analysis.chapters.slice(0, 600).map((chapter, index) => (
                            <button
                                key={`${index}-${chapter.title}`}
                                type="button"
                                role="option"
                                aria-selected={index === previewIndex}
                                className={`drama-chapter-row ${(perEpisode ? sourceChars(chapter.text) > EPISODE_SOURCE_CHARS : chapter.words < 200) ? "is-warn" : ""}`}
                                onClick={() => setPreviewIndex(index)}
                            >
                                <span className="is-num">{String(index + 1).padStart(3, "0")}</span>
                                <span className="truncate text-left">{chapter.title}</span>
                                <span className="is-count">{formatCount(chapter.words)}</span>
                            </button>
                        ))}
                        {analysis.chapters.length > 600 ? (
                            <div className="px-4 py-3 text-center text-[var(--fs-tiny)] text-foreground/40">
                                {tr("另有")} {analysis.chapters.length - 600} {unitLabel}
                            </div>
                        ) : null}
                    </div>
                </aside>

                {/* 中：风格与审阅，下方原文预览 */}
                <main className="drama-compose-main thin-scrollbar">
                    <section>
                        <div className="drama-section-title">
                            <h2>{tr("素材与分集")}</h2>
                            <span>{sourceFormat === "novel" ? tr("引号里的对白逐字保留为台词，不会被改写") : tr("剧本与分镜每个标题就是一集，台词逐字保留")}</span>
                        </div>
                        <div className="grid gap-3">
                            <SourceFormatPicker value={sourceFormat} onChange={setSourceFormat} row />
                            {sourceFormat === "novel" ? (
                                <div className="drama-media-modes is-row is-two" role="radiogroup" aria-label={tr("分集方式")}>
                                    {EPISODE_MODES.map((mode) => (
                                        <button key={mode.value} type="button" role="radio" aria-checked={chapterMode === mode.value} className="drama-media-mode" onClick={() => setChapterMode(mode.value)}>
                                            <span className="drama-radio" />
                                            <span>
                                                <strong>
                                                    {mode.title}
                                                    {mode.value === "chapter" ? <em>{tr("推荐")}</em> : null}
                                                </strong>
                                                <span>{mode.detail}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </section>
                    <DramaStylePicker value={styleId} onChange={setStyleId} />
                    <section>
                        <div className="drama-section-title">
                            <h2>{tr("角色参考图方案")}</h2>
                            <span>{tr("参考图是每个镜头保持人物一致的锚点，开工后也能在设置里改")}</span>
                        </div>
                        <AssetSchemePicker value={assets} onChange={setAssetDraft} sample={{ style: style?.prompt || "", characterName: tr("主角"), sceneName: tr("主场景") }} layout="compact" />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>{tr("分镜规则")}</h2>
                            <span>{tr("决定剧情段多长、段内镜头节奏、台词密度与转场")}</span>
                        </div>
                        <StoryboardRules value={storyboard} onChange={setStoryboard} episodeSeconds={episodeSeconds} maxVideoSeconds={videoOption?.maxVideoSeconds} videoModelLabel={resolvedModels?.video?.label} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>{tr("视频提示词技能")}</h2>
                            <span>{tr("撰写每个剧情段的视频提示词时遵循的写作方法")}</span>
                        </div>
                        <PromptSkillField value={promptSkill} onChange={setPromptSkill} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>{tr("审阅方式")}</h2>
                            <span>{tr("只在关键点打断你")}</span>
                        </div>
                        <div className="drama-review-modes" role="radiogroup" aria-label={tr("审阅方式")}>
                            {REVIEW_MODES.map((mode) => (
                                <button key={mode.value} type="button" role="radio" aria-checked={reviewMode === mode.value} className="drama-review-mode" onClick={() => setReviewMode(mode.value)}>
                                    <span className="drama-radio" />
                                    <span>
                                        <strong>{mode.title}</strong>
                                        <span>{mode.detail}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                    {previewChapter ? (
                        <section className="drama-compose-preview">
                            <div className="drama-section-title">
                                <h2>{previewChapter.title}</h2>
                                <span>
                                    {tr("原文预览 ·")} {formatCount(previewChapter.words)} {tr("字")}
                                </span>
                            </div>
                            <div className="drama-compose-text thin-scrollbar">
                                {previewChapter.text.slice(0, 6000)}
                                {previewChapter.text.length > 6000 ? "……" : ""}
                            </div>
                        </section>
                    ) : null}
                </main>

                {/* 右：作品设置与启动 */}
                <aside className="drama-compose-side">
                    <div className="drama-compose-side-scroll thin-scrollbar">
                        <label className="block">
                            <div className="drama-option-label">{tr("作品名称")}</div>
                            <Input size="large" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={tr("作品名称")} />
                        </label>
                        <div>
                            <div className="drama-option-label">{tr("画幅")}</div>
                            <div className="drama-ratio-group" role="group" aria-label={tr("画幅")}>
                                {RATIOS.map((ratio) => (
                                    <button key={ratio.value} type="button" className="drama-ratio" aria-pressed={aspectRatio === ratio.value} onClick={() => setAspectRatio(ratio.value)}>
                                        <span className="drama-ratio-shape" style={{ width: ratio.w, height: ratio.h }} />
                                        {ratio.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="block">
                                <div className="drama-option-label">{tr("单集时长")}</div>
                                <EpisodeDurationInput value={episodeSeconds} onChange={setEpisodeSeconds} />
                            </div>
                            <label className="block">
                                <div className="drama-option-label">{tr("对白语言")}</div>
                                <Select className="w-full" value={language} onChange={setLanguage} options={LANGUAGES.map((value) => ({ value, label: value }))} />
                            </label>
                        </div>
                        <div>
                            <div className="drama-option-label">{tr("生成节奏")}</div>
                            <div className="drama-media-modes" role="radiogroup" aria-label={tr("生成节奏")}>
                                {(Object.keys(MEDIA_MODE_LABEL) as DramaMediaMode[]).map((mode) => (
                                    <button key={mode} type="button" role="radio" aria-checked={mediaMode === mode} className="drama-media-mode" onClick={() => setMediaMode(mode)}>
                                        <span className="drama-radio" />
                                        <span>
                                            <strong>
                                                {MEDIA_MODE_LABEL[mode].title}
                                                {mode === "manual" ? <em>{tr("推荐")}</em> : null}
                                            </strong>
                                            <span>{MEDIA_MODE_LABEL[mode].detail}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <section className="drama-compose-models" aria-label={tr("制作模型")}>
                            <div className="drama-compose-models-head">
                                <Wand2 className="size-4 text-[var(--workspace-accent)]" />
                                <strong>{tr("制作模型")}</strong>
                                <span>{catalogQuery.isLoading ? tr("正在读取可用模型…") : tr("已自动选好，可按需更换")}</span>
                            </div>
                            {(Object.keys(CAPABILITY_LABEL) as DramaCapability[]).map((capability) => (
                                <div key={capability} className="drama-compose-model-row">
                                    <span>{CAPABILITY_LABEL[capability]}</span>
                                    <DramaModelPicker
                                        capability={capability}
                                        size="sm"
                                        value={resolvedModels?.[capability]}
                                        placeholder={tr("选择{0}模型", CAPABILITY_LABEL[capability])}
                                        onChange={(choice) => setModels((current) => ({ ...current, [capability]: choice }))}
                                    />
                                </div>
                            ))}
                        </section>
                        {missingCapabilities.length ? (
                            <p className="flex items-start gap-2 text-[var(--fs-tiny)] leading-5 text-[var(--status-error)]">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                {tr("还没有可用的")}
                                {missingCapabilities.map((capability) => CAPABILITY_LABEL[capability]).join("、")}
                                {tr("模型，请联系管理员在后台开通。")}
                            </p>
                        ) : null}
                    </div>
                    <footer className="drama-compose-launch">
                        <div className="drama-compose-estimate">
                            <div>
                                <b>{estimate ? tr("{0} 集", estimate.episodes) : "—"}</b>
                                <span>
                                    {tr("约")} {estimate?.durationMinutes ?? "—"} {tr("分钟")}
                                </span>
                            </div>
                            <div>
                                <b>{estimate ? formatCount(estimate.shots) : "—"}</b>
                                <span>{tr("镜头")}</span>
                            </div>
                            <div>
                                <b>{estimate ? formatCount(estimate.videos) : "—"}</b>
                                <span>{tr("视频段")}</span>
                            </div>
                        </div>
                        {mediaMode === "manual" ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">{tr("开工只调用文本模型；剧本、设定与段提示词确认后，再逐集生成参考图与视频")}</div>
                        ) : reviewMode === "sample" ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">{tr("先做第 1 集样片，确认后再跑全剧")}</div>
                        ) : null}
                        {estimate?.note ? <div className="text-[var(--fs-micro)] text-foreground/40">{estimate.note}</div> : null}
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canStart} loading={create.isPending} onClick={() => create.mutate()}>
                            {mediaMode === "manual" ? tr("开始改编剧本与分镜") : tr("开始自动制作")}
                        </Button>
                    </footer>
                </aside>
            </div>
        </WorkspacePage>
    );
}
