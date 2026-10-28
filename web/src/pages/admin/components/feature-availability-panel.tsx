import { tr } from "@/i18n";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, Clapperboard, ListChecks, MonitorCog, PlugZap, RadioTower, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { AdminStatusBadge } from "./admin-ui";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "customChannelsEnabled" | "inspirationSourcesVisible" | "frontendModelsEnabled" | "pluginCenterEnabled" | "systemPluginsVisibleToUsers" | "imageWorkbenchEnabled" | "videoWorkbenchEnabled";
type FeatureRow = {
    key: FeatureKey;
    title: string;
    description: string;
    icon: ReactNode;
    dependsOn?: FeatureKey;
};

const editableFeatureKeys: FeatureKey[] = [
    "shortDramaEnabled",
    "taskCenterEnabled",
    "customChannelsEnabled",
    "inspirationSourcesVisible",
    "imageWorkbenchEnabled",
    "videoWorkbenchEnabled",
    "frontendModelsEnabled",
    "pluginCenterEnabled",
    "systemPluginsVisibleToUsers",
];

const workspaceFeatureRows: FeatureRow[] = [
    {
        key: "shortDramaEnabled",
        title: tr("短剧创作"),
        description: tr("开放短剧入口、项目列表与项目详情。关闭不删除已有项目。"),
        icon: <Clapperboard className="size-4" aria-hidden="true" />,
    },
    {
        key: "taskCenterEnabled",
        title: tr("任务中心"),
        description: tr("开放任务记录页面。关闭不会停止生成任务。"),
        icon: <ListChecks className="size-4" aria-hidden="true" />,
    },
    {
        key: "customChannelsEnabled",
        title: tr("自定义渠道"),
        description: tr("允许用户配置并使用自己的模型渠道。"),
        icon: <RadioTower className="size-4" aria-hidden="true" />,
    },
    {
        key: "inspirationSourcesVisible",
        title: tr("素材来源署名"),
        description: tr("显示创作首页的素材来源说明；关闭后隐藏该面板。"),
        icon: <Sparkles className="size-4" aria-hidden="true" />,
    },
    {
        key: "imageWorkbenchEnabled",
        title: tr("图片生成"),
        description: tr("开放生图入口并允许创建新的工作台图片任务；关闭不删除结果和历史。"),
        icon: <Sparkles className="size-4" aria-hidden="true" />,
    },
    {
        key: "videoWorkbenchEnabled",
        title: tr("视频生成"),
        description: tr("开放视频入口并允许创建新的工作台视频任务；关闭不删除结果和历史。"),
        icon: <Clapperboard className="size-4" aria-hidden="true" />,
    },
];

const pluginFeatureRows: FeatureRow[] = [
    {
        key: "pluginCenterEnabled",
        title: tr("插件中心"),
        description: tr("开放插件中心及插件调用能力。"),
        icon: <PlugZap className="size-4" aria-hidden="true" />,
    },
    {
        key: "systemPluginsVisibleToUsers",
        title: tr("系统插件可见性"),
        description: tr("向普通用户展示系统协议插件和管理员上传插件。"),
        icon: <ShieldCheck className="size-4" aria-hidden="true" />,
        dependsOn: "pluginCenterEnabled",
    },
];

const modelFeatureRows: FeatureRow[] = [
    {
        key: "frontendModelsEnabled",
        title: tr("前台模型目录"),
        description: tr("选择前台模型目录，或直接使用系统渠道中的模型。"),
        icon: <Sparkles className="size-4" aria-hidden="true" />,
    },
];

const allFeatureRows = [...workspaceFeatureRows, ...pluginFeatureRows, ...modelFeatureRows];
const featureByKey = new Map(allFeatureRows.map((item) => [item.key, item]));

export default function FeatureAvailabilityPanel() {
    const { message, modal } = App.useApp();
    const setGlobalFeatures = useUserStore((state) => state.setFeatures);
    const [savedFeatures, setSavedFeatures] = useState<FeatureAvailability | null>(null);
    const [draftFeatures, setDraftFeatures] = useState<FeatureAvailability | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const requestVersionRef = useRef(0);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminFeatureAvailability();
                const value = parseFeatureAvailability(result.features);
                if (requestVersion !== requestVersionRef.current) return;
                setSavedFeatures(value);
                setDraftFeatures(value);
                setGlobalFeatures(value);
                setSaveError("");
                if (announce) message.success(tr("已重新读取当前功能状态"));
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : tr("读取功能开放配置失败");
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message, setGlobalFeatures],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    const setFeature = async (key: FeatureKey, enabled: boolean) => {
        if (!savedFeatures || saving || savedFeatures[key] === enabled) return;
        const previous = savedFeatures;
        const expected = { ...savedFeatures, [key]: enabled };
        setDraftFeatures(expected);
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminFeatureAvailability(toEditablePayload(expected));
            const value = parseFeatureAvailability(result.features);
            if (!sameEditableFeatures(value, expected)) throw new Error(tr("服务端返回的功能状态与本次保存内容不一致，请重新读取后核对"));
            setSavedFeatures(value);
            setDraftFeatures(value);
            setGlobalFeatures(value);
            message.success(tr("{0}已{1}", featureByKey.get(key)?.title || tr("功能"), enabled ? tr("开启") : tr("关闭")));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : tr("保存功能开放配置失败");
            setDraftFeatures(previous);
            setSaveError(tr("{0}。已恢复修改前状态。", errorMessage));
            message.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const requestFeatureChange = (key: FeatureKey, enabled: boolean) => {
        if (!savedFeatures || saving || savedFeatures[key] === enabled) return;
        if (key === "frontendModelsEnabled" && !enabled) {
            modal.confirm({
                title: tr("关闭前台模型功能？"),
                content: tr("关闭后用户将直接使用系统渠道中配置的模型；管理后台仍保留前台模型配置入口，重新开启后即可继续使用。"),
                okText: tr("确认关闭"),
                cancelText: tr("取消"),
                okButtonProps: { danger: true },
                onOk: () => setFeature(key, false),
            });
            return;
        }
        void setFeature(key, enabled);
    };

    if (loading && !draftFeatures) {
        return (
            <div className="admin-settings-stack admin-feature-availability" aria-label={tr("正在读取功能开放配置")} role="status">
                <div className="admin-feature-command-bar">
                    <Skeleton active title={{ width: 180 }} paragraph={false} />
                </div>
                <div className="admin-feature-board is-loading">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="admin-feature-domain">
                            <Skeleton active title={{ width: 120 }} paragraph={{ rows: 3 }} />
                        </div>
                    ))}
                </div>
                <div className="admin-feature-loading-card">
                    <Skeleton active paragraph={{ rows: 2 }} />
                </div>
            </div>
        );
    }

    if (!draftFeatures || !savedFeatures) {
        return (
            <div className="admin-settings-stack admin-feature-availability">
                <div className="admin-feature-load-error" role="alert">
                    <span className="admin-feature-load-error-icon">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                        <h2>{tr("无法读取功能开放配置")}</h2>
                        <p>{loadError || tr("当前没有可显示的配置，请稍后重试。")}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load(true)}>
                        {tr("重新读取")}
                    </Button>
                </div>
            </div>
        );
    }

    const enabledWorkspaceFeatures = workspaceFeatureRows.filter((row) => effectiveFeatureValue(draftFeatures, row.key)).length;
    const enabledPluginFeatures = pluginFeatureRows.filter((row) => effectiveFeatureValue(draftFeatures, row.key)).length;

    return (
        <div className="admin-settings-stack admin-feature-availability">
            <div className="admin-feature-command-bar">
                <div className="admin-feature-command-copy" aria-live="polite">
                    <div className="flex flex-wrap items-center gap-2">
                        <strong>{saving ? tr("正在保存更改") : tr("开关切换后立即生效")}</strong>
                        <AdminStatusBadge label={saving ? tr("提交中") : savedFeatures.configured ? tr("服务端配置") : tr("系统默认")} tone={saving ? "warning" : "neutral"} />
                    </div>
                </div>
                <div className="admin-feature-command-actions">
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={() => void load(false, true)}>
                        {tr("刷新状态")}
                    </Button>
                </div>
            </div>

            {loadError || saveError ? (
                <div className="admin-feature-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || tr("{0}。页面仍显示上一次成功读取的状态。", loadError)}</span>
                </div>
            ) : null}

            <div className="admin-feature-board" aria-label={tr("功能开放控制台")}>
                <FeatureDomainPanel
                    title={tr("1. 用户工作台入口")}
                    description={tr("先决定普通用户能进入哪些核心工作区")}
                    icon={<MonitorCog className="size-4" aria-hidden="true" />}
                    status={<AdminStatusBadge label={tr("{0}/7 开放", enabledWorkspaceFeatures)} tone={enabledWorkspaceFeatures === 5 ? "success" : "neutral"} />}
                >
                    {workspaceFeatureRows.map((row) => (
                        <FeatureSettingRow key={row.key} row={row} saved={savedFeatures} draft={draftFeatures} saving={saving} onChange={requestFeatureChange} />
                    ))}
                </FeatureDomainPanel>

                <FeatureDomainPanel
                    title={tr("2. 插件开放范围")}
                    description={tr("先开放插件中心，再决定系统插件是否可见")}
                    icon={<PlugZap className="size-4" aria-hidden="true" />}
                    status={<AdminStatusBadge label={tr("{0}/2 生效", enabledPluginFeatures)} tone={enabledPluginFeatures === 2 ? "success" : "neutral"} />}
                >
                    <FeatureSettingRow row={pluginFeatureRows[0]} saved={savedFeatures} draft={draftFeatures} saving={saving} onChange={requestFeatureChange} step={1} />
                    {draftFeatures.pluginCenterEnabled ? <FeatureSettingRow row={pluginFeatureRows[1]} saved={savedFeatures} draft={draftFeatures} saving={saving} onChange={requestFeatureChange} step={2} /> : null}
                </FeatureDomainPanel>

                <FeatureDomainPanel
                    title={tr("3. 用户模型来源")}
                    description={tr("决定用户选模型时读取前台目录还是系统渠道")}
                    icon={<Sparkles className="size-4" aria-hidden="true" />}
                    status={<AdminStatusBadge label={draftFeatures.frontendModelsEnabled ? tr("前台模型目录") : tr("系统渠道")} tone="info" />}
                >
                    <FeatureSourceRow row={modelFeatureRows[0]} saved={savedFeatures} draft={draftFeatures} saving={saving} onChange={requestFeatureChange} />
                </FeatureDomainPanel>
            </div>
        </div>
    );
}

function FeatureDomainPanel({ title, description, icon, status, children }: { title: string; description: string; icon: ReactNode; status: ReactNode; children: ReactNode }) {
    return (
        <section className="admin-feature-domain">
            <header className="admin-feature-domain-header">
                <span className="admin-feature-domain-icon">{icon}</span>
                <div className="admin-feature-domain-copy min-w-0 flex-1">
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
                <div className="admin-feature-domain-status">{status}</div>
            </header>
            <div className="admin-feature-domain-list">{children}</div>
        </section>
    );
}

function FeatureSettingRow({ row, saved, draft, saving, onChange, step }: { row: FeatureRow; saved: FeatureAvailability; draft: FeatureAvailability; saving: boolean; onChange: (key: FeatureKey, enabled: boolean) => void; step?: number }) {
    const changed = saved[row.key] !== draft[row.key];
    const dependencyDisabled = Boolean(row.dependsOn && !draft[row.dependsOn]);
    const enabled = effectiveFeatureValue(draft, row.key);

    return (
        <article className={cn("admin-feature-board-row", changed && "is-dirty", !enabled && "is-off", row.dependsOn && "is-dependent")}>
            <div className="admin-feature-board-row-copy">
                <span className="admin-feature-board-row-icon">{row.icon}</span>
                <span className="admin-feature-board-row-name">
                    {step ? <small>{tr("第 {0} 步", step)}</small> : null}
                    <strong>{row.title}</strong>
                    <span>{row.description}</span>
                </span>
                {changed ? <span className="admin-feature-board-row-dirty">{tr("待保存")}</span> : null}
            </div>
            <div className="admin-feature-board-row-control">
                <span>{dependencyDisabled ? tr("依赖未开启") : enabled ? tr("已开放") : tr("已关闭")}</span>
                <Switch checked={draft[row.key]} disabled={saving || dependencyDisabled} onChange={(checked) => onChange(row.key, checked)} aria-label={tr("设置{0}，切换后立即保存", row.title)} />
            </div>
        </article>
    );
}

function FeatureSourceRow({ row, saved, draft, saving, onChange }: { row: FeatureRow; saved: FeatureAvailability; draft: FeatureAvailability; saving: boolean; onChange: (key: FeatureKey, enabled: boolean) => void }) {
    const changed = saved.frontendModelsEnabled !== draft.frontendModelsEnabled;
    return (
        <article className={cn("admin-feature-board-row is-source", changed && "is-dirty")}>
            <div className="admin-feature-board-row-copy">
                <span className="admin-feature-board-row-icon">{row.icon}</span>
                <span className="admin-feature-board-row-name">
                    <small>{tr("模型来源")}</small>
                    <strong>{tr("用户模型目录")}</strong>
                    <span>{row.description}</span>
                </span>
                {changed ? <span className="admin-feature-board-row-dirty">{tr("待保存")}</span> : null}
            </div>
            <div className="admin-feature-board-source-selector" role="radiogroup" aria-label={tr("选择用户模型目录来源")}>
                <button type="button" role="radio" aria-checked={!draft.frontendModelsEnabled} disabled={saving} className={cn(!draft.frontendModelsEnabled && "is-selected")} onClick={() => onChange("frontendModelsEnabled", false)}>
                    {tr("系统渠道")}
                </button>
                <button type="button" role="radio" aria-checked={draft.frontendModelsEnabled} disabled={saving} className={cn(draft.frontendModelsEnabled && "is-selected")} onClick={() => onChange("frontendModelsEnabled", true)}>
                    {tr("前台目录")}
                </button>
            </div>
        </article>
    );
}

function effectiveFeatureValue(features: FeatureAvailability, key: FeatureKey) {
    if (key === "systemPluginsVisibleToUsers") return features.pluginCenterEnabled && features.systemPluginsVisibleToUsers;
    return features[key];
}

function toEditablePayload(features: FeatureAvailability) {
    return {
        shortDramaEnabled: features.shortDramaEnabled,
        taskCenterEnabled: features.taskCenterEnabled,
        customChannelsEnabled: features.customChannelsEnabled,
        inspirationSourcesVisible: features.inspirationSourcesVisible,
        imageWorkbenchEnabled: features.imageWorkbenchEnabled,
        videoWorkbenchEnabled: features.videoWorkbenchEnabled,
        frontendModelsEnabled: features.frontendModelsEnabled,
        pluginCenterEnabled: features.pluginCenterEnabled,
        systemPluginsVisibleToUsers: features.systemPluginsVisibleToUsers,
    };
}

function sameEditableFeatures(left: FeatureAvailability, right: FeatureAvailability) {
    return editableFeatureKeys.every((key) => left[key] === right[key]);
}

function parseFeatureAvailability(value: unknown): FeatureAvailability {
    if (!value || typeof value !== "object") throw new Error(tr("功能开放配置响应格式无效"));
    const record = value as Record<string, unknown>;
    for (const key of editableFeatureKeys) {
        if (typeof record[key] !== "boolean") throw new Error(tr("功能开放配置响应缺少有效开关状态"));
    }
    return {
        welcomeEnabled: record.welcomeEnabled as boolean,
        shortDramaEnabled: record.shortDramaEnabled as boolean,
        taskCenterEnabled: record.taskCenterEnabled as boolean,
        customChannelsEnabled: record.customChannelsEnabled as boolean,
        inspirationSourcesVisible: record.inspirationSourcesVisible as boolean,
        imageWorkbenchEnabled: record.imageWorkbenchEnabled as boolean,
        videoWorkbenchEnabled: record.videoWorkbenchEnabled as boolean,
        frontendModelsEnabled: record.frontendModelsEnabled as boolean,
        pluginCenterEnabled: record.pluginCenterEnabled as boolean,
        systemPluginsVisibleToUsers: record.systemPluginsVisibleToUsers as boolean,
        configured: typeof record.configured === "boolean" ? record.configured : undefined,
        updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
}
