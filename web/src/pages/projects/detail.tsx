import { tr } from "@/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button } from "antd";
import { ArrowLeft, CheckCheck, Clapperboard, Film, Inbox, Pause, Pencil, Play, ScrollText, Settings2, Sparkles, UsersRound } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { approveDramaEpisode, deleteDramaShot, generateDramaSegments, insertDramaShot, pauseDrama, reprocessDramaSegmentVideo, regenerateDramaCast, reviewDramaTake, selectDramaTake, releaseDramaMedia, renameDramaEpisode, rescriptDramaEpisode, retryFailedDrama, startDrama, updateDramaSegment, updateDramaSegmentReferences, writeDramaSegmentPrompts, updateDramaShot, type DramaInboxItem, type DramaJob, type DramaModelChoice, type DramaSegment, type DramaShot, type DramaShotPatch, type DramaTake } from "@/services/api/drama";

import { formatCount, formatDuration, sourceFormatOf, StagePips, STAGE_LABEL, STATUS_LABEL } from "./drama-shared";
import { CastPanel, InboxPanel, SettingsPanel } from "./studio/panels";
import { EpisodeRail } from "./studio/episode-rail";
import { AddEpisodeModal } from "./studio/episode-source";
import { FinalView } from "./studio/final-view";
import { StudioGenesis } from "./studio/genesis";
import { SegmentDialog } from "./studio/segment-dialog";
import type { TakeReviewInput } from "./studio/segment-takes";
import { QueueBar } from "./studio/queue-bar";
import { ScriptView } from "./studio/script-view";
import { Storyboard, type EpisodeEmpty } from "./studio/storyboard";
import { isTypingTarget, useDramaCast, useDramaEpisode, useDramaInvalidate, useDramaSummary } from "./studio/use-studio";
import { progressFillStyle } from "@/lib/progress-fill";
import "./drama.css";

type Tab = "board" | "script" | "final";
type StudioView = "production" | "cast" | "inbox" | "settings";

export default function DramaStudioPage() {
    const { projectId = "", episodeId: routeEpisodeId = "" } = useParams();
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = (["board", "script", "final"].includes(searchParams.get("tab") || "") ? searchParams.get("tab") : "board") as Tab;
    const shotParam = searchParams.get("shot") || "";
    const view = (["cast", "inbox", "settings"].includes(searchParams.get("view") || "") ? searchParams.get("view") : "production") as StudioView;
    const castFocus = searchParams.get("cast") || "";
    const [renaming, setRenaming] = useState(false);
    const [adding, setAdding] = useState(false);
    const invalidate = useDramaInvalidate(projectId);

    const summaryQuery = useDramaSummary(projectId);
    const summary = summaryQuery.data;
    const episodes = summary?.episodes || [];
    const episodeId = episodes.some((episode) => episode.id === routeEpisodeId) ? routeEpisodeId : (episodes.find((episode) => episode.stage === "review") || episodes.find((episode) => episode.stage !== "done") || episodes[0])?.id || "";
    const episodeRow = episodes.find((episode) => episode.id === episodeId);
    const awaitingCount = episodes.filter((episode) => episode.awaitingMedia).length;
    const running = summary?.production.status === "running";
    const episodeQuery = useDramaEpisode(projectId, episodeId, Boolean(running || (summary?.jobCounts.running || 0) > 0));
    const detail = episodeQuery.data?.episode.id === episodeId ? episodeQuery.data : undefined;
    const { cast, byId: castById } = useDramaCast(projectId, Boolean(running));
    const shots = useMemo(() => detail?.shots || [], [detail]);
    const currentShot = shots.find((shot) => shot.id === shotParam);

    const setParams = useCallback((patch: Record<string, string | null>) => {
        const next = new URLSearchParams(searchParams);
        for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
        }
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);
    const selectEpisode = useCallback((id: string) => {
        navigate({ pathname: `/projects/${projectId}/e/${id}`, search: tab === "board" ? "" : `?tab=${tab}` });
    }, [navigate, projectId, tab]);
    const segmentParam = searchParams.get("segment");
    const openSegmentIndex = segmentParam !== null && /^\d+$/.test(segmentParam) ? Number(segmentParam) : undefined;
    // 剧情段弹窗的打开状态放在地址里，刷新或从待处理跳转都能直接回到同一段、同一镜头。
    const openSegment = useCallback((index: number | null, shotId?: string) => setParams({ segment: index === null ? null : String(index), shot: index === null ? null : shotId || null }), [setParams]);
    const openView = useCallback((next: StudioView, extra: Record<string, string | null> = {}) => setParams({ view: next === "production" ? null : next, cast: null, ...extra }), [setParams]);

    // [ / ] 切换上一集 / 下一集。
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key !== "[" && event.key !== "]") return;
            const index = episodes.findIndex((episode) => episode.id === episodeId);
            const next = episodes[index + (event.key === "]" ? 1 : -1)];
            if (next) selectEpisode(next.id);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [episodeId, episodes, selectEpisode]);

    const errorMessage = (error: unknown, fallback: string) => message.error(error instanceof Error ? error.message : fallback);
    const toggleRun = useMutation({
        mutationFn: () => (running ? pauseDrama(projectId) : startDrama(projectId)),
        onSuccess: () => { invalidate(episodeId); message.success(running ? tr("已暂停，正在运行的任务完成后停止") : tr("已继续制作")); },
        onError: (error) => errorMessage(error, tr("操作失败")),
    });
    const patchShot = useMutation({
        mutationFn: ({ shot, patch }: { shot: DramaShot; patch: DramaShotPatch }) => updateDramaShot(projectId, shot.id, patch),
        onSuccess: () => { invalidate(episodeId); message.success(tr("已保存，本段提示词与视频已标记过期，请重新确认")); },
        onError: (error) => errorMessage(error, tr("保存失败")),
    });
    const insertShot = useMutation({
        mutationFn: ({ shot, position }: { shot: DramaShot; position: "before" | "after" }) => insertDramaShot(projectId, shot.id, position),
        onSuccess: ({ shot }) => { invalidate(episodeId); setParams({ shot: shot.id }); message.success(tr("已插入空镜头，填写动作或台词后本段提示词需重新撰写")); },
        onError: (error) => errorMessage(error, tr("插入失败")),
    });
    const removeShot = useMutation({
        mutationFn: (shot: DramaShot) => deleteDramaShot(projectId, shot.id),
        onSuccess: () => { invalidate(episodeId); setParams({ shot: null }); message.success(tr("已删除镜头，本段提示词与视频已标记过期")); },
        onError: (error) => errorMessage(error, tr("删除失败")),
    });
    const saveSegment = useMutation({
        mutationFn: ({ segment, override }: { segment: DramaSegment; override: string }) => updateDramaSegment(projectId, episodeId, segment.index, override),
        onSuccess: (_, { override }) => { invalidate(episodeId); message.success(override ? tr("已保存完整视频提示词") : tr("已恢复模型撰写的版本")); },
        onError: (error) => errorMessage(error, tr("保存失败")),
    });
    const saveReferences = useMutation({
        mutationFn: ({ segment, castIds }: { segment: DramaSegment; castIds: string[] | null }) => updateDramaSegmentReferences(projectId, episodeId, segment.index, castIds),
        onSuccess: (_, { castIds }) => { invalidate(episodeId); message.success(castIds ? tr("已更新本段参考图；参考图编号变了，请重新撰写视频提示词") : tr("已恢复按镜头自动取参考图")); },
        onError: (error) => errorMessage(error, tr("保存失败")),
    });
    const writeSegment = useMutation({
        mutationFn: (indexes: number[]) => writeDramaSegmentPrompts(projectId, episodeId, indexes),
        onSuccess: (result) => { invalidate(episodeId); message.success(tr("已开始撰写 {0} 段视频提示词", result.queued)); },
        onError: (error) => errorMessage(error, tr("操作失败")),
    });
    const approve = useMutation({
        mutationFn: () => approveDramaEpisode(projectId, episodeId),
        onSuccess: () => { invalidate(episodeId); message.success(episodeRow?.number === 1 && summary?.production.settings.reviewMode === "sample" ? tr("样片已确认，全剧开始自动制作") : tr("已通过，开始生成视频")); },
        onError: (error) => errorMessage(error, tr("操作失败")),
    });
    const generateSegments = useMutation({
        mutationFn: ({ segments, videoModel }: { segments: number[]; videoModel?: DramaModelChoice }) => generateDramaSegments(projectId, episodeId, segments, videoModel),
        onSuccess: (result, { segments }) => {
            invalidate(episodeId);
            const label = segments.length > 1 ? tr("{0} 段", segments.length) : tr("第 {0} 段", segments[0] + 1);
            message.success(tr("{0}已加入队列，共 {1} 个段视频", label, result.queued));
        },
        onError: (error) => errorMessage(error, tr("生成失败")),
    });
    const reprocessSegment = useMutation({
        mutationFn: (segmentIndex: number) => reprocessDramaSegmentVideo(projectId, episodeId, segmentIndex),
        onSuccess: (_, segmentIndex) => { invalidate(episodeId); message.success(tr("正在重新处理第 {0} 段视频", segmentIndex + 1)); },
        onError: (error) => { invalidate(episodeId); errorMessage(error, tr("重新处理失败")); },
    });
    const selectTake = useMutation({
        mutationFn: (take: DramaTake) => selectDramaTake(projectId, take.id),
        onSuccess: (result, take) => {
            invalidate(episodeId);
            if (result.warning) message.warning(result.warning, 8);
            else message.success(result.changed ? `Take ${take.version} is in the cut; the episode will be rendered again` : `Take ${take.version} is already in the cut`);
        },
        onError: (error) => { invalidate(episodeId); errorMessage(error, "Could not pick the take"); },
    });
    const reviewTake = useMutation({
        mutationFn: ({ take, review }: { take: DramaTake; review: TakeReviewInput }) => reviewDramaTake(projectId, take.id, review),
        onSuccess: (_, { take }) => { invalidate(episodeId); message.success(`Review of take ${take.version} saved`); },
        onError: (error) => errorMessage(error, "Could not save the review"),
    });
    const rescript = useMutation({
        mutationFn: () => rescriptDramaEpisode(projectId, episodeId),
        onSuccess: () => { invalidate(episodeId); setParams({ shot: null, segment: null }); message.success(running ? tr("正在重新改编本集") : tr("已继续制作，正在重新改编本集")); },
        // 剧本已重置但恢复制作被拒（如预算或模型不可用）时，也要刷新到真实状态。
        onError: (error) => { invalidate(episodeId); errorMessage(error, tr("操作失败")); },
    });
    const retry = useMutation({
        mutationFn: () => retryFailedDrama(projectId),
        onSuccess: (result) => { invalidate(episodeId); message.success(tr("已重新排队 {0} 项", result.segments + result.casts)); },
        onError: (error) => errorMessage(error, tr("重试失败")),
    });
    // 收件箱按组重试：设定重做参考图（不连带剧情段），剧情段失败统一重新排队。
    const [retryingGroup, setRetryingGroup] = useState("");
    const retryGroup = useMutation({
        mutationFn: async ({ items }: { key: string; items: DramaInboxItem[] }) => {
            const castIds = items.filter((item) => item.kind === "cast_failed" && item.castId).map((item) => item.castId!);
            await Promise.all(castIds.map((id) => regenerateDramaCast(projectId, id, false)));
            if(items.some(item=>item.kind==="segment_failed")) await retryFailedDrama(projectId);
            return items.length;
        },
        onMutate: ({ key }) => setRetryingGroup(key),
        onSettled: () => setRetryingGroup(""),
        onSuccess: (count) => { invalidate(episodeId); message.success(tr("已重新排队 {0} 项", count)); },
        onError: (error) => errorMessage(error, tr("重试失败")),
    });
    // 手动模式：先看剧本、设定与段提示词，确认后再逐集或全部开始生成参考图与段视频。
    const release = useMutation({
        mutationFn: ({ target, episodeIds }: { target: "assets" | "episodes" | "all"; episodeIds?: string[] }) => releaseDramaMedia(projectId, target, episodeIds),
        onSuccess: (_, { target }) => {
            invalidate(episodeId);
            message.success(target === "assets" ? tr("开始生成角色、道具与场景参考图") : target === "all" ? tr("全部集开始生成参考图与段视频") : tr("本集开始生成参考图与段视频"));
        },
        onError: (error) => errorMessage(error, tr("操作失败")),
    });
    const confirmReleaseAll = () => modal.confirm({
        title: tr("为 {0} 集开始生成视频？", awaitingCount),
        content: tr("会生成角色、道具与场景参考图，并按剧情段为这些集生成带对白与音效的视频，按实际用量计费。建议先挑一集生成，确认画风与角色形象后再全部开始。"),
        okText: tr("全部开始"),
        cancelText: tr("再看看"),
        centered: true,
        onOk: () => release.mutateAsync({ target: "all" }),
    });
    const rename = useMutation({
        mutationFn: (title: string) => renameDramaEpisode(projectId, episodeId, title),
        onSuccess: () => { invalidate(episodeId); setRenaming(false); },
        onError: (error) => errorMessage(error, tr("重命名失败")),
    });
    const busy = approve.isPending || rescript.isPending || generateSegments.isPending || release.isPending || insertShot.isPending || removeShot.isPending || saveReferences.isPending || selectTake.isPending || reviewTake.isPending;

    const openInbox = (item: DramaInboxItem) => {
        if (item.castId) { openView("cast", { cast: item.castId }); return; }
        if (item.kind === "paused") { openView("settings"); return; }
        if (item.episodeId) navigate({ pathname: `/projects/${projectId}/e/${item.episodeId}`, search: item.kind==="segment_failed" ? `?segment=${item.segmentIndex}` : "" });
    };
    const jumpToJob = (job: DramaJob) => {
        if (job.episodeId) navigate({ pathname: `/projects/${projectId}/e/${job.episodeId}`, search: "" });
    };

    if (summaryQuery.isLoading) return <WorkspacePage><WorkspaceLoadingState label={tr("正在打开制作台")} /></WorkspacePage>;
    if (summaryQuery.isError || !summary) return <WorkspacePage><WorkspaceErrorState title={tr("作品不可用")} description={tr("作品不存在、已被删除，或当前账号没有访问权限。")} actionLabel={tr("返回作品列表")} onRetry={() => navigate("/projects")} /></WorkspacePage>;

    const { production } = summary;
    const doneEpisodes = episodes.filter((episode) => episode.stage === "done" && !episode.finalStale).length;
    const progress = episodes.length ? doneEpisodes / episodes.length : 0;
    const aspectRatio = production.settings.aspectRatio;
    const sampleReview=production.settings.reviewMode==="sample"&&!production.sampleApproved&&detail?.episode.number===1&&detail.episode.stage==="done"&&!detail.episode.finalStale;
 const reviewing=sampleReview||(production.settings.reviewMode==="every"&&detail?.episode.stage==="review");
    // 手动模式下流水线可能在“运行”却无事可做：明确告诉用户在等他放行。
    const waitingForMedia = awaitingCount > 0 && !(summary.jobCounts.running || summary.jobCounts.queued) && production.status === "running";
    // 本集还没有镜头时按真实状态说明：失败、暂停、未开始、排队都不能显示成“正在编写”。
    const episodeEmpty: EpisodeEmpty = detail?.episode.error
        ? { title: tr("本集剧本编写失败"), text: tr("失败原因见上方提示。可以直接重新改编本集，或在底部队列全部重试。"), active: false, action: <Button type="primary" loading={rescript.isPending} onClick={() => rescript.mutate()}>{tr("重新改编本集")}</Button> }
        : production.status === "paused"
          ? { title: tr("制作已暂停，本集剧本还没开始写"), text: tr("继续制作后会立即为本集编写剧本与分镜。"), active: false, action: <Button type="primary" icon={<Play className="size-4" />} loading={toggleRun.isPending} onClick={() => toggleRun.mutate()}>{tr("继续制作")}</Button> }
          : production.status === "draft"
            ? { title: tr("制作还没开始"), text: tr("点击右上角“开始制作”后按集编写剧本与分镜。"), active: false }
            : detail?.episode.stage === "queued"
              ? { title: tr("排队等待改编"), text: tr("同时只改编少量集，前面的集写完剧本后会自动开始本集。"), active: false }
              : { title: tr("正在编写剧本与分镜"), text: tr("剧本按剧情段切分，每段生成一个带对白和镜头切换的视频。"), active: true };
    const sampleWaiting = production.settings.reviewMode === "sample" && !production.sampleApproved && episodeRow && episodeRow.number !== 1 && ["prompts","review","video"].includes(episodeRow.stage);

    return (
        <WorkspacePage className="!overflow-hidden" fluid scroll={false}>
            <div className="drama-root drama-studio">
                <header className="drama-topbar">
                    <Link to="/projects"><Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} aria-label={tr("返回作品列表")} /></Link>
                    <div className="drama-topbar-title">
                        <h1 title={summary.project.name}>{summary.project.name}</h1>
                        {waitingForMedia ? <span className="drama-chip is-ready"><span className="drama-dot" />{tr("剧本就绪 · 待生成视频")}</span> : <span className={`drama-chip is-${production.status}`}><span className="drama-dot" />{STATUS_LABEL[production.status]}</span>}
                    </div>
                    {episodes.length ? (
                        <div className="drama-topbar-progress">
                            <span className="drama-meter" aria-label={tr("成片进度 {0}%", Math.round(progress * 100))}><span style={progressFillStyle(Math.max(progress * 100, 2))} /></span>
                            <span>{doneEpisodes}/{tr("{0} 集成片", episodes.length)}{production.planDone ? "" : tr(" · 分集中")}</span>
                            <span>· {tr("{0} 章原文", formatCount(production.chapterCount))}</span>
                        </div>
                    ) : null}
                    <nav className="drama-nav" aria-label={tr("制作台视图")}>
                        <button type="button" className="drama-nav-item" aria-current={view === "production" ? "page" : undefined} onClick={() => openView("production")}><Clapperboard className="size-4" />{tr("制作")}</button>
                        <button type="button" className="drama-nav-item" aria-current={view === "cast" ? "page" : undefined} onClick={() => openView("cast")}><UsersRound className="size-4" />{tr("设定")}{summary.castCount ? <span className="drama-nav-count">{summary.castCount}</span> : null}</button>
                        <button type="button" className="drama-nav-item" aria-current={view === "inbox" ? "page" : undefined} onClick={() => openView("inbox")}><Inbox className="size-4" />{tr("待处理")}{summary.inbox.length ? <span className="drama-nav-count is-alert">{summary.inbox.length > 99 ? "99+" : summary.inbox.length}</span> : null}</button>
                        <button type="button" className="drama-nav-item" aria-current={view === "settings" ? "page" : undefined} onClick={() => openView("settings")}><Settings2 className="size-4" />{tr("设置")}</button>
                    </nav>
                    <div className="drama-topbar-actions">
                        {awaitingCount ? <Button icon={<Sparkles className="size-4" />} loading={release.isPending && release.variables?.target === "all"} onClick={confirmReleaseAll}>{tr("全部生成视频 · {0} 集", awaitingCount)}</Button> : null}
                        {production.status !== "completed" ? (
                            <Button type={running ? "default" : "primary"} icon={running ? <Pause className="size-4" /> : <Play className="size-4" />} loading={toggleRun.isPending} onClick={() => toggleRun.mutate()}>{running ? tr("暂停") : production.status === "draft" ? tr("开始制作") : tr("继续制作")}</Button>
                        ) : null}
                    </div>
                </header>

                {view === "cast" ? <CastPanel projectId={projectId} cast={cast} ratios={{ character: production.settings.assets.characterRatio }} focusId={castFocus} retrying={retry.isPending} assetsPending={production.settings.mediaMode === "manual" && !production.assetsReleased} releasing={release.isPending && release.variables?.target === "assets"} onReleaseAssets={() => release.mutate({ target: "assets" })} onFocus={(id) => setParams({ cast: id })} onRetry={() => retry.mutate()} onChanged={() => invalidate(episodeId)} />
                : view === "inbox" ? <InboxPanel items={summary.inbox} castById={castById} retrying={retry.isPending} retryingGroup={retryingGroup} releasing={release.isPending} onRetryAll={() => retry.mutate()} onRetryGroup={(key, items) => retryGroup.mutate({ key, items })} onOpen={openInbox} onOpenSettings={() => openView("settings")} onReleaseAll={confirmReleaseAll} />
                : view === "settings" ? <SettingsPanel projectId={projectId} summary={summary} cast={cast} onChanged={() => invalidate(episodeId)} />
                : !episodes.length ? <StudioGenesis summary={summary} /> : (
                    <div className={`drama-body is-inspector-hidden ${openSegmentIndex !== undefined ? "is-covered" : ""}`}>
                        <EpisodeRail episodes={episodes} currentId={episodeId} planning={!production.planDone} onSelect={selectEpisode} onAdd={() => setAdding(true)} />
                        <main className="drama-main">
                            {episodeRow ? (
                                <div className="drama-ep-header">
                                    <div className="drama-ep-heading">
                                        <div className="drama-eyebrow">{tr("第 {0} 集 · {1}", episodeRow.number, STAGE_LABEL[episodeRow.stage])}</div>
                                        {renaming ? (
                                            <div className="drama-title-editor">
                                                <input className="drama-title-input" autoFocus defaultValue={episodeRow.title} maxLength={60} aria-label={tr("集标题")} disabled={rename.isPending}
                                                    onFocus={(event) => event.currentTarget.select()}
                                                    onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== episodeRow.title) rename.mutate(title); else setRenaming(false); }}
                                                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(false); }} />
                                                <span className="drama-title-hint">{tr("回车保存 · Esc 取消")}</span>
                                            </div>
                                        ) : (
                                            <h2 title={episodeRow.title}>{episodeRow.title}<button type="button" className="drama-title-edit" aria-label={tr("重命名本集")} onClick={() => setRenaming(true)}><Pencil className="size-3.5" /></button></h2>
                                        )}
                                        <p>
                                            <span>{tr("{0} 镜", episodeRow.shotCount)}</span>
                                            {episodeRow.durationMs ? <span>{formatDuration(episodeRow.durationMs)}</span> : null}
                                            <StagePips episode={episodeRow} size="md" />
                                        </p>
                                    </div>
                                    <div className="drama-tabs" role="tablist" aria-label={tr("视图")}>
                                        <button type="button" role="tab" className="drama-tab" aria-selected={tab === "script"} onClick={() => setParams({ tab: "script" })}><ScrollText className="size-3.5" />{tr("剧本")}</button>
                                        <button type="button" role="tab" className="drama-tab" aria-selected={tab === "board"} onClick={() => setParams({ tab: null })}><Clapperboard className="size-3.5" />{tr("分镜")}</button>
                                        <button type="button" role="tab" className="drama-tab" aria-selected={tab === "final"} onClick={() => setParams({ tab: "final" })}><Film className="size-3.5" />{tr("成片")}</button>
                                    </div>
                                </div>
                            ) : null}
                            <div className="drama-banners">
                            {production.status === "paused" ? (
                                <div className="drama-banner">
                                    <div className="drama-banner-text"><strong>{tr("制作已暂停")}</strong><span title={production.pauseReason || undefined}>{production.pauseReason || tr("不会再派发新的生成任务；重新改编、生成视频或重试会自动继续制作。")}</span></div>
                                    <Button size="small" type="primary" icon={<Play className="size-3.5" />} loading={toggleRun.isPending} onClick={() => toggleRun.mutate()}>{tr("继续制作")}</Button>
                                </div>
                            ) : null}
                            {episodeRow?.awaitingMedia ? (
                                <div className="drama-banner is-ready">
                                    <Sparkles className="size-5 shrink-0 text-[var(--workspace-accent)]" />
                                    <div className="drama-banner-text">
                                        <strong>{tr("剧本与视频提示词已就绪，还没有生成视频")}</strong>
                                        <span>{tr("先看看剧情、镜头拆分、设定和各段视频提示词是否合适；可以改台词、动作、外观或直接改提示词，确认后再生成本集的参考图与段视频。")}</span>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        {tab !== "script" ? <Button onClick={() => setParams({ tab: "script" })}>{tr("看剧本与原文")}</Button> : null}
                                        <Button type="primary" icon={<Sparkles className="size-4" />} loading={release.isPending && release.variables?.target === "episodes"} onClick={() => release.mutate({ target: "episodes", episodeIds: [episodeRow.id] })}>{tr("生成本集视频")}</Button>
                                    </div>
                                </div>
                            ) : null}
                            {reviewing ? (
                                <div className="drama-banner is-info">
                                    <CheckCheck className="size-5 shrink-0 text-[var(--workspace-accent)]" />
                                    <div className="drama-banner-text">
                                        <strong>{sampleReview ? tr("第 1 集样片已完成，确认画风与角色形象") : tr("本集视频提示词已就绪，等待你的确认")}</strong>
                                        <span>{sampleReview ? tr("在成片页看样片；满意后确认，其余各集会全自动跑完。") : tr("核对各段提示词与参考图，可改镜头脚本或直接改提示词；确认后按剧情段顺序生成视频。")}</span>
                                    </div>
                                    <Button type="primary" loading={approve.isPending} onClick={() => approve.mutate()}>{sampleReview ? tr("确认样片，继续全剧") : tr("确认，生成视频")}</Button>
                                </div>
                            ) : null}
                            {sampleWaiting ? <div className="drama-banner is-info"><div className="drama-banner-text"><strong>{tr("剧本已就绪，等待样片确认")}</strong><span>{tr("第 1 集样片确认后，本集会按剧情段顺序生成视频。")}</span></div><Button size="small" onClick={() => selectEpisode(episodes[0].id)}>{tr("去看样片")}</Button></div> : null}
                            {detail?.episode.error ? (
                                <div className="drama-banner is-error">
                                    <div className="drama-banner-text"><strong>{tr("本集遇到问题")}</strong><span>{detail.episode.error}</span></div>
                                    <span className="text-[var(--fs-tiny)] text-foreground/50">{tr("可在底部队列“全部重试”")}</span>
                                </div>
                            ) : null}
                            </div>
                            <div className="drama-scroll thin-scrollbar">
                                {!detail ? <WorkspaceLoadingState label={tr("正在读取本集")} rows={2} /> : tab === "board" ? (
                                    <Storyboard
                                        shots={shots}
                                        segments={detail.segments}
                                        aspectRatio={aspectRatio}
                                        castById={castById}
                                        defaultVideoModel={production.settings.models.video}
                                        busy={busy}
                                        keyboardEnabled={openSegmentIndex === undefined && view === "production"}
                                        onOpen={openSegment}
                                        onGenerate={(segments, videoModel) => generateSegments.mutate({ segments, videoModel })}
                                        onReprocess={(index) => reprocessSegment.mutate(index)}
                                        reprocessing={reprocessSegment.isPending ? reprocessSegment.variables : undefined}
                                        onWritePrompts={(indexes) => writeSegment.mutate(indexes)}
                                        empty={episodeEmpty}
                                    />
                                ) : tab === "script" ? (
                                    <ScriptView
                                        projectId={projectId}
                                        detail={detail}
                                        storyboard={production.settings.storyboard}
                                        currentId={currentShot?.id || ""}
                                        busy={busy}
                                        onCurrent={(id) => setParams({ shot: id })}
                                        onRescript={() => rescript.mutate()}
                                        onPatchShot={(shot, patch) => patchShot.mutate({ shot, patch })}
                                        onInsertShot={(shot, position) => insertShot.mutate({ shot, position })}
                                        onDeleteShot={(shot) => removeShot.mutate(shot)}
                                        onSourceSaved={(again) => { invalidate(episodeId); if (again) rescript.mutate(); }}
                                        empty={episodeEmpty}
                                    />
                                ) : (
                                    <FinalView title={summary.project.name} detail={detail} aspectRatio={aspectRatio} onOpenSegment={(index) => setParams({ tab: null, segment: String(index), shot: null })} />
                                )}
                            </div>
                        </main>
                        <SegmentDialog
                            detail={tab === "board" ? detail : undefined}
                            segmentIndex={openSegmentIndex}
                            shotId={currentShot?.id}
                            castById={castById}
                            aspectRatio={aspectRatio}
                            busy={busy}
                            writing={writeSegment.isPending}
                            onClose={() => openSegment(null)}
                            onNavigate={openSegment}
                            onPatchShot={(shot, patch) => patchShot.mutate({ shot, patch })}
                            onSavePrompt={(segment, override) => saveSegment.mutate({ segment, override })}
                            onSaveReferences={(segment, castIds) => saveReferences.mutate({ segment, castIds })}
                            onWritePrompt={(segment) => writeSegment.mutate([segment.index])}
                            onGenerate={(segment, videoModel) => generateSegments.mutate({ segments: [segment.index], videoModel })}
                            reprocessing={reprocessSegment.isPending}
                            onReprocess={(segment) => reprocessSegment.mutate(segment.index)}
                            onSelectTake={(take) => selectTake.mutate(take)}
                            onReviewTake={(take, review) => reviewTake.mutate({ take, review })}
                            defaultVideoModel={production.settings.models.video}
                            onOpenCast={(id) => openView("cast", { cast: id, segment: null, shot: null })}
                        />
                    </div>
                )}

                <QueueBar projectId={projectId} summary={summary} retrying={retry.isPending} onRetry={() => retry.mutate()} onJump={jumpToJob} />
                <AddEpisodeModal
                    open={adding}
                    projectId={projectId}
                    nextNumber={(episodes[episodes.length - 1]?.number || 0) + 1}
                    defaultFormat={sourceFormatOf(episodes[episodes.length - 1]?.sourceFormat)}
                    blockedReason={production.planDone ? undefined : tr("前面的章节还在分集规划，完成后才能追加新的一集。")}
                    onClose={() => setAdding(false)}
                    onAdded={(id) => { setAdding(false); invalidate(id); selectEpisode(id); }}
                />
            </div>
        </WorkspacePage>
    );
}
