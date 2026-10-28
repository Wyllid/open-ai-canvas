import { currentLocale, tr } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { App, Button } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AlertCircle, CheckCircle2, Clock3, Copy, Crosshair, Loader2, XCircle } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { getDramaJob, type DramaJob, type DramaJobAttempt, type DramaJobTask } from "@/services/api/drama";

import { MediaThumb, useResourceMediaUrl } from "../drama-shared";

export const JOB_KIND_LABEL: Record<DramaJob["kind"], string> = {
    bible: tr("作品圣经"),
    plan: tr("分集规划"),
    cast_image: tr("参考图"),
    script: tr("剧本与分镜"),
    segment_prompt: "段视频提示词",
    segment_video: tr("段视频"),
    render: tr("合成成片"),
};

export const JOB_STATUS_LABEL: Record<string, string> = {
    queued: tr("排队中"),
    running: tr("生成中"),
    succeeded: tr("已完成"),
    failed: tr("失败"),
    canceled: tr("已取消"),
    cancelled: tr("已取消"),
    rejected: tr("提交被拒绝"),
};

export function JobStatusIcon({ status }: { status: string }) {
    if (status === "running") return <Loader2 className="size-3.5 animate-spin text-[var(--workspace-accent)]" />;
    if (status === "succeeded") return <CheckCircle2 className="size-3.5 text-[var(--status-success)]" />;
    if (status === "failed" || status === "rejected") return <XCircle className="size-3.5 text-[var(--status-error)]" />;
    if (status === "canceled" || status === "cancelled") return <XCircle className="size-3.5 opacity-35" />;
    return <Clock3 className="size-3.5 opacity-50" />;
}

export function formatJobTime(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return date.toLocaleString(currentLocale(), sameDay ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function elapsed(start?: string, end?: string) {
    if (!start || !end) return "";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (!Number.isFinite(ms) || ms < 0) return "";
    const seconds = Math.round(ms / 1000);
    return seconds >= 60 ? tr("{0} 分 {1} 秒", Math.floor(seconds / 60), seconds % 60) : tr("{0} 秒", seconds);
}

const PARAM_LABEL: Record<string, string> = {
    size: tr("尺寸"),
    imageResolution: tr("分辨率"),
    quality: tr("质量"),
    count: tr("张数"),
    videoSeconds: tr("时长（秒）"),
    vquality: tr("清晰度"),
    videoGenerateAudio: tr("同步生成声音"),
};

export function JobDetailModal({ projectId, job, onClose, onLocate }: { projectId: string; job?: DramaJob; onClose: () => void; onLocate: (job: DramaJob) => void }) {
    const query = useQuery({
        queryKey: ["drama", projectId, "job", job?.id],
        queryFn: ({ signal }) => getDramaJob(projectId, job!.id, signal),
        enabled: Boolean(job),
        refetchInterval: (state) => (state.state.data?.job.status === "running" || state.state.data?.job.status === "queued" ? 3_000 : false),
    });
    const detail = query.data;
    const current = detail?.job || job;
    return (
        <AppModal open={Boolean(job)} onCancel={onClose} footer={null} width={760} flush title={null} centered>
            {current ? (
                <div className="drama-jobd">
                    <header className="drama-jobd-head">
                        <span className={`drama-jobd-status is-${current.status}`}>
                            <JobStatusIcon status={current.status} />
                            {JOB_STATUS_LABEL[current.status]}
                        </span>
                        <div className="min-w-0 flex-1">
                            <h3 title={current.label}>{current.label}</h3>
                            <p>
                                {JOB_KIND_LABEL[current.kind]}
                                {detail?.target ? ` · ${detail.target}` : ""}
                            </p>
                        </div>
                        {current.episodeId ? (
                            <Button
                                size="small"
                                icon={<Crosshair className="size-3.5" />}
                                onClick={() => {
                                    onLocate(current);
                                    onClose();
                                }}
                            >
                                {tr("定位到镜头")}
                            </Button>
                        ) : null}
                    </header>
                    <dl className="drama-jobd-facts">
                        <div>
                            <dt>{tr("加入队列")}</dt>
                            <dd>{formatJobTime(current.createdAt)}</dd>
                        </div>
                        <div>
                            <dt>{tr("开始")}</dt>
                            <dd>{formatJobTime(current.startedAt)}</dd>
                        </div>
                        <div>
                            <dt>{tr("结束")}</dt>
                            <dd>
                                {formatJobTime(current.finishedAt)}
                                {elapsed(current.startedAt, current.finishedAt) ? (
                                    <small>
                                        {tr("用时")} {elapsed(current.startedAt, current.finishedAt)}
                                    </small>
                                ) : null}
                            </dd>
                        </div>
                        <div>
                            <dt>{tr("重试")}</dt>
                            <dd>
                                {current.attempt} {tr("次")}
                            </dd>
                        </div>
                    </dl>
                    <div className="drama-jobd-body thin-scrollbar">
                        {query.isLoading ? <div className="drama-jobd-empty">{tr("正在读取请求记录…")}</div> : null}
                        {detail && !detail.attempts.length ? <div className="drama-jobd-empty">{tr("还没有提交过请求，正在排队。")}</div> : null}
                        {detail?.attempts.map((attempt, index) => (
                            <AttemptCard key={`${attempt.taskId || "rejected"}-${attempt.at}`} attempt={attempt} index={detail.attempts.length - index} latest={index === 0} />
                        ))}
                    </div>
                </div>
            ) : null}
        </AppModal>
    );
}

function AttemptCard({ attempt, index, latest }: { attempt: DramaJobAttempt; index: number; latest: boolean }) {
    const { message } = App.useApp();
    const task = attempt.task;
    const copy = (text: string) =>
        void navigator.clipboard.writeText(text).then(
            () => message.success(tr("已复制")),
            () => message.error(tr("复制失败")),
        );
    return (
        <article className={`drama-jobd-attempt ${latest ? "is-latest" : ""}`}>
            <header>
                <span className="drama-jobd-attempt-index">
                    {tr("第")} {index} {tr("次")}
                </span>
                <JobStatusIcon status={attempt.status} />
                <strong>{JOB_STATUS_LABEL[attempt.status] || attempt.status}</strong>
                {task?.stage && attempt.status !== "succeeded" ? <span className="drama-jobd-muted">{task.stage}</span> : null}
                <span className="ml-auto drama-jobd-muted">
                    {formatJobTime(task?.createdAt || attempt.at)}
                    {elapsed(task?.startedAt, task?.completedAt) ? ` · ${elapsed(task?.startedAt, task?.completedAt)}` : ""}
                </span>
            </header>
            <dl className="drama-jobd-grid">
                <div>
                    <dt>{tr("模型")}</dt>
                    <dd title={task?.model}>{task?.modelLabel || "—"}</dd>
                </div>
                {task
                    ? Object.entries(task.params).map(([key, value]) => (
                          <div key={key}>
                              <dt>{PARAM_LABEL[key] || key}</dt>
                              <dd title={value}>{value}</dd>
                          </div>
                      ))
                    : null}
            </dl>
            {attempt.error ? (
                <div className="drama-jobd-error">
                    <AlertCircle className="size-4 shrink-0" />
                    <p>{attempt.error}</p>
                    <Tooltip title={tr("复制错误信息")}>
                        <Button size="small" type="text" icon={<Copy className="size-3.5" />} aria-label={tr("复制错误信息")} onClick={() => copy(attempt.error!)} />
                    </Tooltip>
                </div>
            ) : null}
            {task?.prompt ? (
                <details className="drama-disclosure">
                    <summary>
                        {tr("提示词")}
                        <span className="drama-jobd-muted">
                            {task.prompt.length} {tr("字")}
                        </span>
                        <Button
                            size="small"
                            type="text"
                            className="!ml-auto"
                            icon={<Copy className="size-3.5" />}
                            aria-label={tr("复制提示词")}
                            onClick={(event) => {
                                event.preventDefault();
                                copy(task.prompt);
                            }}
                        />
                    </summary>
                    <pre className="drama-jobd-pre thin-scrollbar">{task.prompt}</pre>
                </details>
            ) : null}
            {task ? <AttemptResult task={task} /> : null}
        </article>
    );
}

function AttemptResult({ task }: { task: DramaJobTask }) {
    const ids = task.resourceIds || [];
    if (task.resultText) {
        return (
            <details className="drama-disclosure">
                <summary>
                    {tr("返回结果")}
                    <span className="drama-jobd-muted">
                        {task.resultText.length} {tr("字")}
                    </span>
                </summary>
                <pre className="drama-jobd-pre thin-scrollbar">{task.resultText}</pre>
            </details>
        );
    }
    if (!ids.length)
        return task.mediaStage ? (
            <p className="drama-jobd-muted">
                {tr("结果保存阶段：")}
                {task.mediaStage}
            </p>
        ) : null;
    return (
        <div className="drama-jobd-results">
            {ids.map((id) =>
                task.resultMode === "video" ? (
                    <ResultVideo key={id} id={id} />
                ) : (
                    <div key={id} className="drama-jobd-thumb">
                        <MediaThumb resourceId={id} alt={tr("生成结果")} />
                    </div>
                ),
            )}
        </div>
    );
}

function ResultVideo({ id }: { id: string }) {
    const url = useResourceMediaUrl(id, "playback");
    return <div className="drama-jobd-thumb is-video">{url ? <video src={url} controls playsInline preload="metadata" /> : null}</div>;
}
