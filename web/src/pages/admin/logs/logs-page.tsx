import { currentLocale, tr } from "@/i18n";
import { Alert, App, Button, Input, Modal, Segmented } from "antd";
import { IconButton } from "@/pages/admin/ui/controls";
import type { ColumnsType } from "antd/es/table";
import { Download, Eye, Play, Search, RefreshCw } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { MediaPreview } from "@/components/media-preview";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { mediaDeliverySummary } from "@/lib/generation-task-display";
import { batchRecoverAdminApiLogs, exportAdminApiLogs, listAdminApiLogs, type ApiCallLog } from "@/services/api/auth";
import { ApiLogDetailDrawer } from "../components/api-log-detail-drawer";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminBatchBar, AdminDataTable, AdminExportButton, AdminFilterChip, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { logStatus, normalizeLogView } from "./log-view";
import "./logs-page.css";
import { Select } from "@/components/ui/base/select";
import { AdminSearchInput } from "../components/admin-search-input";

export default function LogsPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const view = normalizeLogView(searchParams.get("view"));
    const status = normalizeStatus(searchParams.get("status"));
    const recordType = searchParams.get("recordType") === "download" ? "download" : searchParams.get("recordType") === "all" ? "all" : "request";
    const capability = normalizeCapability(searchParams.get("capability"));
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const debouncedKeyword = useDebouncedValue(keyword);
    const [logs, setLogs] = useState<ApiCallLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [retry, setRetry] = useState(0);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [detailLogId, setDetailLogId] = useState<string | null>(null);
    const [batchRecovering, setBatchRecovering] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; kind: "image" | "video"; title: string } | null>(null);
    const requestSequence = useRef(0);
    const hasFilters = Boolean(keyword || status !== "all" || recordType !== "request" || capability !== "all");

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = (key === "filter" && value === "") || (key === "status" && value === "all") || (key === "recordType" && value === "request") || (key === "capability" && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    useEffect(() => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setLoadError("");
        setLogs([]);
        setTotal(0);
        setSelectedIds([]);
        void listAdminApiLogs({ recordType, capability: capability === "all" ? undefined : capability, keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status, page, pageSize })
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setLogs(result.logs);
                setTotal(result.total);
                setSelectedIds([]);
                if (result.total > 0 && result.logs.length === 0 && page > 1) updateUrl({ page: 1 }, true);
            })
            .catch((error) => {
                if (sequence !== requestSequence.current) return;
                const text = error instanceof Error ? error.message : tr("读取请求明细失败");
                setLoadError(text);
                message.error(text);
            })
            .finally(() => sequence === requestSequence.current && setLoading(false));
        return () => { requestSequence.current += 1; };
    }, [debouncedKeyword, status, recordType, capability, page, pageSize, retry]);

    const fullColumns: ColumnsType<ApiCallLog> = [
        { title: tr("时间"), width: 168, render: (_, log) => <button type="button" className="admin-log-detail-link" aria-label={tr("查看请求 {0} 详情", log.id)} onClick={() => setDetailLogId(log.id)}>{formatTime(log.startedAt || log.createdAt)}</button> },
        {
            title: tr("用户"),
            width: 180,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate font-medium text-foreground/85">{log.userDisplayName || log.userAccount || tr("未知用户")}</div>
                    <div className="truncate text-xs text-foreground/45">{log.userAccount ? `@${log.userAccount}` : tr("账号未记录")}</div>
                </div>
            ),
        },
        {
            title: tr("渠道 / 模型"),
            width: 230,
            render: (_, log) => (
                <div className="min-w-0">
                    <div className="truncate text-foreground/78">{log.channelName || tr("未记录渠道")}</div>
                    <div className="truncate text-xs text-foreground/45" title={log.model}>
                        {log.model || tr("未识别模型")}
                    </div>
                </div>
            ),
        },
        { title: tr("能力"), dataIndex: "capability", width: 88, render: capabilityText },
        { title: tr("结果"), width: 118, render: (_, log) => <MediaResult log={log} onPreview={(url, kind) => setMediaPreview({ url, kind, title: tr("{0}结果", capabilityText(log.capability)) })} /> },
        { title: tr("请求阶段 / 状态"), width: 160, render: (_, log) => <CallStatus log={log} /> },
        {
            title: tr("错误信息"),
            width: 260,
            render: (_, log) =>
                log.status === "failed" || log.error || log.errorCode ? (
                    <div className="min-w-0" title={[log.errorCode, log.error].filter(Boolean).join(" · ")}>
                        <div className="truncate text-xs font-medium text-red-500">{log.errorCode || `HTTP ${log.statusCode || tr("失败")}`}</div>
                        <div className="line-clamp-2 text-xs leading-5 text-foreground/55">{log.error || tr("上游未返回错误详情")}</div>
                    </div>
                ) : (
                    <span className="text-foreground/30">--</span>
                ),
        },
        { title: tr("耗时"), dataIndex: "durationMs", width: 112, render: (value) => <span className="tabular-nums">{formatDuration(value)}</span> },
        {
            title: "Tokens",
            width: 166,
            render: (_, log) =>
                log.usageAvailable ? (
                    <div className="space-y-0.5 text-xs tabular-nums">
                        <div>
                            <span className="text-foreground/40">{tr("输入")}</span> {log.inputTokens.toLocaleString()}
                        </div>
                        <div>
                            <span className="text-foreground/40">{tr("输出")}</span> {log.outputTokens.toLocaleString()}
                        </div>
                        {log.cachedTokens > 0 ? (
                            <div>
                                <span className="text-foreground/40">{tr("缓存")}</span> {log.cachedTokens.toLocaleString()}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <span className="text-foreground/35">{tr("未返回")}</span>
                ),
        },
    ];

    const identityColumns: ColumnsType<ApiCallLog> = [
        { title: tr("时间 / 详情"), key: "time", width: 142, render: (_, log) => <button type="button" className="admin-log-detail-link" title={formatTime(log.startedAt || log.createdAt)} aria-label={tr("查看请求 {0} 详情", log.id)} onClick={() => setDetailLogId(log.id)}>{formatCompactTime(log.startedAt || log.createdAt)}</button> },
        { title: tr("状态"), key: "status", width: 88, render: (_, log) => <AdminStatusBadge {...logStatus(log)} /> },
        { title: tr("模型"), dataIndex: "model", width: 170, ellipsis: true, render: (value) => value || tr("未识别模型") },
        { title: tr("渠道"), dataIndex: "channelName", width: 116, ellipsis: true, render: (value) => value || tr("未记录渠道") },
        { title: tr("用户"), key: "user", width: 110, ellipsis: true, render: (_, log) => <span title={[log.userDisplayName, log.userAccount].filter(Boolean).join(" · ")}>{log.userDisplayName || log.userAccount || tr("未知用户")}</span> },
    ];
    const compactColumns: ColumnsType<ApiCallLog> = view === "usage" ? [
        ...identityColumns,
        { title: tr("耗时"), dataIndex: "durationMs", align: "right", width: 90, render: formatDuration },
        { title: tr("Tokens 入 / 出"), key: "usage", width: 142, render: (_, log) => log.usageAvailable ? `${log.inputTokens.toLocaleString()} / ${log.outputTokens.toLocaleString()}` : tr("未返回") },
    ] : [
        ...identityColumns,
        { title: tr("阶段"), key: "kind", width: 90, render: (_, log) => requestKindText(log.requestKind) },
        { title: tr("耗时"), dataIndex: "durationMs", align: "right", width: 90, render: formatDuration },
        { title: tr("错误摘要"), key: "error", ellipsis: true, render: (_, log) => <span className={logStatus(log).tone === "error" ? "admin-log-error" : undefined} title={[log.errorCode, log.error].filter(Boolean).join(" · ")}>{[log.errorCode, log.error].filter(Boolean).join(" · ") || (logStatus(log).tone === "error" ? tr("HTTP {0} · 未返回详情", log.statusCode || tr("失败")) : "—")}</span> },
    ];
    const baseColumns = view === "all" ? fullColumns : compactColumns;
    const columns: ColumnsType<ApiCallLog> = [...baseColumns, { title: tr("操作"), key: "actions", width: 126, fixed: "right", render: (_, log) => log.capability === "video" ? <Button type="link" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => setDetailLogId(log.id)}>{tr("恢复任务")}</Button> : <span className="text-foreground/30">--</span> }];

    const runBatchRecovery = async () => {
        const selectedLogs = logs.filter((log) => selectedIds.includes(log.id));
        const videoIds = selectedLogs.filter((log) => log.capability === "video").map((log) => log.id);
        const skipped = selectedIds.length - videoIds.length;
        if (videoIds.length === 0) { message.info(tr("所选记录中没有视频任务可恢复")); return; }
        setBatchRecovering(true);
        try {
            const result = await batchRecoverAdminApiLogs(videoIds);
            const totalSkipped = skipped + result.skipped;
            Modal.info({ title: tr("批量恢复处理结果"), width: 560, content: <div className="max-h-[50vh] space-y-2 overflow-auto"><div className="mb-3">{tr("成功")} {result.success} {tr("条，失败")} {result.failed} {tr("条，跳过")} {totalSkipped} {tr("条")}</div>{result.items.map((item) => <div key={item.logId} className="rounded border border-border/70 px-3 py-2 text-xs"><div className="font-mono">{item.logId}</div><div>{item.recovered ? tr("成功") : item.error?.startsWith("跳过") ? item.error : item.providerStatus ? tr("仍在生成中（{0}）", item.providerStatus) : tr("失败：{0}", item.error || tr("未恢复"))}</div></div>)}</div> });
            setRetry((value) => value + 1);
        } catch (error) { message.error(error instanceof Error ? error.message : tr("批量恢复失败")); }
        finally { setBatchRecovering(false); }
    };

    return (
        <AdminPageFrame
            title={tr("请求明细")}
            description={tr("模型生成与结果下载记录")}
            actions={
                <>
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>{tr("刷新列表")}</Button>
                <AdminExportButton
                    exportFile={() => exportAdminApiLogs({ recordType, capability: capability === "all" ? undefined : capability, keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status })}
                    fileName={() => tr("请求明细-{0}.csv", new Date().toISOString().slice(0, 10))}
                    label={tr("导出当前筛选")}
                    successMessage={tr("已按当前筛选导出请求明细")}
                    errorMessage={tr("导出请求明细失败")}
                />
                </>
            }
        >
            {loadError ? <Alert type="error" showIcon title={tr("请求明细读取失败")} description={loadError} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>{tr("重试")}</Button>} /> : null}
            <AdminDataTable
                className={view === "all" ? "admin-logs-full" : "admin-logs-compact"}
                trailing={<Segmented aria-label={tr("请求明细视图")} value={view} onChange={(value) => updateUrl({ view: value })} options={[{ label: tr("排障"), value: "troubleshoot" }, { label: tr("用量"), value: "usage" }, { label: tr("全部字段"), value: "all" }]} />}
                toolbar={
                    <AdminSearchInput
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={tr("搜索用户、渠道、模型、路径或请求号")}
                        onValueChange={(value) => updateUrl({ filter: value, page: 1 }, true)}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={tr("搜索：{0}", keyword)} onRemove={() => updateUrl({ filter: "", page: 1 })} /> : null}
                        {status !== "all" ? <AdminFilterChip label={tr("结果：{0}", status === "succeeded" ? tr("成功") : tr("失败"))} onRemove={() => updateUrl({ status: "all", page: 1 })} /> : null}
                        {capability !== "all" ? <AdminFilterChip label={tr("能力：{0}", capabilityText(capability))} onRemove={() => updateUrl({ capability: "all", page: 1 })} /> : null}
                    </>
                }
                toolbarFilters={
                    <>
                    <Select aria-label={tr("明细类型")} className="w-32" value={recordType} onChange={(value) => updateUrl({ recordType: value, page: 1 })} options={[{ label: tr("仅请求"), value: "request" }, { label: tr("仅下载"), value: "download" }, { label: tr("全部明细"), value: "all" }]} />
                    <Select aria-label={tr("能力类型")} className="w-28" value={capability} onChange={(value) => updateUrl({ capability: value, page: 1 })} options={[{ label: tr("全部能力"), value: "all" }, { label: tr("文本"), value: "text" }, { label: tr("图片"), value: "image" }, { label: tr("视频"), value: "video" }, { label: tr("音频"), value: "audio" }]} />
                    <Select
                        aria-label={tr("请求结果")}
                        className="w-32"
                        value={status}
                        onChange={(value) => updateUrl({ status: value, page: 1 })}
                        options={[
                            { label: tr("全部结果"), value: "all" },
                            { label: tr("成功"), value: "succeeded" },
                            { label: tr("失败"), value: "failed" },
                        ]}
                    />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={() => updateUrl({ filter: "", status: "all", recordType: "request", capability: "all", page: 1 })}
                batchActions={
                    <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}>
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={batchRecovering} onClick={() => void runBatchRecovery()}>{tr("批量恢复")}</Button>
                        <AdminExportButton
                            type="primary"
                            size="small"
                            exportFile={() => exportAdminApiLogs({ recordType, ids: selectedIds })}
                            fileName={() => tr("请求明细-已选{0}条.csv", selectedIds.length)}
                            label={tr("导出已选")}
                            successMessage={tr("已导出选中的 {0} 条请求明细", selectedIds.length)}
                            errorMessage={tr("导出请求明细失败")}
                        />
                    </AdminBatchBar>
                }
                skeletonColumns={10}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    rowSelection: { columnWidth: 36, selectedRowKeys: selectedIds, preserveSelectedRowKeys: false, onChange: (keys) => setSelectedIds(keys.map(String)) },
                    onRow: (log) => ({
                        onClick: (event) => {
                            if ((event.target as HTMLElement).closest("button,a,input,.ant-checkbox-wrapper")) return;
                            setDetailLogId(log.id);
                        },
                        className: "admin-table-clickable-row",
                    }),
                    columns,
                    tableLayout: "fixed",
                    dataSource: logs,
                    pagination: false,
                    scroll: { x: view === "all" ? 1901 : view === "usage" ? 1246 : 1186 },
                }}
                empty={loadError ? <span role="status">{tr("数据暂不可用，请重试")}</span> : <AdminTableEmpty filtered={hasFilters} />}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize })} />}
            />
            <ApiLogDetailDrawer logId={detailLogId} onClose={() => setDetailLogId(null)} onLogUpdated={(next) => setLogs((items) => items.map((item) => (item.id === next.id ? next : item)))} />
            <Modal
                title={mediaPreview?.title || tr("媒体预览")}
                open={Boolean(mediaPreview)}
                width={880}
                onCancel={() => setMediaPreview(null)}
                footer={
                    mediaPreview ? (
                        <Button icon={<Download className="size-4" />} onClick={() => downloadMedia(mediaPreview.url, mediaPreview.kind)}>
                            {tr("下载原文件")}
                        </Button>
                    ) : null
                }
                destroyOnHidden
            >
                {mediaPreview ? (
                    <MediaPreview
                        src={mediaPreview.url}
                        kind={mediaPreview.kind}
                        alt={mediaPreview.title}
                        controls={mediaPreview.kind === "video"}
                        className="max-h-[72vh] w-full bg-black object-contain"
                        fallbackClassName="min-h-[360px] rounded-lg bg-black/90 text-white/55"
                    />
                ) : null}
            </Modal>
        </AdminPageFrame>
    );
}

function positiveInt(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizePageSize(value: string | null) {
    const parsed = positiveInt(value, 20);
    return [20, 50, 100].includes(parsed) ? parsed : 20;
}
function normalizeCapability(value: string | null): "all" | "text" | "image" | "video" | "audio" { return value === "text" || value === "image" || value === "video" || value === "audio" ? value : "all"; }
function normalizeStatus(value: string | null): "all" | "succeeded" | "failed" {
    return value === "succeeded" || value === "failed" ? value : "all";
}
function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString(currentLocale(), { hour12: false }) : "--";
}
function formatCompactTime(value: string) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function capabilityText(value: string) {
    return ({ text: tr("文本"), image: tr("图片"), video: tr("视频"), audio: tr("音频") } as Record<string, string>)[value] || tr("未知");
}
function formatDuration(value: number) {
    if (value < 1_000) return `${value} ms`;
    if (value < 60_000) return tr("{0} 秒", (value / 1_000).toFixed(value < 10_000 ? 1 : 0));
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1_000);
    return tr("{0} 分 {1} 秒", minutes, seconds);
}


function MediaResult({ log, onPreview }: { log: ApiCallLog; onPreview: (url: string, kind: "image" | "video") => void }) {
    const url = log.mediaPreviewUrl;
    const kind = log.mediaPreviewKind;
    const [unavailableUrl, setUnavailableUrl] = useState("");
    if (!url || (kind !== "image" && kind !== "video")) return <span className="text-foreground/30">--</span>;
    const previewUnavailable = unavailableUrl === url;
    return (
        <div className="flex w-[90px] items-center gap-2">
            <button
                type="button"
                title={previewUnavailable ? tr("预览不可用，素材可能已删除") : tr("预览{0}", kind === "video" ? tr("视频") : tr("图片"))}
                aria-label={previewUnavailable ? tr("预览不可用，素材可能已删除") : tr("预览{0}", kind === "video" ? tr("视频") : tr("图片"))}
                disabled={previewUnavailable}
                className="group relative h-11 w-16 shrink-0 overflow-hidden rounded border border-border/75 bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onPreview(url, kind)}
            >
                <MediaPreview src={url} kind={kind} alt={tr("生成结果")} loading="lazy" className="size-full object-cover" fallbackClassName="text-white/55" fallbackLabel={tr("预览不可用")} onUnavailable={() => setUnavailableUrl(url)} />
                {!previewUnavailable ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
                        {kind === "video" ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
                    </span>
                ) : null}
                {!previewUnavailable && log.mediaCount > 1 ? <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/65 px-1 text-[var(--fs-micro)] leading-4 text-white">{log.mediaCount}</span> : null}
            </button>
            <IconButton size="sm" variant="ghost" icon={Download} onClick={() => downloadMedia(url, kind)} title={tr("下载原文件")} aria-label={tr("下载原文件")} />
        </div>
    );
}

function downloadMedia(url: string, kind: "image" | "video") {
    saveAs(url, `api-call-${kind}.${kind === "video" ? "mp4" : "png"}`);
}

function CallStatus({ log }: { log: ApiCallLog }) {
    return (
        <div>
            <div className="mb-1 text-xs font-medium text-foreground/70">{requestKindText(log.requestKind)}</div>
            <AdminStatusBadge {...logStatus(log)} />
            {log.mediaStage ? <div className="mt-1 text-xs text-foreground/60">{mediaDeliverySummary(log.taskStatus, log.mediaStage)}</div> : null}
            {log.capability === "video" ? <div className="mt-1 text-xs tabular-nums text-foreground/45">{tr("已轮询")} {log.pollCount || 0} {tr("次")}</div> : null}
        </div>
    );
}

function requestKindText(value: ApiCallLog["requestKind"]) {
    const labels: Partial<Record<ApiCallLog["requestKind"], string>> = { create: tr("模型生成"), poll: tr("状态查询"), download: tr("结果下载"), upload: tr("上传 OSS"), local_save: tr("保存文件"), local_fallback: tr("本地兜底保存"), offload: tr("同步 OSS"), register: tr("登记素材"), repair: tr("结果修复") };
    return labels[value] || tr("上游请求");
}
