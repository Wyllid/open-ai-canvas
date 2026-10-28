import { tr } from "@/i18n";
import { ConfigProvider } from "antd";
import {
    Activity,
    BarChart3,
    Boxes,
    Brain,
    Bug,
    Cloud,
    CloudUpload,
    Database,
    FileClock,
    HardDrive,
    History,
    KeyRound,
    Layers3,
    MessageSquareText,
    Paintbrush,
    Palette,
    PlugZap,
    RadioTower,
    RefreshCw,
    Search,
    Settings2,
    ShieldAlert,
    SlidersHorizontal,
    Sparkles,
    ToggleLeft,
    UserRound,
    WandSparkles,
    Workflow,
    X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { AppFeedbackProvider } from "@/components/layout/app-feedback";
import { AppModal } from "@/components/ui/product/app-modal";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { settingsClosedSearch, settingsSearch, type SettingsSectionKey } from "@/lib/settings-navigation";
import { cn } from "@/lib/utils";
import { AdminProvider } from "@/pages/admin/admin-context";
import { AdminDensityProvider, useAdminDensity } from "@/pages/admin/components/admin-density";
import { getIsolatedAdminAntTheme } from "@/pages/admin/theme/admin-ant-theme";
import type { PersonalSettingsSection } from "@/pages/settings";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/styles/admin-ui.css";
import "@/pages/admin/theme/admin-tokens.css";
import "@/pages/admin/theme/admin-chrome.css";
import "./settings-modal.css";

const PersonalSettingsContent = lazy(() => import("@/pages/settings"));
const adminRoutePage = (name: "AnalyticsPage" | "FeatureAvailabilityPage" | "StorageResourcesPage") => lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module[name] })));

type Group = "account" | "creation" | "resources" | "platform" | "monitoring";
type VisibilityContext = { admin: boolean; customChannels: boolean; frontendModels: boolean; runningHub: boolean };
type SectionDefinition = {
    key: SettingsSectionKey;
    group: Group;
    label: string;
    description: string;
    icon: ReactNode;
    visible?: (context: VisibilityContext) => boolean;
} & ({ personal: PersonalSettingsSection } | { page: LazyExoticComponent<ComponentType> });

const GROUPS: Array<{ key: Group; label: string }> = [
    { key: "account", label: tr("账号") },
    { key: "creation", label: tr("创作偏好") },
    { key: "resources", label: tr("模型与资源") },
    { key: "platform", label: tr("平台") },
    { key: "monitoring", label: tr("监控与诊断") },
];

const admin = ({ admin }: VisibilityContext) => admin;

const SECTIONS: SectionDefinition[] = [
    { key: "account", group: "account", label: tr("账号"), description: tr("头像、用户名与密码"), icon: <UserRound />, personal: "profile" },
    { key: "login-history", group: "account", label: tr("登录记录"), description: tr("登录、失败与退出"), icon: <History />, visible: admin, page: lazy(() => import("@/pages/admin/login-logs/login-logs-page")) },

    { key: "models", group: "creation", label: tr("模型选择"), description: tr("按领域选择默认模型"), icon: <Boxes />, personal: "models" },
    { key: "preferences", group: "creation", label: tr("生成偏好"), description: tr("画布生成默认值"), icon: <SlidersHorizontal />, personal: "preferences" },
    { key: "prompts", group: "creation", label: tr("提示词偏好"), description: tr("按任务定制平台模板"), icon: <MessageSquareText />, personal: "prompts" },
    { key: "agent-memory", group: "creation", label: tr("Agent 记忆"), description: tr("批准、添加、导出导入、压缩"), icon: <Brain />, personal: "agent-memory" },
    { key: "channels", group: "creation", label: tr("个人渠道"), description: tr("模型服务与个人工作流"), icon: <RadioTower />, visible: ({ customChannels }) => customChannels, personal: "channels" },
    { key: "runninghub", group: "creation", label: tr("RunningHub 工作流"), description: tr("个人渠道的云端工作流配置"), icon: <Workflow />, visible: ({ runningHub }) => runningHub, personal: "runninghub" },
    { key: "my-storage", group: "creation", label: tr("我的对象存储"), description: tr("管理个人媒体存储"), icon: <Cloud />, personal: "storage" },

    { key: "model-channels", group: "resources", label: tr("系统渠道"), description: tr("渠道、模型与协议"), icon: <RadioTower />, visible: admin, page: lazy(() => import("@/pages/admin/channels/channels-page")) },
    {
        key: "model-catalog",
        group: "resources",
        label: tr("前台模型"),
        description: tr("展示与线路"),
        icon: <Layers3 />,
        visible: (context) => context.admin && context.frontendModels,
        page: lazy(() => import("@/pages/admin/logical-models/logical-models-page")),
    },
    { key: "prompt-templates", group: "resources", label: tr("提示词模板"), description: tr("平台创作策略版本"), icon: <MessageSquareText />, visible: admin, page: lazy(() => import("@/pages/admin/storyboard-prompts/storyboard-prompts-page")) },
    { key: "workbench-tools", group: "resources", label: tr("工作台工具"), description: tr("生图/视频工具与预设"), icon: <WandSparkles />, visible: admin, page: lazy(() => import("@/pages/admin/workbench-tools/workbench-tools-page")) },
    { key: "resources", group: "resources", label: tr("存储资源"), description: tr("资源列表、容量与预览"), icon: <Database />, visible: admin, page: adminRoutePage("StorageResourcesPage") },
    { key: "storage", group: "resources", label: tr("存储服务"), description: tr("对象存储与资源存储"), icon: <HardDrive />, visible: admin, page: lazy(() => import("@/pages/admin/settings/storage-settings-page")) },
    { key: "ark-assets", group: "resources", label: tr("方舟素材库"), description: tr("Seedance 可信参考素材"), icon: <CloudUpload />, visible: admin, page: lazy(() => import("@/pages/admin/settings/ark-private-assets-settings-page")) },

    { key: "modules", group: "platform", label: tr("功能模块"), description: tr("启用或隐藏工作台模块"), icon: <ToggleLeft />, visible: admin, page: adminRoutePage("FeatureAvailabilityPage") },
    { key: "plugins", group: "platform", label: tr("插件管理"), description: tr("可用性、上传与卸载"), icon: <PlugZap />, visible: admin, page: lazy(() => import("@/pages/admin/plugins/plugins-page")) },
    { key: "skills", group: "platform", label: tr("技能分类"), description: tr("策展与分类维护"), icon: <Sparkles />, visible: admin, page: lazy(() => import("@/pages/admin/skill-curation-page")) },
    { key: "appearance", group: "platform", label: tr("外观与品牌"), description: tr("名称、Logo、皮肤与画布"), icon: <Palette />, visible: admin, page: lazy(() => import("@/pages/admin/settings/appearance-settings-page")) },
    { key: "drawing", group: "platform", label: tr("绘图工具"), description: tr("画布绘图节点默认引擎"), icon: <Paintbrush />, visible: admin, page: lazy(() => import("@/pages/admin/settings/drawing-engine-settings-page")) },
    { key: "runtime", group: "platform", label: tr("资源与策略"), description: tr("并发、频控与超时"), icon: <Settings2 />, visible: admin, page: lazy(() => import("@/pages/admin/settings/runtime-policy-settings-page")) },
    {
        key: "response-interception",
        group: "platform",
        label: tr("模型响应拦截"),
        description: tr("先启用策略，再配置替换规则"),
        icon: <ShieldAlert />,
        visible: admin,
        page: lazy(() => import("@/pages/admin/settings/response-interception-settings-page")),
    },
    { key: "third-party", group: "platform", label: tr("第三方参数配置"), description: tr("第三方服务凭据"), icon: <KeyRound />, visible: admin, page: lazy(() => import("@/pages/admin/settings/libtv-settings-page")) },
    { key: "updates", group: "platform", label: tr("系统更新"), description: tr("检查版本、备份与安全更新"), icon: <RefreshCw />, visible: admin, page: lazy(() => import("@/pages/admin/settings/system-update-page")) },

    { key: "overview", group: "monitoring", label: tr("运行总览"), description: tr("请求质量与队列趋势"), icon: <BarChart3 />, visible: admin, page: adminRoutePage("AnalyticsPage") },
    { key: "requests", group: "monitoring", label: tr("请求明细"), description: tr("上游调用记录"), icon: <FileClock />, visible: admin, page: lazy(() => import("@/pages/admin/logs/logs-page")) },
    { key: "performance", group: "monitoring", label: tr("系统性能"), description: tr("主机、数据库与缓存状态"), icon: <Activity />, visible: admin, page: lazy(() => import("@/pages/admin/settings/system-performance-page")) },
    { key: "diagnostics", group: "monitoring", label: tr("问题诊断"), description: tr("导出日志协助排查"), icon: <Bug />, personal: "diagnostics" },
];

/** The settings modal; `requested` is the `?settings=` section from the URL (see SettingsModalHost). */
export default function SettingsModal({ requested }: { requested: string }) {
    const location = useLocation();
    const navigate = useNavigate();
    const role = useUserStore((state) => state.user?.role);
    const features = useUserStore((state) => state.features);
    const runningHub = usePluginStore((state) => state.runtimeStatuses[RUNNINGHUB_PLUGIN_ID] === "enabled");
    const [query, setQuery] = useState("");
    const sections = useMemo(() => {
        const context: VisibilityContext = { admin: role === "admin", customChannels: features.customChannelsEnabled, frontendModels: features.frontendModelsEnabled, runningHub };
        return SECTIONS.filter((section) => !section.visible || section.visible(context));
    }, [features.customChannelsEnabled, features.frontendModelsEnabled, role, runningHub]);
    const active = sections.find((section) => section.key === requested) ?? sections[0];
    const needle = query.trim().toLocaleLowerCase();
    const filtered = needle ? sections.filter((section) => `${section.label} ${section.description}`.toLocaleLowerCase().includes(needle)) : sections;

    const select = (key: SettingsSectionKey) => navigate({ pathname: location.pathname, search: settingsSearch(location.search, key) }, { replace: true, state: location.state });
    const close = () => {
        if ((location.state as { settingsBackground?: boolean } | null)?.settingsBackground) navigate(-1);
        else navigate({ pathname: location.pathname, search: settingsClosedSearch(location.search) }, { replace: true });
    };
    const selectPersonal = (section: PersonalSettingsSection) => {
        const next = SECTIONS.find((item) => "personal" in item && item.personal === section);
        if (next) select(next.key);
    };

    return (
        <AppModal flush open centered footer={null} closable={false} width="min(1320px, calc(100vw - 32px))" rootClassName="settings-modal-root" className="settings-modal" onCancel={close} aria-label={tr("设置")}>
            <div className="settings-modal-shell">
                <aside className="settings-modal-nav" aria-label={tr("设置分类")}>
                    <div className="settings-modal-nav-head">
                        <strong>{tr("设置")}</strong>
                        <label className="settings-modal-search">
                            <Search aria-hidden="true" />
                            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("搜索设置")} aria-label={tr("搜索设置")} />
                        </label>
                    </div>
                    <nav className="settings-modal-nav-list thin-scrollbar">
                        {GROUPS.map((group) => {
                            const items = filtered.filter((section) => section.group === group.key);
                            if (!items.length) return null;
                            return (
                                <div key={group.key} className="settings-modal-nav-group">
                                    <div className="settings-modal-nav-group-label">{group.label}</div>
                                    {items.map((section) => (
                                        <button
                                            key={section.key}
                                            type="button"
                                            className={cn("settings-modal-nav-item", section.key === active?.key && "is-active")}
                                            aria-current={section.key === active?.key ? "page" : undefined}
                                            onClick={() => select(section.key)}
                                        >
                                            <span className="settings-modal-nav-icon">{section.icon}</span>
                                            <span className="min-w-0 truncate">{section.label}</span>
                                        </button>
                                    ))}
                                </div>
                            );
                        })}
                        {!filtered.length ? <p className="settings-modal-nav-empty">{tr("没有匹配的设置")}</p> : null}
                    </nav>
                </aside>
                <section className="settings-modal-main">
                    <header className="settings-modal-header">
                        <select className="settings-modal-mobile-select" value={active?.key} aria-label={tr("设置分类")} onChange={(event) => select(event.target.value as SettingsSectionKey)}>
                            {GROUPS.map((group) => {
                                const items = sections.filter((section) => section.group === group.key);
                                return items.length ? (
                                    <optgroup key={group.key} label={group.label}>
                                        {items.map((section) => (
                                            <option key={section.key} value={section.key}>
                                                {section.label}
                                            </option>
                                        ))}
                                    </optgroup>
                                ) : null;
                            })}
                        </select>
                        <div className="settings-modal-heading">
                            <span>{GROUPS.find((group) => group.key === active?.group)?.label}</span>
                            <strong>{active?.label}</strong>
                        </div>
                        <button type="button" className="settings-modal-close" onClick={close} aria-label={tr("关闭设置")}>
                            <X aria-hidden="true" />
                        </button>
                    </header>
                    <div className={cn("settings-modal-body thin-scrollbar", active && !("personal" in active) && "is-admin")}>
                        <Suspense
                            fallback={
                                <div className="settings-modal-loading" role="status">
                                    {tr("正在加载…")}
                                </div>
                            }
                        >
                            {active ? "personal" in active ? <PersonalSettingsContent key={active.key} section={active.personal} onSelect={selectPersonal} onClose={close} /> : <AdminSection key={active.key} page={active.page} /> : null}
                        </Suspense>
                    </div>
                </section>
            </div>
        </AppModal>
    );
}

/** Platform sections reuse the admin pages with the admin theme, tokens and reference data. */
function AdminSection({ page: Page }: { page: LazyExoticComponent<ComponentType> }) {
    const userId = useUserStore((state) => state.user?.id);
    const dark = useThemeStore((state) => state.theme === "dark");
    const skin = useAppearanceStore((state) => state.appearance.activeSkin);

    useEffect(() => {
        document.body.classList.add("admin-overlays");
        return () => document.body.classList.remove("admin-overlays");
    }, []);

    return (
        <ConfigProvider theme={getIsolatedAdminAntTheme(dark, skin)} getPopupContainer={(node) => node?.closest<HTMLElement>("[data-admin-root]") || document.body}>
            <AppFeedbackProvider>
                <AdminDensityProvider key={userId || "anonymous"} userId={userId}>
                    <AdminProvider>
                        <AdminSectionRoot>
                            <Page />
                        </AdminSectionRoot>
                    </AdminProvider>
                </AdminDensityProvider>
            </AppFeedbackProvider>
        </ConfigProvider>
    );
}

function AdminSectionRoot({ children }: { children: ReactNode }) {
    const { density } = useAdminDensity();
    return (
        <div id="admin-root" data-admin-root data-admin-density={density} className="admin-shell settings-modal-admin">
            {children}
        </div>
    );
}
