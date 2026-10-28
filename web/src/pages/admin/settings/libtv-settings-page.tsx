import { currentLocale, tr } from "@/i18n";
import { App, Button, Input, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, BadgeCheck, CircleCheck, CloudDownload, KeyRound, RefreshCw, RotateCcw, Save, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminLibTVSetting, testAdminLibTV, updateAdminLibTVSetting, type AdminLibTVSetting } from "@/services/api/libtv";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type ConnectionTestStatus = "idle" | "testing" | "success" | "error";

export default function LibTVSettingsPage() {
    const { message, modal } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const [setting, setSetting] = useState<AdminLibTVSetting | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [token, setToken] = useState("");
    const [clearTokenDraft, setClearTokenDraft] = useState(false);
    const [testUuid, setTestUuid] = useState("");
    const [testStatus, setTestStatus] = useState<ConnectionTestStatus>("idle");
    const [testError, setTestError] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);

    const draftHasToken = Boolean(token.trim()) || Boolean(setting?.hasToken && !clearTokenDraft);
    const dirty = Boolean(setting && (enabled !== setting.enabled || Boolean(token.trim()) || clearTokenDraft));
    const enabledDirty = Boolean(setting && enabled !== setting.enabled);
    const credentialDraftLabel = token.trim() ? (setting?.hasToken ? tr("待替换") : tr("待新增")) : clearTokenDraft ? tr("待清除") : setting?.hasToken ? tr("已配置") : tr("未配置");

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminLibTVSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isAdminLibTVSetting(result.setting)) throw new Error(tr("服务端返回的 LibTV 配置格式无效"));
                setSetting(result.setting);
                setEnabled(result.setting.enabled);
                setToken("");
                setClearTokenDraft(false);
                setSaveError("");
                setTestStatus("idle");
                setTestError("");
                if (announce) message.success(tr("已重新读取第三方参数配置"));
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : tr("读取第三方参数配置失败");
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    const blocker = useBlocker(dirty && !saving);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);

    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: tr("放弃第三方参数调整？"),
            content: tr("当前页面有尚未保存的 LibTV 凭据或导入策略草稿，离开后这些内容会丢失。服务端正在使用的配置不会改变。"),
            okText: tr("放弃并离开"),
            cancelText: tr("继续编辑"),
            okButtonProps: { danger: true },
            onOk: () => {
                navigationConfirmOpenRef.current = false;
                navigationTriggerRef.current = null;
                blocker.proceed();
            },
            onCancel: () => {
                navigationConfirmOpenRef.current = false;
                blocker.reset();
                window.requestAnimationFrame(() => {
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-third-party-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        setEnabled(setting.enabled);
        setToken("");
        setClearTokenDraft(false);
        setSaveError("");
        message.info(tr("已撤销第三方参数的未保存调整"));
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: tr("放弃调整并重新读取？"),
            content: tr("重新读取会丢弃当前 LibTV 凭据和导入开关草稿，并以服务端配置为准。"),
            okText: tr("放弃并刷新"),
            cancelText: tr("继续编辑"),
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const changeToken = (nextToken: string) => {
        setToken(nextToken);
        if (nextToken.trim()) setClearTokenDraft(false);
        setSaveError("");
    };

    const changeEnabled = (nextEnabled: boolean) => {
        if (nextEnabled && !draftHasToken) {
            message.warning(tr("请先填写 LibTV Token，再启用画布导入"));
            return;
        }
        if (!setting || saving || nextEnabled === enabled) return;
        setEnabled(nextEnabled);
        setSaveError("");
    };

    const markTokenForRemoval = () => {
        setToken("");
        setClearTokenDraft(true);
        setEnabled(false);
        setSaveError("");
        message.info(tr("Token 已标记为待清除，点击保存修改前不会影响服务端配置"));
    };

    const restoreTokenDraft = () => {
        setClearTokenDraft(false);
        setSaveError("");
    };

    async function save() {
        if (!setting) return;
        const nextEnabled = enabled;
        const nextToken = token.trim();
        const clearToken = clearTokenDraft;
        const expectedHasToken = nextToken ? true : clearToken ? false : setting.hasToken;
        if (nextEnabled && !expectedHasToken) {
            message.error(tr("启用 LibTV 画布导入前必须配置 Token"));
            return;
        }
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminLibTVSetting({ enabled: nextEnabled, token: nextToken || undefined, clearToken: clearToken || undefined });
            if (!isAdminLibTVSetting(result.setting) || result.setting.enabled !== nextEnabled || result.setting.hasToken !== expectedHasToken) {
                throw new Error(tr("服务端返回的 LibTV 配置与本次保存内容不一致，请重新读取后核对"));
            }
            setSetting(result.setting);
            setEnabled(result.setting.enabled);
            setToken("");
            setClearTokenDraft(false);
            setTestStatus("idle");
            setTestError("");
            message.success(tr("第三方参数配置已保存"));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : tr("保存第三方参数配置失败");
            setSaveError(tr("{0}。未自动重试，请重新读取当前配置后再决定是否保存。", errorMessage));
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    }

    const submitSave = async () => {
        if (!setting || !dirty) return;
        const nextToken = token.trim();
        const expectedHasToken = nextToken ? true : clearTokenDraft ? false : setting.hasToken;
        if (enabled && !expectedHasToken) {
            message.error(tr("启用 LibTV 画布导入前必须配置 Token"));
            return;
        }
        try {
            await save();
        } catch {
            // 保存错误已在 save 中就地提示。
        }
    };

    const test = async () => {
        const uuid = testUuid.trim();
        if (!setting?.hasToken) {
            message.error(tr("请先保存 LibTV Token，再验证连接"));
            return;
        }
        if (!uuid) {
            message.error(tr("请填写用于验证的 LibTV 画布 UUID"));
            return;
        }
        setTestStatus("testing");
        setTestError("");
        try {
            await testAdminLibTV(uuid);
            setTestStatus("success");
            message.success(tr("已保存的 LibTV Token 可以读取该画布"));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : tr("LibTV 连接验证失败");
            setTestStatus("error");
            setTestError(errorMessage);
            message.error(errorMessage);
        }
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title={tr("第三方参数配置")} description={tr("先配置平台凭据，再决定是否开放用户导入")} scroll>
                <div className="admin-settings-stack admin-third-party-settings" aria-label={tr("正在读取第三方参数配置")} role="status">
                    <div className="admin-third-party-command-bar">
                        <Skeleton active title={{ width: 190 }} paragraph={false} />
                    </div>
                    <div className="admin-third-party-loading-card">
                        <Skeleton active paragraph={{ rows: 8 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title={tr("第三方参数配置")} description={tr("先配置平台凭据，再决定是否开放用户导入")} scroll>
                <div className="admin-settings-stack admin-third-party-settings">
                    <div className="admin-third-party-load-error" role="alert">
                        <span className="admin-third-party-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>{tr("无法读取第三方参数配置")}</h2>
                            <p>{loadError || tr("当前没有可显示的配置，请稍后重试。")}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                            {tr("重新读取")}
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    return (
        <AdminPageFrame title={tr("第三方参数配置")} description={tr("先配置平台凭据，再决定是否开放用户导入")} scroll>
            <div className="admin-settings-stack admin-third-party-settings">
                <div className={cn("admin-third-party-command-bar", dirty && "is-dirty")}>
                    <div className="admin-third-party-command-copy" aria-live="polite">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{dirty ? tr("第三方参数有调整待保存") : tr("第三方参数已与服务端同步")}</strong>
                                <AdminStatusBadge label={dirty ? tr("尚未生效") : tr("服务端当前值")} tone={dirty ? "warning" : "neutral"} />
                            </div>
                            <p>{dirty ? tr("凭据和导入开关只在本页暂存；保存前可撤销或重新读取。") : tr("当前仅接入 LibTV；凭据明文只提交到服务端，不会从接口回传。")}</p>
                        </div>
                    </div>
                    <div className="admin-third-party-command-actions">
                        {dirty ? (
                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                {tr("撤销调整")}
                            </Button>
                        ) : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                            {tr("刷新状态")}
                        </Button>
                    </div>
                </div>

                {loadError || saveError ? (
                    <div className="admin-third-party-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || tr("{0}。页面仍显示上一次成功读取的配置。", loadError)}</span>
                    </div>
                ) : null}

                <div id="admin-third-party-libtv" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-third-party-section admin-third-party-credential-section"
                        icon={<KeyRound className="size-4" aria-hidden="true" />}
                        title={tr("1. 配置 LibTV 服务端访问凭据")}
                        description={tr("Token 只提交到{0}服务端，保存后浏览器不会再收到或显示明文。", brandName)}
                        status={<AdminStatusBadge label={credentialDraftLabel} tone={clearTokenDraft ? "warning" : draftHasToken ? "success" : "neutral"} />}
                        footer={!draftHasToken ? <ThirdPartySaveFooter setting={setting} dirty={dirty} saving={saving} refreshing={refreshing} onReset={resetDraft} onSave={submitSave} /> : undefined}
                    >
                        <div className="admin-third-party-provider">
                            <div className="admin-third-party-provider-heading">
                                <span className="admin-third-party-provider-mark">L</span>
                                <div>
                                    <strong>LibTV</strong>
                                    <p>{tr("画布项目读取接入")}</p>
                                </div>
                            </div>
                            <div className="admin-third-party-provider-tags">
                                <AdminStatusBadge label={tr("服务端代理")} tone="info" />
                                <AdminStatusBadge label={tr("只读外部画布")} tone="neutral" />
                                <AdminStatusBadge label={draftHasToken ? tr("凭据就绪") : tr("缺少凭据")} tone={draftHasToken ? "success" : "warning"} />
                            </div>
                        </div>
                        <div className="admin-third-party-credential-panel">
                            <label className="admin-third-party-field-label" htmlFor="admin-libtv-token">
                                LibTV Token
                            </label>
                            <Input.Password
                                id="admin-libtv-token"
                                value={token}
                                onChange={(event) => changeToken(event.target.value)}
                                placeholder={setting.hasToken && !clearTokenDraft ? configuredSecretText : clearTokenDraft ? tr("已标记为清除，可输入新 Token 改为替换") : tr("输入 LibTV Token")}
                                disabled={saving || refreshing}
                                autoComplete="new-password"
                                aria-describedby="admin-libtv-token-help"
                            />
                            <div id="admin-libtv-token-help" className="admin-third-party-credential-state">
                                <span className={cn("admin-third-party-credential-indicator", draftHasToken && "is-ready", clearTokenDraft && "is-warning")}>
                                    {draftHasToken ? <CircleCheck className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
                                    {credentialDraftLabel}
                                </span>
                                <p>
                                    {token.trim()
                                        ? setting.hasToken
                                            ? tr("保存后替换服务端凭据；当前内容尚未提交。")
                                            : tr("保存后新增服务端凭据；当前内容尚未提交。")
                                        : clearTokenDraft
                                          ? tr("保存后清除 Token，并同时停用导入入口。")
                                          : setting.hasToken
                                            ? tr("留空保存会保留服务端已有 Token。")
                                            : tr("尚未配置 Token，无法启用或验证 LibTV 接入。")}
                                </p>
                            </div>
                            <div className="admin-third-party-credential-actions">
                                {clearTokenDraft ? (
                                    <Button icon={<RotateCcw className="size-4" />} disabled={saving || refreshing} onClick={restoreTokenDraft}>
                                        {tr("撤销清除")}
                                    </Button>
                                ) : setting.hasToken ? (
                                    <Button danger icon={<Trash2 className="size-4" />} disabled={saving || refreshing} onClick={markTokenForRemoval}>
                                        {tr("标记为清除")}
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </SettingsSectionCard>
                </div>

                {draftHasToken ? (
                    <div id="admin-third-party-access" className="admin-settings-anchor">
                        <SettingsSectionCard
                            className="admin-third-party-section admin-third-party-access-section"
                            icon={<CloudDownload className="size-4" aria-hidden="true" />}
                            title={tr("2. 是否开放用户导入 LibTV 画布")}
                            description={tr("控制创作台是否允许普通用户通过 UUID 发起新的 LibTV 画布导入。")}
                            status={<AdminStatusBadge label={enabledDirty ? (enabled ? tr("待开放") : tr("待关闭")) : enabled ? tr("入口开放") : tr("入口关闭")} tone={enabledDirty ? "warning" : enabled ? "success" : "neutral"} />}
                            footer={<ThirdPartySaveFooter setting={setting} dirty={dirty} saving={saving} refreshing={refreshing} onReset={resetDraft} onSave={submitSave} />}
                        >
                            <div className="admin-third-party-policy-control">
                                <div>
                                    <strong>{enabled ? tr("允许发起新的 LibTV 导入") : tr("不开放新的 LibTV 导入")}</strong>
                                    <p>{enabled ? tr("保存后，服务端会使用已保存的 Token 读取用户指定的画布。") : tr("已有导入节点与连线继续保留，不会被删除或转换。")}</p>
                                </div>
                                <div className="admin-third-party-policy-switch">
                                    <span>{enabled ? tr("开启") : tr("关闭")}</span>
                                    <Switch aria-label={tr("允许用户导入 LibTV 画布")} checked={enabled} disabled={saving || refreshing} onChange={changeEnabled} />
                                </div>
                            </div>
                            <div className="admin-third-party-flow" aria-label={tr("LibTV 画布导入链路")}>
                                <FlowStep icon={<KeyRound className="size-4" />} label={tr("服务端凭据")} detail={tr("Token 不回传")} />
                                <span aria-hidden="true">→</span>
                                <FlowStep icon={<Wifi className="size-4" />} label={tr("读取画布")} detail={tr("按 UUID 请求")} />
                                <span aria-hidden="true">→</span>
                                <FlowStep icon={<CloudDownload className="size-4" />} label={tr("导入{0}", brandName)} detail={tr("生成节点与连线")} />
                            </div>
                        </SettingsSectionCard>
                    </div>
                ) : null}

                {setting.hasToken && !clearTokenDraft ? (
                    <div id="admin-third-party-test" className="admin-settings-anchor">
                        <SettingsSectionCard
                            className="admin-third-party-section admin-third-party-test-card"
                            icon={<Wifi className="size-4" aria-hidden="true" />}
                            title={tr("3. 验证已保存的 LibTV 凭据")}
                            description={tr("使用服务端当前保存的 Token 发起一次只读请求，不会向 LibTV 或当前{0}画布写入内容。", brandName)}
                            status={<TestStatus status={testStatus} />}
                        >
                            <div className="admin-third-party-test-controls">
                                <div className="admin-third-party-test-input">
                                    <label htmlFor="admin-libtv-test-uuid">{tr("可访问的 LibTV 画布 UUID")}</label>
                                    <Input
                                        id="admin-libtv-test-uuid"
                                        value={testUuid}
                                        onChange={(event) => {
                                            setTestUuid(event.target.value);
                                            setTestStatus("idle");
                                            setTestError("");
                                        }}
                                        placeholder={tr("输入画布 UUID，仅用于本次只读验证")}
                                        disabled={testStatus === "testing"}
                                    />
                                </div>
                                <Button icon={<Wifi className="size-4" />} loading={testStatus === "testing"} disabled={!setting.hasToken || saving || refreshing} onClick={() => void test()}>
                                    {tr("验证连接")}
                                </Button>
                            </div>
                            <div className={cn("admin-third-party-test-note", testStatus === "error" && "is-error", testStatus === "success" && "is-success")} role={testStatus === "error" ? "alert" : "status"}>
                                {testStatus === "success" ? <BadgeCheck className="size-4" aria-hidden="true" /> : testStatus === "error" ? <AlertTriangle className="size-4" aria-hidden="true" /> : <Server className="size-4" aria-hidden="true" />}
                                <span>
                                    {testStatus === "success"
                                        ? tr("验证成功：服务端已保存的 Token 可以读取该画布。")
                                        : testStatus === "error"
                                          ? tr("验证失败：{0}", testError)
                                          : token.trim()
                                            ? setting.hasToken
                                                ? tr("当前输入的新 Token 尚未保存，本次验证仍会使用服务端原有 Token。")
                                                : tr("当前输入的 Token 尚未保存，请先保存修改后再验证连接。")
                                            : tr("验证会产生一次真实的外部只读请求，但不会保存画布内容。")}
                                </span>
                            </div>
                        </SettingsSectionCard>
                    </div>
                ) : null}
            </div>
        </AdminPageFrame>
    );
}

function ThirdPartySaveFooter({ setting, dirty, saving, refreshing, onReset, onSave }: { setting: AdminLibTVSetting; dirty: boolean; saving: boolean; refreshing: boolean; onReset: () => void; onSave: () => Promise<void> }) {
    return (
        <div className="admin-third-party-footer">
            <div className="admin-third-party-footer-note">
                <ShieldCheck className="size-4" aria-hidden="true" />
                <span>
                    {formatSettingTime(setting.updatedAt, tr("尚未保存 LibTV 配置"))} {tr("· 保存不会读取外部画布")}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {dirty ? (
                    <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={onReset}>
                        {tr("撤销")}
                    </Button>
                ) : null}
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || refreshing} onClick={() => void onSave()}>
                    {tr("保存修改")}
                </Button>
            </div>
        </div>
    );
}

function FlowStep({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
    return (
        <div className="admin-third-party-flow-step">
            <span>{icon}</span>
            <div>
                <strong>{label}</strong>
                <small>{detail}</small>
            </div>
        </div>
    );
}

function TestStatus({ status }: { status: ConnectionTestStatus }) {
    if (status === "testing") return <AdminStatusBadge label={tr("验证中")} tone="info" />;
    if (status === "success") return <AdminStatusBadge label={tr("本次验证成功")} tone="success" />;
    if (status === "error") return <AdminStatusBadge label={tr("本次验证失败")} tone="error" />;
    return <AdminStatusBadge label={tr("本会话尚未验证")} tone="neutral" />;
}

function isAdminLibTVSetting(value: unknown): value is AdminLibTVSetting {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<AdminLibTVSetting>;
    return typeof candidate.enabled === "boolean" && typeof candidate.hasToken === "boolean" && (candidate.updatedAt === undefined || typeof candidate.updatedAt === "string");
}

function hasValidSettingTime(value?: string) {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp > 0;
}

function formatSettingTime(value: string | undefined, fallback: string) {
    if (!hasValidSettingTime(value)) return fallback;
    return tr("更新于 {0}", new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value as string)));
}
