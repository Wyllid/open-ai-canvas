import { tr } from "@/i18n";
import { App, Button, Input } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import type { ColumnsType } from "antd/es/table";
import { CloudUpload, PlugZap, RefreshCw, Search, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import "@/lib/plugins/builtin";
import { EAGLE_PLUGIN_ID } from "@/lib/plugins/builtin/eagle";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { isOfficialApplicationPluginId } from "@/lib/plugins/official-applications";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import type { PluginManifest, PluginManifestV2 } from "@/lib/plugins/plugin-types";
import { fetchAdminPlugins, setPluginPlatformAvailability, uninstallPlugin, uploadPlugin, type AdminPluginState, type BackendPlugin, type PluginManagement } from "@/services/api/plugins";
import { UploadPluginModal } from "@/pages/plugins/plugin-documentation-modals";

import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import { Select } from "@/components/ui/base/select";

type AdminPluginItem = {
    manifest: PluginManifest | PluginManifestV2;
    source: string;
    management: PluginManagement;
    status?: string;
    error?: string;
};

export default function AdminPluginsPage() {
    const { message, modal } = App.useApp();
    const [plugins, setPlugins] = useState<BackendPlugin[]>([]);
    const [states, setStates] = useState<Record<string, AdminPluginState>>({});
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState("");
    const [uploadOpen, setUploadOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState<"all" | "application" | "protocol" | "uploaded">("all");
    const [availability, setAvailability] = useState<"all" | "available" | "unavailable">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const reload = async () => {
        setLoading(true);
        try {
            const result = await fetchAdminPlugins();
            setPlugins(result.plugins);
            setStates(result.states);
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("读取插件管理数据失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const items = useMemo(() => mergePlugins(plugins), [plugins]);
    const filtered = useMemo(() => {
        const keyword = search.trim().toLocaleLowerCase();
        return items.filter((item) => {
            if (kind === "uploaded" && item.management.origin !== "uploaded") return false;
            if (kind !== "all" && kind !== "uploaded" && item.management.kind !== kind) return false;
            const available = states[item.manifest.id]?.platformAvailable ?? item.status === "enabled";
            if (availability === "available" && !available) return false;
            if (availability === "unavailable" && available) return false;
            if (!keyword) return true;
            return [item.manifest.name, item.manifest.id, item.manifest.description, item.manifest.author].filter(Boolean).join(" ").toLocaleLowerCase().includes(keyword);
        });
    }, [availability, items, kind, search, states]);

    useEffect(() => {
        setPage((current) => Math.min(current, Math.max(1, Math.ceil(filtered.length / pageSize))));
    }, [filtered.length, pageSize]);

    const changeAvailability = async (item: AdminPluginItem, available: boolean) => {
        setSavingId(item.manifest.id);
        try {
            const state = await setPluginPlatformAvailability(item.manifest.id, available);
            setStates((current) => ({ ...current, [item.manifest.id]: state }));
            message.success(`${item.manifest.name}${available ? tr("已开放") : tr("已停用")}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("更新插件可用状态失败"));
        } finally {
            setSavingId("");
        }
    };

    const upload = async (file: File) => {
        try {
            await uploadPlugin(file);
            setUploadOpen(false);
            message.success(tr("自定义插件已安装"));
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("安装插件失败"));
        }
    };

    const remove = (item: AdminPluginItem) => {
        modal.confirm({
            title: tr("卸载 {0}？", item.manifest.name),
            content: tr("插件包、平台状态和所有用户的启用记录都会删除。此操作不可撤销。"),
            okText: tr("确认卸载"),
            okButtonProps: { danger: true },
            cancelText: tr("取消"),
            onOk: async () => {
                try {
                    await uninstallPlugin(item.manifest.id);
                    message.success(tr("自定义插件已卸载"));
                    await reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : tr("卸载插件失败"));
                    throw error;
                }
            },
        });
    };

    const applicationCount = items.filter((item) => item.management.kind === "application").length;
    const protocolCount = items.filter((item) => item.management.kind === "protocol").length;
    const unavailableCount = items.filter((item) => !(states[item.manifest.id]?.platformAvailable ?? item.status === "enabled")).length;
    const hasFilters = Boolean(search.trim() || kind !== "all" || availability !== "all");
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    const columns: ColumnsType<AdminPluginItem> = [
        {
            title: tr("插件"),
            key: "plugin",
            width: 410,
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-3">
                    <PluginBrandIcon pluginId={item.manifest.id} />
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate font-medium text-foreground">{item.manifest.name}</span>
                            <span className="shrink-0 text-xs text-foreground/42">v{item.manifest.version}</span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
                            <span className="max-w-44 shrink-0 truncate font-mono text-[var(--fs-label)] text-foreground/42" title={item.manifest.id}>
                                {item.manifest.id}
                            </span>
                            <span className="text-foreground/20" aria-hidden="true">
                                ·
                            </span>
                            <span className={`truncate ${item.error ? "text-status-error" : "text-foreground/52"}`} title={item.error || item.manifest.description || tr("未提供插件说明")}>
                                {item.error || item.manifest.description || tr("未提供插件说明")}
                            </span>
                        </div>
                    </div>
                </div>
            ),
        },
        {
            title: tr("类型"),
            key: "type",
            width: 160,
            align: "center",
            render: (_, item) => (
                <div>
                    <AdminStatusBadge label={managementLabel(item.management)} tone={item.management.origin === "uploaded" ? "warning" : item.management.kind === "application" ? "info" : "neutral"} />
                    {!item.manifest.trusted ? (
                        <div className="mt-2">
                            <AdminStatusBadge label={tr("来源未验证")} tone="warning" />
                        </div>
                    ) : null}
                </div>
            ),
        },
        {
            title: tr("作用范围"),
            key: "scope",
            width: 180,
            align: "center",
            render: (_, item) =>
                item.management.activationScope === "user" ? (
                    <div>
                        <div className="font-medium text-foreground/78">{tr("用户自主启用")}</div>
                        <div className="mt-1 inline-flex items-center gap-1 text-xs text-foreground/48">
                            <UsersRound className="size-3.5" aria-hidden="true" />
                            {tr("{0} 位已启用", states[item.manifest.id]?.enabledUserCount || 0)}
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="font-medium text-foreground/78">{tr("全局生效")}</div>
                        <div className="mt-1 text-xs text-foreground/48">{tr("管理员统一控制")}</div>
                    </div>
                ),
        },
        {
            title: tr("平台状态"),
            key: "status",
            width: 170,
            align: "center",
            render: (_, item) => {
                const available = states[item.manifest.id]?.platformAvailable ?? item.status === "enabled";
                return (
                    <div className="flex items-center justify-center gap-3">
                        <AdminStatusBadge label={available ? tr("已开放") : tr("已停用")} tone={available ? "success" : "neutral"} />
                        <Switch
                            className="plugin-state-switch"
                            loading={savingId === item.manifest.id}
                            checked={available}
                            aria-label={tr("{0}，当前{1}", item.manifest.name, available ? tr("平台开放，点击停用") : tr("平台停用，点击开放"))}
                            onChange={(checked) => void changeAvailability(item, checked)}
                        />
                    </div>
                );
            },
        },
        {
            title: tr("卸载"),
            key: "actions",
            width: 72,
            align: "center",
            render: (_, item) =>
                item.management.origin === "uploaded" ? (
                    <Button danger type="text" size="small" aria-label={tr("卸载 {0}", item.manifest.name)} icon={<Trash2 className="size-3.5" aria-hidden="true" />} onClick={() => remove(item)} />
                ) : (
                    <span title={tr("内置插件不可卸载")}>
                        <Button type="text" size="small" disabled aria-label={tr("{0}为内置插件，不可卸载", item.manifest.name)} icon={<Trash2 className="size-3.5" aria-hidden="true" />} />
                    </span>
                ),
        },
    ];

    return (
        <AdminPageFrame
            title={tr("插件管理")}
            description={tr("管理平台级可用性、自定义插件安装与用户启用范围")}
            actions={
                <>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void reload()}>
                        {tr("刷新")}
                    </Button>
                    <Button type="primary" icon={<CloudUpload className="size-4" />} onClick={() => setUploadOpen(true)}>
                        {tr("上传插件")}
                    </Button>
                </>
            }
        >
            <div className="my-4 grid min-h-16 grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card sm:grid-cols-4">
                <OverviewItem label={tr("全部插件")} value={items.length} />
                <OverviewItem label={tr("官方应用")} value={applicationCount} />
                <OverviewItem label={tr("系统协议")} value={protocolCount} />
                <OverviewItem label={tr("平台已停用")} value={unavailableCount} tone={unavailableCount ? "warning" : "default"} />
            </div>
            <AdminDataTable
                toolbar={
                    <Input
                        className="app-list-search"
                        allowClear
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={search}
                        aria-label={tr("搜索插件")}
                        placeholder={tr("搜索插件名称、ID 或作者")}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarFilters={
                    <>
                        <Select
                            aria-label={tr("筛选插件类型")}
                            className="w-44"
                            value={kind}
                            onChange={(value) => {
                                setKind(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: tr("全部类型") },
                                { value: "application", label: tr("官方应用插件") },
                                { value: "protocol", label: tr("系统协议插件") },
                                { value: "uploaded", label: tr("上传的自定义插件") },
                            ]}
                        />
                        <Select
                            aria-label={tr("筛选插件状态")}
                            className="w-32"
                            value={availability}
                            onChange={(value) => {
                                setAvailability(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: tr("全部状态") },
                                { value: "available", label: tr("平台开放") },
                                { value: "unavailable", label: tr("平台停用") },
                            ]}
                        />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={() => {
                    setSearch("");
                    setKind("all");
                    setAvailability("all");
                    setPage(1);
                }}
                skeletonColumns={5}
                table={{ className: "app-data-table", size: "small", sticky: true, rowKey: (item) => item.manifest.id, loading, columns, dataSource: paginated, pagination: false, scroll: { x: 1120 } }}
                empty={<AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : tr("还没有可管理的插件")} />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filtered.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
            <UploadPluginModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUpload={upload} />
        </AdminPageFrame>
    );
}

function OverviewItem({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warning" }) {
    return (
        <div className="flex min-w-0 items-center gap-3 px-4 py-3">
            <div className={`text-xl font-semibold tabular-nums ${tone === "warning" ? "text-status-warning" : "text-foreground"}`}>{value}</div>
            <div className="truncate text-xs text-foreground/52">{label}</div>
        </div>
    );
}

function PluginBrandIcon(_props: { pluginId: string }) {
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/65">
            <PlugZap className="size-4" aria-hidden="true" />
        </span>
    );
}

function mergePlugins(remote: BackendPlugin[]): AdminPluginItem[] {
    const byId = new Map<string, AdminPluginItem>();
    for (const plugin of listRegisteredPlugins()) {
        const application = isOfficialApplicationPluginId(plugin.manifest.id);
        byId.set(plugin.manifest.id, {
            manifest: plugin.manifest,
            source: plugin.source || "bundled",
            management: {
                origin: "official",
                kind: application ? "application" : "protocol",
                activationScope: application ? "user" : "system",
                configurationScope: application ? (plugin.manifest.id === EAGLE_PLUGIN_ID || plugin.manifest.id === RUNNINGHUB_PLUGIN_ID ? "user" : "none") : "system",
            },
        });
    }
    for (const plugin of remote) byId.set(plugin.manifest.id, plugin);
    return [...byId.values()].sort((left, right) => managementOrder(left.management) - managementOrder(right.management) || left.manifest.name.localeCompare(right.manifest.name, "zh-CN"));
}

function managementOrder(value: PluginManagement) {
    if (value.kind === "application") return 0;
    if (value.origin === "official") return 1;
    return 2;
}

function managementLabel(value: PluginManagement) {
    if (value.origin === "uploaded") return tr("自定义插件");
    if (value.kind === "application") return tr("官方应用");
    return tr("系统协议");
}
