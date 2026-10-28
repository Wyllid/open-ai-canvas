import { currentLocale, tr } from "@/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Alert, App, Button, Drawer, Input, Skeleton, Tabs, Typography } from "antd";
import { AdminEmpty, AdminStatusBadge } from "@/pages/admin/components/admin-ui";
import { Activity, Clipboard, HardDriveUpload, Link2, RefreshCw, Save, Video } from "lucide-react";
import { getAdminApiLog, queryAdminApiLogTask, recoverAdminApiLogTaskMedia, recoverAdminApiLogVideoByURL, type ApiCallLog } from "@/services/api/auth";

export function ApiLogDetailDrawer({ logId, onClose, onLogUpdated }: { logId: string | null; onClose: () => void; onLogUpdated?: (log: ApiCallLog) => void }) {
    const { message } = App.useApp();
    const [log, setLog] = useState<ApiCallLog | null>(null);
    const [loading, setLoading] = useState(false);
    const [querying, setQuerying] = useState(false);
    const [providerRequestId, setProviderRequestId] = useState("");
    const [videoURL, setVideoURL] = useState("");
    const [resultText, setResultText] = useState("");

    const refresh = async (id: string) => {
        const refreshed = await getAdminApiLog(id);
        setLog(refreshed.log);
        setProviderRequestId(refreshed.log.providerRequestId || "");
        onLogUpdated?.(refreshed.log);
        return refreshed.log;
    };

    useEffect(() => {
        if (!logId) return;
        let active = true;
        setLoading(true);
        setLog(null);
        setResultText("");
        setVideoURL("");
        void getAdminApiLog(logId)
            .then((result) => {
                if (!active) return;
                setLog(result.log);
                setProviderRequestId(result.log.providerRequestId || "");
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : tr("读取请求详情失败")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [logId, message]);

    const runQuery = async () => {
        if (!log) return;
        setQuerying(true);
        setResultText("");
        try {
            const result = await queryAdminApiLogTask(log.id, providerRequestId.trim() || undefined);
            await refresh(log.id);
            if (result.recovered) {
                setResultText(tr("查询成功，视频已转存。"));
                message.success(tr("视频任务恢复成功"));
            } else {
                setResultText(tr("上游仍在生成中{0}。", result.providerStatus ? `（${result.providerStatus}）` : ""));
            }
        } catch (error) {
            setResultText(error instanceof Error ? error.message : tr("查询上游任务失败"));
        } finally {
            setQuerying(false);
        }
    };

    const runURLRecovery = async () => {
        if (!log || !videoURL.trim()) return;
        setQuerying(true);
        setResultText("");
        try {
            await recoverAdminApiLogVideoByURL(log.id, videoURL.trim(), providerRequestId.trim() || undefined);
            await refresh(log.id);
            setResultText(tr("视频已转存。"));
            message.success(tr("视频转存成功"));
        } catch (error) {
            setResultText(error instanceof Error ? error.message : tr("视频转存失败"));
        } finally {
            setQuerying(false);
        }
    };

    const runMediaRecovery = async () => {
        if (!log) return;
        setQuerying(true);
        setResultText("");
        try {
            await recoverAdminApiLogTaskMedia(log.id);
            await refresh(log.id);
            setResultText(tr("已重新排队保存作品。对象存储仍不可用时会先保存到服务器，稍后自动同步。"));
            message.success(tr("已重新排队保存作品"));
        } catch (error) {
            setResultText(error instanceof Error ? error.message : tr("恢复作品保存失败"));
        } finally {
            setQuerying(false);
        }
    };

    const title = log ? (
        <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-500/12 text-blue-500">
                <Activity className="size-[18px]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
                <div className="truncate text-[var(--fs-body)] font-semibold text-foreground">{tr("请求日志详情")}</div>
                <div className="mt-0.5 truncate text-xs font-normal text-foreground/50">
                    {capabilityText(log.capability)} · {log.model || tr("未识别模型")} · {formatTime(log.startedAt || log.createdAt)}
                </div>
            </div>
        </div>
    ) : tr("请求日志详情");

    return (
        <Drawer title={title} open={Boolean(logId)} onClose={onClose} size="min(1120px, 66vw)" destroyOnHidden className="api-log-detail-drawer-panel" rootClassName="admin-drawer api-log-detail-drawer">
            {loading ? <Skeleton active paragraph={{ rows: 10 }} /> : log ? <LogDetail log={log} providerRequestId={providerRequestId} videoURL={videoURL} resultText={resultText} querying={querying} onProviderRequestIdChange={setProviderRequestId} onVideoURLChange={setVideoURL} onQuery={runQuery} onRecoverURL={runURLRecovery} onRecoverMedia={() => void runMediaRecovery()} /> : <AdminEmpty size="compact" title={tr("没有请求详情")} />}
        </Drawer>
    );
}

type LogDetailProps = {
    log: ApiCallLog;
    providerRequestId: string;
    videoURL: string;
    resultText: string;
    querying: boolean;
    onProviderRequestIdChange: (value: string) => void;
    onVideoURLChange: (value: string) => void;
    onQuery: () => void;
    onRecoverURL: () => void;
    onRecoverMedia: () => void;
};

function LogDetail({ log, providerRequestId, videoURL, resultText, querying, onProviderRequestIdChange, onVideoURLChange, onQuery, onRecoverURL, onRecoverMedia }: LogDetailProps) {
    const mediaRecoverable = log.taskStatus === "failed" && Boolean(log.mediaStage) && log.mediaStage !== "completed";
    const providerStatus = log.providerStatus?.toLowerCase();
    const processing = ["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "");
    const failed = log.status === "failed" || ["failed", "cancelled", "expired"].includes(providerStatus || "");
    const status = failed ? { label: tr("失败"), tone: "error" as const } : processing ? { label: tr("处理中"), tone: "warning" as const } : { label: tr("成功"), tone: "success" as const };

    return (
        <div className="api-log-detail-body">
            <section className="api-log-detail-section">
                <div className="api-log-detail-section-heading">
                    <div>
                        <div className="api-log-detail-eyebrow">REQUEST OVERVIEW</div>
                        <h2>{tr("请求概览")}</h2>
                    </div>
                    <AdminStatusBadge label={status.label} tone={status.tone} />
                </div>
                <div className="api-log-detail-summary-grid">
                    <InfoItem label={tr("能力类型")} value={capabilityText(log.capability)} />
                    <InfoItem label={tr("请求阶段")} value={requestKindText(log.requestKind)} />
                    <InfoItem label={tr("模型 / 渠道")} value={`${log.model || tr("未识别模型")} / ${log.channelName || tr("未记录渠道")}`} />
                    <InfoItem label={tr("用户")} value={log.userDisplayName || log.userAccount || tr("未知用户")} detail={log.userAccount ? `@${log.userAccount}` : undefined} />
                    <InfoItem label={tr("任务状态")} value={mediaDeliveryText(log)} />
                    <InfoItem label={tr("请求 ID")} value={<CopyValue value={log.id} />} />
                    <InfoItem label={tr("任务 ID")} value={log.taskId ? <CopyValue value={log.taskId} /> : tr("未记录")} />
                    <InfoItem label={tr("供应商任务 ID")} value={log.providerRequestId ? <CopyValue value={log.providerRequestId} /> : tr("未记录")} />
                    <InfoItem label={tr("耗时")} value={<span className="tabular-nums">{formatDuration(log.durationMs)}</span>} />
                    <InfoItem label={tr("HTTP 状态")} value={log.statusCode || tr("未记录")} />
                    <InfoItem label={tr("请求地址")} value={<span className="break-all font-mono text-xs">{log.method} {log.path || tr("未记录")}</span>} />
                    <InfoItem label={tr("上游渠道 URL")} value={<span className="break-all font-mono text-xs">{log.upstreamUrl || tr("未记录")}</span>} />
                </div>
                {log.error || log.errorCode ? (
                    <div className="api-log-detail-error">
                        <div className="text-xs font-semibold text-red-500">{log.errorCode || `HTTP ${log.statusCode || tr("失败")}`}</div>
                        <div className="mt-1 text-sm text-foreground/70">{log.error || tr("上游未返回错误详情")}</div>
                    </div>
                ) : null}
            </section>

            {mediaRecoverable ? (
                <section className="api-log-detail-section api-log-recovery-section">
                    <div className="api-log-detail-section-heading">
                        <div className="flex items-center gap-2">
                            <div className="grid size-8 place-items-center rounded-md bg-amber-500/12 text-amber-500">
                                <HardDriveUpload className="size-4" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="api-log-detail-eyebrow">MEDIA DELIVERY</div>
                                <h2>{tr("作品保存恢复")}</h2>
                            </div>
                        </div>
                        <span className="text-xs text-foreground/45">{tr("作品已生成，不会重新生成")}</span>
                    </div>
                    <div className="api-log-recovery-body">
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>{tr("重新保存作品")}</span>
                                <small>{tr("重新保存已生成的作品")}</small>
                            </div>
                            <Button type="primary" icon={<Save className="size-3.5" />} loading={querying} onClick={() => onRecoverMedia()}>{tr("重新保存")}</Button>
                        </div>
                        {resultText ? <Alert className="api-log-recovery-result" type={resultText.includes("失败") || resultText.includes("错误") || resultText.includes("请") ? "error" : "success"} showIcon message={resultText} /> : null}
                    </div>
                </section>
            ) : null}

            {log.capability === "video" ? (
                <section className="api-log-detail-section api-log-recovery-section">
                    <div className="api-log-detail-section-heading">
                        <div className="flex items-center gap-2">
                            <div className="grid size-8 place-items-center rounded-md bg-violet-500/12 text-violet-500">
                                <Video className="size-4" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="api-log-detail-eyebrow">VIDEO RECOVERY</div>
                                <h2>{tr("视频任务恢复")}</h2>
                            </div>
                        </div>
                        <span className="text-xs text-foreground/45">{tr("失败任务可用")}</span>
                    </div>
                    <div className="api-log-recovery-body">
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>{tr("供应商任务 ID")}</span>
                                <small>{tr("默认使用当前记录，可手动覆盖")}</small>
                            </div>
                            <Input className="api-log-recovery-input" value={providerRequestId} onChange={(event) => onProviderRequestIdChange(event.target.value)} placeholder={tr("输入供应商任务 ID")} />
                            <Button icon={<RefreshCw className="size-3.5" />} loading={querying} onClick={onQuery}>{tr("自动查询")}</Button>
                            <Button type="primary" icon={<Save className="size-3.5" />} loading={querying} onClick={onQuery}>{tr("保存并查询")}</Button>
                        </div>
                        <div className="api-log-recovery-row">
                            <div className="api-log-recovery-label">
                                <span>{tr("视频 URL 转存")}</span>
                                <small>{tr("仅支持公网 HTTP / HTTPS 视频地址")}</small>
                            </div>
                            <Input className="api-log-recovery-input" prefix={<Link2 className="size-4 text-foreground/35" />} value={videoURL} onChange={(event) => onVideoURLChange(event.target.value)} placeholder="https://example.com/video.mp4" />
                            <Button icon={<Save className="size-3.5" />} loading={querying} disabled={!videoURL.trim()} onClick={onRecoverURL}>{tr("转存并回写")}</Button>
                        </div>
                        {resultText ? <Alert className="api-log-recovery-result" type={resultText.includes("失败") || resultText.includes("错误") ? "error" : resultText.includes("生成中") ? "warning" : "success"} showIcon message={resultText} /> : null}
                    </div>
                </section>
            ) : null}

            <section className="api-log-detail-section api-log-payload-section">
                <div className="api-log-detail-section-heading">
                    <div>
                        <div className="api-log-detail-eyebrow">RAW PAYLOAD</div>
                        <h2>{tr("请求报文")}</h2>
                    </div>
                    <span className="text-xs text-foreground/45">{log.requestBody || log.responseBody ? tr("可复制原始内容") : tr("暂无报文")}</span>
                </div>
                <Tabs items={[{ key: "request", label: tr("请求"), children: <PayloadPanel value={log.requestBody} empty={tr("该请求未记录请求报文")} /> }, { key: "response", label: tr("响应"), children: <PayloadPanel value={log.responseBody} empty={tr("该请求未记录响应报文")} /> }]} />
            </section>
        </div>
    );
}

function InfoItem({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
    return (
        <div className="api-log-detail-info-item">
            <div className="api-log-detail-info-label">{label}</div>
            <div className="api-log-detail-info-value">{value}</div>
            {detail ? <div className="api-log-detail-info-detail">{detail}</div> : null}
        </div>
    );
}

function CopyValue({ value }: { value: string }) {
    return (
        <Typography.Text className="api-log-copy-value" copyable={{ text: value, tooltips: [tr("复制"), tr("已复制")] }}>
            <code>{value}</code>
        </Typography.Text>
    );
}

function PayloadPanel({ value, empty }: { value?: string; empty: string }) {
    if (!value) return <AdminEmpty size="compact" title={empty} />;
    return (
        <div className="api-log-payload-wrap">
            <div className="api-log-payload-actions">
                <Typography.Text copyable={{ text: value, tooltips: [tr("复制报文"), tr("已复制")] }}>
                    <Clipboard className="mr-1 inline size-3.5" />{tr("复制报文")}
                </Typography.Text>
            </div>
            <pre className="api-log-payload">{value}</pre>
        </div>
    );
}

function mediaDeliveryText(log: ApiCallLog) {
    if (log.taskStatus === "succeeded") return log.mediaStage === "completed" ? tr("已保存并登记") : tr("任务成功");
    if (log.taskStatus === "failed") return tr("任务失败");
    return log.taskStatus || tr("未记录");
}

function requestKindText(value: ApiCallLog["requestKind"]) {
    const labels: Partial<Record<ApiCallLog["requestKind"], string>> = { create: tr("模型生成"), poll: tr("状态查询"), download: tr("结果下载"), upload: tr("上传 OSS"), local_save: tr("保存文件"), local_fallback: tr("本地兜底保存"), offload: tr("同步 OSS"), register: tr("登记素材"), repair: tr("结果修复") };
    return labels[value] || tr("上游请求");
}

function capabilityText(value: string) {
    return ({ text: tr("文本"), image: tr("图片"), video: tr("视频"), audio: tr("音频") } as Record<string, string>)[value] || tr("未知");
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString(currentLocale(), { hour12: false }) : "--";
}

function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return tr("{0} 秒", (value / 1_000).toFixed(value < 10_000 ? 1 : 0));
    return tr("{0} 分 {1} 秒", Math.floor(value / 60_000), Math.round((value % 60_000) / 1_000));
}
