import { currentLocale, tr } from "@/i18n";
import { App, Button, Input, Skeleton } from "antd";
import { AlertTriangle, Archive, BadgeCheck, Circle, ExternalLink, History, RefreshCw, RotateCcw, ServerCog, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { checkSystemUpdate, getSystemUpdateStatus, rollbackSystemUpdate, startSystemUpdate, type SystemUpdateStatus, type UpdatePhase } from "@/services/api/system-update";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";

const activePhases = new Set<UpdatePhase>(["checking", "preflight", "backing_up", "pulling", "draining", "migrating", "switching", "verifying", "rolling_back"]);

const phaseLabels: Record<UpdatePhase, string> = {
    idle: tr("等待检查"),
    checking: tr("正在检查"),
    ready: tr("可更新"),
    no_update: tr("已是最新"),
    preflight: tr("前置检查"),
    backing_up: tr("正在备份"),
    pulling: tr("拉取镜像"),
    draining: tr("停止旧服务"),
    migrating: tr("迁移数据库"),
    switching: tr("切换版本"),
    verifying: tr("健康验证"),
    succeeded: tr("更新成功"),
    rolling_back: tr("正在回退"),
    rolled_back: tr("已回退"),
    failed: tr("更新失败"),
    manual_intervention: tr("需人工介入"),
};

export default function SystemUpdatePage() {
    const { message, modal } = App.useApp();
    const [status, setStatus] = useState<SystemUpdateStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [starting, setStarting] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [loadError, setLoadError] = useState("");
    const mountedRef = useRef(true);

    const load = useCallback(async (initial = false) => {
        if (initial) setLoading(true);
        try {
            const next = await getSystemUpdateStatus();
            if (!mountedRef.current) return;
            setStatus(next);
            setLoadError("");
            setReconnecting(false);
        } catch (error) {
            if (!mountedRef.current) return;
            const errorMessage = error instanceof Error ? error.message : tr("读取系统更新状态失败");
            setLoadError(errorMessage);
            if (status && activePhases.has(status.operation.phase)) setReconnecting(true);
        } finally {
            if (mountedRef.current && initial) setLoading(false);
        }
    }, [status]);

    useEffect(() => {
        mountedRef.current = true;
        void load(true);
        return () => {
            mountedRef.current = false;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!status || !activePhases.has(status.operation.phase)) return;
        const timer = window.setInterval(() => void load(false), 2500);
        return () => window.clearInterval(timer);
    }, [load, status]);

    const operationActive = Boolean(status && activePhases.has(status.operation.phase));
    const blockingCheckFailed = status?.checks.some((check) => check.blocking && check.status === "failed") ?? true;

    const requestCheck = async () => {
        setChecking(true);
        try {
            const next = await checkSystemUpdate();
            setStatus(next);
            message.success(next.updateAvailable ? tr("发现新版本 {0}", next.latestRelease?.version) : tr("当前已是最新版本"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("检查更新失败"));
            await load(false);
        } finally {
            setChecking(false);
        }
    };

    const requestStart = () => {
        if (!status?.latestRelease) return;
        const target = status.latestRelease.version;
        modal.confirm({
            title: tr("更新到 {0}？", target),
            width: 560,
            content: (
                <div className="space-y-3 text-sm text-foreground/70">
                    <p>{tr("系统会先创建并校验数据库 ZIP 与数据目录备份，再停止旧服务、执行迁移并切换镜像。")}</p>
                    <p>{tr("更新期间站点会短暂不可用。任何前置检查失败都不会切换服务；切换后验证失败会自动恢复旧版本和数据库。")}</p>
                </div>
            ),
            okText: tr("确认并开始更新"),
            cancelText: tr("取消"),
            onOk: async () => {
                setStarting(true);
                try {
                    const next = await startSystemUpdate(target);
                    setStatus(next);
                    message.success(tr("更新任务已启动，页面会自动重连并显示进度"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : tr("无法开始更新"));
                    throw error;
                } finally {
                    setStarting(false);
                }
            },
        });
    };

    const requestRollback = () => {
        if (!status?.rollbackVersion) return;
        let reason = "";
        modal.confirm({
            title: tr("回退到 {0}？", status.rollbackVersion),
            width: 520,
            content: (
                <div className="space-y-3">
                    <p className="text-sm text-foreground/65">{tr("回退会停止当前服务、恢复最近一次已校验数据库备份并重新启动旧镜像。请先确认备份时间与业务影响。")}</p>
                    <Input.TextArea rows={3} maxLength={300} showCount placeholder={tr("填写回退原因（必填）")} onChange={(event) => (reason = event.target.value)} />
                </div>
            ),
            okText: tr("开始回退"),
            okButtonProps: { danger: true },
            cancelText: tr("取消"),
            onOk: async () => {
                if (!reason.trim()) {
                    message.warning(tr("请填写回退原因"));
                    throw new Error("rollback reason required");
                }
                const next = await rollbackSystemUpdate(reason.trim());
                setStatus(next);
                message.success(tr("回退任务已启动"));
            },
        });
    };

    if (loading) {
        return (
            <AdminPageFrame title={tr("系统更新")} description={tr("检查发布版本，并在备份、迁移和健康验证保护下完成在线更新。")} scroll>
                <div className="admin-settings-stack admin-system-update"><Skeleton active paragraph={{ rows: 12 }} /></div>
            </AdminPageFrame>
        );
    }

    return (
        <AdminPageFrame
            title={tr("系统更新")}
            description={tr("检查 GitHub Release，并在完成备份、迁移和健康验证后切换版本。")}
            scroll
            actions={
                <Button icon={<RefreshCw className="size-4" />} loading={checking} disabled={operationActive || !status?.supported} onClick={() => void requestCheck()}>
                    {tr("检查更新")}
                </Button>
            }
        >
            <div className="admin-settings-stack admin-system-update">
                {loadError && !status ? <UpdateAlert tone="error" title={tr("无法读取更新状态")} detail={loadError} /> : null}
                {!status?.supported ? <UpdateAlert tone="warning" title={tr("当前部署不支持后台在线更新")} detail={tr("请先在服务器安装 Host Updater，并重建 backend 容器挂载 Unix Socket。此状态下不会执行任何更新操作。")} /> : null}
                {reconnecting ? <UpdateAlert tone="warning" title={tr("服务正在切换，等待重新连接")} detail={tr("更新器运行在宿主机，后台页面暂时断线不会中止更新。连接恢复后会继续显示最终结果。")} /> : null}
                {status?.operation.phase === "manual_intervention" ? <UpdateAlert
                    tone="error"
                    title={status.operation.rollbackError ? tr("自动回退未完成，需要人工介入") : tr("应用已更新，Host Updater 需要人工处理")}
                    detail={status.operation.rollbackError || status.operation.error || tr("请检查 Host Updater 和容器日志。")}
                /> : null}

                <div className="admin-system-update-grid">
                    <SettingsSectionCard
                        className="admin-system-update-release"
                        layout="stacked"
                        icon={<ServerCog className="size-4" />}
                        title={tr("可用版本")}
                        description={status?.updateAvailable ? tr("当前运行 {0}，可更新到 {1}。", status.currentVersion, status.latestRelease?.version) : tr("检查 GitHub Release 与当前运行的镜像标签。")}
                        status={<PhaseBadge phase={status?.operation.phase ?? "idle"} />}
                        footer={
                            <>
                                <span className="text-xs leading-5 text-foreground/50">{tr("每次在线更新都会重新备份数据库，并校验镜像摘要、迁移结果和服务健康状态。")}</span>
                                <Button type="primary" loading={starting} disabled={!status?.connected || !status.updateAvailable || operationActive || blockingCheckFailed} onClick={requestStart}>
                                    {tr("开始更新")}
                                </Button>
                            </>
                        }
                    >
                        <div className="admin-system-update-release-body">
                            <div className="admin-system-update-versions">
                                <div>
                                    <span>{tr("当前运行")}</span>
                                    <strong>{status?.currentVersion || tr("未识别")}</strong>
                                    {status?.currentVersion && !isReleaseVersion(status.currentVersion) ? <AdminStatusBadge label={tr("非正式版本")} tone="warning" /> : null}
                                </div>
                                <div>
                                    <span>{tr("最新发布")}</span>
                                    <strong>{status?.latestRelease?.version || tr("尚未检查")}</strong>
                                    {status?.latestRelease?.prerelease ? <AdminStatusBadge label={tr("预览版")} tone="warning" /> : null}
                                    {status?.updateAvailable ? <AdminStatusBadge label={tr("可更新")} tone="success" /> : null}
                                </div>
                            </div>
                            {status?.updateAvailable && status.latestRelease ? (
                                <p className="admin-system-update-hint">
                                    {isReleaseVersion(status.currentVersion)
                                        ? tr("可以从 {0} 更新到 {1}。", status.currentVersion, status.latestRelease.version)
                                        : tr("当前镜像标签不是正式版本号，所以会显示成 {0}。点开始更新后会切换到 {1}。", status.currentVersion, status.latestRelease.version)}
                                </p>
                            ) : null}
                            <dl className="admin-system-update-facts">
                                <dt>{tr("部署方式")}</dt><dd>{status?.deployment || tr("未知")}</dd>
                                <dt>{tr("发布时间")}</dt><dd>{formatDate(status?.latestRelease?.publishedAt)}</dd>
                                <dt>{tr("代码仓库")}</dt><dd>{status?.repository || "ddcat-ai/open-ai-canvas"}</dd>
                            </dl>
                            {status?.latestRelease ? (
                                <div className="admin-system-update-notes">
                                    <div className="flex items-center justify-between gap-3"><h3>{tr("更新日志")}</h3><a href={status.latestRelease.url} target="_blank" rel="noreferrer">{tr("查看 Release")} <ExternalLink className="size-3" /></a></div>
                                    <pre>{status.latestRelease.body || tr("本版本未填写更新日志。")}</pre>
                                </div>
                            ) : null}
                        </div>
                    </SettingsSectionCard>

                    <SettingsSectionCard layout="stacked" icon={<ShieldCheck className="size-4" />} title={tr("更新前检查")} description={tr("所有阻断项通过后才允许切换服务。")} status={{ label: status?.connected ? tr("更新器已连接") : tr("更新器未连接"), color: status?.connected ? "success" : "error" }}>
                        <div className="admin-system-update-checks">
                            {(status?.checks || []).map((check) => <UpdateCheckRow key={check.key} check={check} />)}
                        </div>
                    </SettingsSectionCard>
                </div>

                <SettingsSectionCard layout="stacked" icon={<History className="size-4" />} title={tr("更新进度")} description={tr("操作状态和日志由宿主机持久化，服务重启后仍可读取。")} status={<PhaseBadge phase={status?.operation.phase ?? "idle"} />}>
                    <div className="admin-system-update-progress">
                        {status?.operation.error ? <UpdateAlert tone="error" title={tr("本次操作失败")} detail={status.operation.error} compact /> : null}
                        {(status?.operation.logs || []).length ? (
                            <ol>
                                {status?.operation.logs.map((entry, index) => (
                                    <li key={`${entry.at}-${index}`}><span className="admin-system-update-dot" data-active={index === status.operation.logs.length - 1} /><div><strong>{phaseLabels[entry.phase]}</strong><p>{entry.message}</p></div><time>{formatTime(entry.at)}</time></li>
                                ))}
                            </ol>
                        ) : <p className="admin-system-update-empty">{tr("检查更新后，这里会显示完整操作记录。")}</p>}
                    </div>
                </SettingsSectionCard>

                <SettingsSectionCard
                    layout="stacked"
                    icon={<Archive className="size-4" />}
                    title={tr("备份与回退")}
                    description={tr("只使用最近一次通过 ZIP 结构与 SHA-256 校验的备份。")}
                    status={{ label: status?.lastBackup ? tr("备份已校验") : tr("暂无备份"), color: status?.lastBackup ? "success" : "warning" }}
                    footer={
                        <>
                            <span className="text-xs text-foreground/50">{tr("人工回退同样会执行停服、数据库恢复、旧镜像启动和健康验证。")}</span>
                            <Button danger icon={<RotateCcw className="size-4" />} disabled={!status?.rollbackVersion || operationActive || !status?.connected} onClick={requestRollback}>{tr("回退到上一版本")}</Button>
                        </>
                    }
                >
                    <div className="admin-system-update-backup">
                        {status?.lastBackup ? <dl><dt>{tr("备份编号")}</dt><dd>{status.lastBackup.id}</dd><dt>{tr("来源版本")}</dt><dd>{status.lastBackup.version}</dd><dt>{tr("创建时间")}</dt><dd>{formatDate(status.lastBackup.createdAt)}</dd><dt>{tr("文件大小")}</dt><dd>{formatBytes(status.lastBackup.size)}</dd><dt>SHA-256</dt><dd className="admin-monospace">{status.lastBackup.checksum}</dd></dl> : <p>{tr("首次开始更新时会自动创建数据库与数据目录 ZIP；备份失败将直接中止更新。")}</p>}
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}

function PhaseBadge({ phase }: { phase: UpdatePhase }) {
    const tone = phase === "succeeded" || phase === "ready" ? "success" : phase === "failed" || phase === "manual_intervention" ? "error" : phase === "rolling_back" || phase === "rolled_back" ? "warning" : activePhases.has(phase) ? "info" : "neutral";
    return <AdminStatusBadge label={phaseLabels[phase]} tone={tone} />;
}

function UpdateCheckRow({ check }: { check: SystemUpdateStatus["checks"][number] }) {
    const Icon = check.status === "passed" ? BadgeCheck : check.status === "failed" ? AlertTriangle : Circle;
    return <div className="admin-system-update-check-row" data-status={check.status}><Icon className="size-4" /><div><strong>{check.label}</strong><p>{check.detail || tr("等待执行")}</p></div><span>{check.status === "passed" ? tr("通过") : check.status === "failed" ? tr("失败") : tr("待执行")}</span></div>;
}

function UpdateAlert({ tone, title, detail, compact = false }: { tone: "warning" | "error"; title: string; detail: string; compact?: boolean }) {
    return <div className={`admin-system-update-alert${compact ? " is-compact" : ""}`} data-tone={tone} role="alert"><AlertTriangle className="size-4" /><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

function formatDate(value?: string) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(currentLocale(), { hour12: false });
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString(currentLocale(), { hour12: false });
}

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}

function isReleaseVersion(value?: string) {
    return Boolean(value && /^v?\d+\.\d+\.\d+/.test(value));
}
