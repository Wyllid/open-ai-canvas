import { tr } from "@/i18n";
import { App, Button, Form, Input, InputNumber, Modal, Spin, Switch } from "antd";
import { ChevronRight, Copy, Download, Pencil, Plus, Power, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AdminSearchInput } from "../components/admin-search-input";

import { ChannelHeadersEditor, validateChannelHeaders } from "@/components/channel-headers-editor";
import { refreshSystemChannels } from "@/lib/user-session";
import { createAdminChannel, deleteAdminChannel, duplicateAdminChannel, exportAdminChannels, importAdminChannels, listAdminChannels, updateAdminChannel, type SystemChannelExport } from "@/services/api/auth";
import { type ChannelHeader, type ModelChannel } from "@/stores/use-config-store";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminRowActions, AdminStatusBadge, AdminTableEmpty, configuredSecretText } from "../components/admin-ui";
import { ChannelModelManager } from "../components/channel-model-manager";
import { ChannelOrderDialog } from "../components/channel-order-dialog";
import { selectChannelWorkspace } from "./channel-workspace-state";
import { AgentModelSetupCard } from "./agent-model-setup-card";
import { ProviderCatalogWizard } from "./provider-catalog-wizard";
import "./channels-page.css";
import { Select } from "@/components/ui/base/select";

type ChannelFormValues = {
    name: string;
    baseUrl: string;
    apiKey?: string;
    secretKey?: string;
    headers?: ChannelHeader[];
    useGlobalConcurrency?: boolean;
    concurrencyLimit?: number;
    enabled?: boolean;
    proxyUrl?: string;
};

export function adminChannelSavePayload(values: ChannelFormValues) {
    return {
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        apiKey: values.apiKey?.trim() || "",
        secretKey: values.secretKey?.trim() || "",
        headers: values.headers || [],
        useGlobalConcurrency: values.useGlobalConcurrency !== false,
        concurrencyLimit: values.useGlobalConcurrency === false ? values.concurrencyLimit : undefined,
        enabled: values.enabled !== false,
        proxyUrl: values.proxyUrl?.trim() || "",
    };
}

export default function ChannelsPage() {
    const { message, modal } = App.useApp();
    const { reloadReferences } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = normalizeStatus(searchParams.get("status"));
    const selectedChannelId = searchParams.get("channel");
    const [channels, setChannels] = useState<ModelChannel[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingChannel, setEditingChannel] = useState<ModelChannel | null>(null);
    const [saving, setSaving] = useState(false);
    const [duplicatingChannelId, setDuplicatingChannelId] = useState<string | null>(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [transferring, setTransferring] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const requestSequence = useRef(0);
    const [form] = Form.useForm<ChannelFormValues>();
    const useGlobalConcurrency = Form.useWatch("useGlobalConcurrency", form) !== false;
    const hasFilters = Boolean(keyword || status !== "all");
    const { visibleChannels, selectedChannel } = selectChannelWorkspace(channels, keyword, status, selectedChannelId);

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        setSearchParams(
            (current) => {
                const next = new URLSearchParams(current);
                next.delete("page");
                next.delete("pageSize");
                Object.entries(patch).forEach(([key, value]) => {
                    if (value === "" || (key === "status" && value === "all")) next.delete(key);
                    else next.set(key, String(value));
                });
                return next;
            },
            { replace },
        );
    };

    const reload = async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setLoadError("");
        try {
            // The navigation needs every channel, not just the API's default first 20.
            const result = await listAdminChannels({ page: 1, pageSize: 100 });
            const nextChannels = [...result.channels];
            for (let page = 2; nextChannels.length < result.total; page += 1) {
                if (sequence !== requestSequence.current) return;
                const next = await listAdminChannels({ page, pageSize: 100 });
                if (!next.channels.length) throw new Error(tr("渠道列表发生变化，请重新加载"));
                nextChannels.push(...next.channels);
            }
            if (sequence !== requestSequence.current) return;
            setChannels(Array.from(new Map(nextChannels.map((channel) => [channel.id, channel])).values()));
        } catch (error) {
            if (sequence === requestSequence.current) setLoadError(error instanceof Error ? error.message : tr("读取渠道列表失败"));
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        return () => {
            requestSequence.current += 1;
        };
    }, []);

    const syncChannels = async () => {
        await reloadReferences();
        try {
            await refreshSystemChannels();
        } catch (error) {
            message.warning(error instanceof Error ? tr("后台已保存，但配置同步失败：{0}", error.message) : tr("后台已保存，但配置同步失败，请稍后重新打开配置"));
        }
    };

    const openDrawer = (channel?: ModelChannel) => {
        setEditingChannel(channel || null);
        form.resetFields();
        form.setFieldsValue(
            channel
                ? {
                      name: channel.name,
                      baseUrl: channel.baseUrl,
                      apiKey: "",
                      secretKey: "",
                      headers: channel.headers || [],
                      useGlobalConcurrency: !channel.concurrencyLimit,
                      concurrencyLimit: channel.concurrencyLimit || undefined,
                      enabled: channel.enabled !== false,
                      proxyUrl: channel.proxyUrl || "",
                  }
                : { name: "", baseUrl: "", apiKey: "", secretKey: "", headers: [], useGlobalConcurrency: true, concurrencyLimit: undefined, enabled: true, proxyUrl: "" },
        );
        setDrawerOpen(true);
    };

    const closeDrawer = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            setDrawerOpen(false);
            return;
        }
        modal.confirm({ title: tr("放弃渠道修改？"), content: tr("尚未保存的连接信息将丢失。"), okText: tr("放弃修改"), cancelText: tr("继续编辑"), okButtonProps: { danger: true }, onOk: () => setDrawerOpen(false) });
    };

    const save = async () => {
        const values = await form.validateFields();
        const headerError = validateChannelHeaders(values.headers);
        if (headerError) {
            message.error(headerError);
            return;
        }
        if (!editingChannel && !values.apiKey?.trim()) {
            message.error(tr("请填写 API Key 或 Access Key"));
            return;
        }
        setSaving(true);
        try {
            const payload = adminChannelSavePayload(values);
            const { channel } = await (editingChannel ? updateAdminChannel(editingChannel.id, payload) : createAdminChannel(payload));
            setChannels((current) => (editingChannel ? current.map((item) => (item.id === channel.id ? channel : item)) : [...current, channel]));
            updateUrl({ channel: channel.id, filter: "", status: "all" }, true);
            await syncChannels();
            setDrawerOpen(false);
            form.resetFields();
            await reload();
            message.success(editingChannel ? tr("系统渠道已更新") : tr("系统渠道已创建"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("保存系统渠道失败"));
        } finally {
            setSaving(false);
        }
    };

    const toggleChannel = async (channel: ModelChannel) => {
        try {
            await updateAdminChannel(channel.id, { enabled: channel.enabled === false });
            await syncChannels();
            await reload();
            message.success(channel.enabled === false ? tr("系统渠道已启用") : tr("系统渠道已停用"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("更新系统渠道失败"));
        }
    };

    const duplicateChannel = async (channel: ModelChannel) => {
        setDuplicatingChannelId(channel.id);
        try {
            const { channel: duplicated } = await duplicateAdminChannel(channel.id);
            setChannels((current) => [...current, duplicated]);
            updateUrl({ channel: duplicated.id, filter: "", status: "all" }, true);
            await syncChannels();
            await reload();
            message.success(tr("系统渠道已复制"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("复制系统渠道失败"));
        } finally {
            setDuplicatingChannelId(null);
        }
    };

    // 导出文件不含任何密钥；ids 为空时导出全部系统渠道。
    const exportChannels = async (target?: ModelChannel) => {
        setTransferring(true);
        try {
            const exported = await exportAdminChannels(target ? [target.id] : []);
            const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            const stamp = new Date().toISOString().slice(0, 10);
            link.href = url;
            link.download = target ? `system-channel-${target.name}-${stamp}.json` : `system-channels-${stamp}.json`;
            link.click();
            URL.revokeObjectURL(url);
            message.success(tr("已导出 {0} 个渠道（不含密钥）", exported.channels.length));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("导出系统渠道失败"));
        } finally {
            setTransferring(false);
        }
    };

    const importChannels = async (file: File) => {
        let payload: SystemChannelExport;
        try {
            payload = JSON.parse(await file.text()) as SystemChannelExport;
        } catch {
            message.error(tr("导入文件不是有效的 JSON"));
            return;
        }
        if (payload?.format !== "yingce.system-channels" || !Array.isArray(payload.channels)) {
            message.error(tr("不是系统渠道导出文件"));
            return;
        }
        const names = payload.channels.map((item) => item.name).filter(Boolean);
        modal.confirm({
            title: tr("导入 {0} 个系统渠道？", names.length),
            content: (
                <div className="space-y-2 text-sm">
                    <p>
                        {names.slice(0, 8).join("、")}
                        {names.length > 8 ? tr(" 等 {0} 个", names.length) : ""}
                    </p>
                    <p className="text-foreground/60">{tr("按渠道名称合并：同名渠道保留现有密钥和启停状态，只更新地址、并发和文件中的模型；新渠道创建为停用状态，填写 API Key 后再启用。文件中没有的模型保持不变。")}</p>
                </div>
            ),
            okText: tr("开始导入"),
            onOk: async () => {
                setTransferring(true);
                try {
                    const result = await importAdminChannels(payload);
                    await syncChannels();
                    await reload();
                    const summary = tr("新建 {0} 个、更新 {1} 个渠道，保存 {2} 个模型", result.createdChannels.length, result.updatedChannels.length, result.savedModels);
                    if (result.errors.length) {
                        modal.warning({
                            title: tr("导入完成，部分内容失败"),
                            width: 640,
                            content: (
                                <div className="space-y-2 text-sm">
                                    <p>{summary}</p>
                                    <ul className="max-h-64 list-disc space-y-1 overflow-auto pl-5 text-destructive">
                                        {result.errors.map((item) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            ),
                        });
                    } else {
                        message.success(result.createdChannels.length ? tr("{0}；新渠道需填写 API Key 后启用", summary) : summary);
                    }
                } catch (error) {
                    message.error(error instanceof Error ? error.message : tr("导入系统渠道失败"));
                } finally {
                    setTransferring(false);
                }
            },
        });
    };

    const removeChannel = async (channel: ModelChannel) => {
        try {
            await deleteAdminChannel(channel.id);
            await syncChannels();
            await reload();
            message.success(tr("系统渠道已删除"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("删除系统渠道失败"));
        }
    };

    const channelActions = (channel: ModelChannel) => (
        <AdminRowActions
            primary={{ label: tr("编辑渠道"), icon: <Pencil className="size-3.5" />, onClick: () => openDrawer(channel) }}
            actions={[
                { key: "duplicate", label: tr("复制渠道"), icon: <Copy className="size-3.5" />, disabled: Boolean(duplicatingChannelId), onClick: () => duplicateChannel(channel) },
                { key: "export", label: tr("导出渠道（不含密钥）"), icon: <Download className="size-3.5" />, disabled: transferring, onClick: () => exportChannels(channel) },
                {
                    key: "toggle",
                    label: channel.enabled !== false ? tr("停用渠道") : tr("启用渠道"),
                    icon: <Power className="size-3.5" />,
                    danger: channel.enabled !== false,
                    confirm: {
                        title: channel.enabled !== false ? tr("停用这个系统渠道？") : tr("启用这个系统渠道？"),
                        description: channel.enabled !== false ? tr("停用后新任务不会再使用该渠道，但仍会保留在列表中，可随时重新启用。") : tr("启用后，配置完整的模型会重新进入系统可用模型集合。"),
                        okText: channel.enabled !== false ? tr("确认停用") : tr("确认启用"),
                    },
                    onClick: () => toggleChannel(channel),
                },
                {
                    key: "delete",
                    label: tr("删除渠道"),
                    icon: <Trash2 className="size-3.5" />,
                    danger: true,
                    confirm: { title: tr("删除这个系统渠道？"), description: tr("删除后渠道及所属模型将不再显示，API Key 会被清除，历史账单和调用记录继续保留。该操作不能在页面恢复。"), okText: tr("确认删除") },
                    onClick: () => removeChannel(channel),
                },
            ]}
        />
    );

    return (
        <AdminPageFrame title={tr("系统模型")} description={tr("左侧选择渠道，右侧直接管理模型、协议与售价。")}>
            <AgentModelSetupCard
                onSaved={async () => {
                    await reload();
                    await syncChannels();
                }}
            />
            <div className="admin-channel-workspace">
                <aside className="admin-channel-sidebar" aria-label={tr("系统渠道")}>
                    <div className="admin-channel-sidebar-header">
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="font-semibold">{tr("渠道")}</h2>
                            <span className="admin-channel-count">{hasFilters ? `${visibleChannels.length} / ${channels.length}` : channels.length}</span>
                        </div>
                        <Button block type="primary" icon={<Plus className="size-4" />} onClick={() => setWizardOpen(true)}>
                            {tr("新增渠道")}
                        </Button>
                        <div className="grid grid-cols-2 gap-2">
                            <Button size="small" icon={<Upload className="size-3.5" />} loading={transferring} onClick={() => importInputRef.current?.click()}>
                                {tr("导入")}
                            </Button>
                            <Button size="small" icon={<Download className="size-3.5" />} disabled={transferring || !channels.length} onClick={() => void exportChannels()} title={tr("导出全部系统渠道，不含 API Key 等密钥")}>
                                {tr("导出全部")}
                            </Button>
                        </div>
                        <input
                            ref={importInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            aria-label={tr("选择系统渠道导入文件")}
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void importChannels(file);
                            }}
                        />
                        <AdminSearchInput
                            id="admin-channel-search"
                            aria-label={tr("搜索系统渠道")}
                            autoComplete="off"
                            allowClear
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={tr("搜索渠道名称或地址")}
                            onValueChange={(value) => updateUrl({ filter: value }, true)}
                        />
                        <Select
                            aria-label={tr("筛选渠道状态")}
                            value={status}
                            onChange={(value) => updateUrl({ status: value })}
                            options={[
                                { label: tr("全部状态"), value: "all" },
                                { label: tr("已启用"), value: "enabled" },
                                { label: tr("已停用"), value: "disabled" },
                            ]}
                        />
                    </div>
                    <div className="admin-channel-list" aria-busy={loading}>
                        {loadError ? (
                            <div className="admin-channel-load-error" role="alert">
                                <p>{loadError}</p>
                                <Button size="small" onClick={() => void reload()}>
                                    {tr("重新加载渠道")}
                                </Button>
                            </div>
                        ) : null}
                        {loading ? (
                            <div className="admin-channel-loading" role="status" aria-label={tr("正在加载渠道")}>
                                <Spin size="small" />
                            </div>
                        ) : null}
                        {visibleChannels.map((channel) => (
                            <button type="button" key={channel.id} className="admin-channel-item" aria-pressed={selectedChannel?.id === channel.id} aria-controls="admin-channel-models" onClick={() => updateUrl({ channel: channel.id })}>
                                <span className="admin-channel-item-topline">
                                    <span className="admin-channel-item-name" title={channel.name}>
                                        {channel.name}
                                    </span>
                                    <ChevronRight className="admin-channel-item-arrow size-3.5" aria-hidden="true" />
                                </span>
                                <span className="admin-channel-item-meta">
                                    <span>
                                        {channel.models?.length || 0} {tr("个模型")}
                                    </span>
                                    <span className="admin-channel-item-status" data-enabled={channel.enabled !== false}>
                                        {channel.enabled !== false ? tr("已启用") : tr("已停用")}
                                    </span>
                                </span>
                            </button>
                        ))}
                        {!loading && !loadError && !visibleChannels.length ? (
                            <AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : tr("还没有系统渠道")} action={hasFilters ? <Button onClick={() => updateUrl({ filter: "", status: "all" })}>{tr("清除筛选")}</Button> : undefined} />
                        ) : null}
                    </div>
                    <div className="admin-channel-sidebar-footer">
                        <ChannelOrderDialog
                            onSaved={async () => {
                                await syncChannels();
                                await reload();
                            }}
                        />
                    </div>
                </aside>
                <section id="admin-channel-models" className="admin-channel-detail" aria-label={selectedChannel ? tr("{0}的模型管理", selectedChannel.name) : tr("渠道模型管理")}>
                    {selectedChannel ? (
                        <>
                            <header className="admin-channel-detail-header">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="admin-channel-detail-title">{selectedChannel.name}</h2>
                                        <AdminStatusBadge label={selectedChannel.enabled !== false ? tr("已启用") : tr("已停用")} tone={selectedChannel.enabled !== false ? "success" : "neutral"} />
                                    </div>
                                    <p className="admin-channel-detail-url" title={selectedChannel.baseUrl}>
                                        {selectedChannel.baseUrl}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/50">
                                        <span>{selectedChannel.hasApiKey ? (selectedChannel.hasSecretKey ? tr("AK/SK 已配置") : tr("API Key 已配置")) : tr("凭证未配置")}</span>
                                        <span>
                                            {tr("最大并发：")}
                                            {selectedChannel.concurrencyLimit || tr("跟随系统")}
                                        </span>
                                        {selectedChannel.catalogProviderId ? (
                                            <span>
                                                {tr("来源：服务商目录 ·")} {selectedChannel.catalogProviderId}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                {channelActions(selectedChannel)}
                            </header>
                            <ChannelModelManager
                                key={selectedChannel.id}
                                channel={selectedChannel}
                                onChanged={async () => {
                                    await syncChannels();
                                    await reload();
                                }}
                            />
                        </>
                    ) : (
                        <AdminTableEmpty
                            title={loading ? tr("正在加载渠道") : loadError ? tr("暂时无法读取渠道") : hasFilters ? tr("没有匹配的渠道") : tr("添加渠道，开始管理模型")}
                            description={loading ? tr("加载完成后将在此显示渠道模型。") : loadError ? tr("请在左侧重试加载。") : hasFilters ? tr("调整左侧搜索或状态筛选。") : tr("在左侧新增渠道，配置连接信息后即可拉取或新增模型。")}
                        />
                    )}
                </section>
            </div>
            <Modal
                className="workspace-modal workspace-modal-wide admin-channel-modal"
                rootClassName="admin-channel-modal-root"
                title={editingChannel ? tr("编辑系统渠道") : tr("新增系统渠道")}
                open={drawerOpen}
                width={760}
                onCancel={closeDrawer}
                mask={{ closable: !saving }}
                destroyOnHidden
                footer={
                    <div className="flex justify-end gap-2">
                        <Button onClick={closeDrawer}>{tr("取消")}</Button>
                        <Button type="primary" loading={saving} onClick={() => void save()}>
                            {tr("保存")}
                        </Button>
                    </div>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={tr("渠道名称")} rules={[{ required: true, message: tr("请填写渠道名称") }]}>
                        <Input placeholder={tr("例如：OpenAI 官方渠道")} />
                    </Form.Item>
                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: tr("请填写 Base URL") }]}>
                        <Input placeholder={tr("填写云端渠道 Base URL")} />
                    </Form.Item>
                    <Form.Item
                        name="apiKey"
                        label={editingChannel ? `API Key / Access Key（${configuredSecretText}）` : "API Key / Access Key"}
                        rules={editingChannel ? [] : [{ required: true, message: tr("请填写 API Key 或 Access Key") }]}
                        extra={tr("OpenAI 兼容协议填写 API Key；即梦官方协议填写 IAM Access Key。")}
                    >
                        <Input.Password autoComplete="new-password" placeholder={editingChannel ? tr("留空保留原凭证") : tr("API Key 或 Access Key")} />
                    </Form.Item>
                    <Form.Item name="secretKey" label={editingChannel ? `Secret Key（${channelSecretText(editingChannel)}）` : tr("Secret Key（可选）")} extra={tr("仅即梦官方等 AK/SK 签名协议需要；其他渠道留空。")}>
                        <Input.Password autoComplete="new-password" placeholder={editingChannel ? tr("留空保留原 Secret Key") : "IAM Secret Key"} />
                    </Form.Item>
                    <div className="mb-6">
                        <Form.Item name="headers" noStyle>
                            <ChannelHeadersEditor />
                        </Form.Item>
                    </div>
                    <Form.Item name="proxyUrl" label={tr("代理地址")} extra={tr("为该渠道单独配置出站代理，支持 socks5://、socks5h://、http://、https://。留空则使用全局环境变量代理。")}>
                        <Input placeholder={tr("例如：socks5://127.0.0.1:1080 或 http://127.0.0.1:7890")} />
                    </Form.Item>
                    <Form.Item name="useGlobalConcurrency" label={tr("跟随系统并发配置")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item
                        name="concurrencyLimit"
                        label={tr("渠道最大并发数")}
                        extra={tr("后台任务和系统代理请求共享该渠道上限；槽位暂满时请求会等待。")}
                        rules={
                            useGlobalConcurrency
                                ? []
                                : [
                                      { required: true, message: tr("请填写渠道最大并发数") },
                                      { type: "number", min: 1, max: 999, message: tr("请输入 1-999 的整数") },
                                  ]
                        }
                    >
                        <InputNumber className="w-full" min={1} max={999} precision={0} disabled={useGlobalConcurrency} placeholder={useGlobalConcurrency ? tr("使用系统默认值") : "1-999"} />
                    </Form.Item>
                    <Form.Item name="enabled" label={tr("启用")} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
            <ProviderCatalogWizard
                open={wizardOpen}
                onClose={() => setWizardOpen(false)}
                onCustom={() => {
                    setWizardOpen(false);
                    openDrawer();
                }}
                onInstalled={async (channel) => {
                    setWizardOpen(false);
                    updateUrl({ channel: channel.id, filter: "", status: "all" }, true);
                    await syncChannels();
                    await reload();
                }}
            />
        </AdminPageFrame>
    );
}

function normalizeStatus(value: string | null): "all" | "enabled" | "disabled" {
    return value === "enabled" || value === "disabled" ? value : "all";
}
function channelSecretText(channel: ModelChannel) {
    return channel.hasSecretKey ? tr("已配置，留空不修改") : tr("未配置");
}
