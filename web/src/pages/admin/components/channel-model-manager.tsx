import { tr } from "@/i18n";
import { useEffect, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Popconfirm, Space } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import type { ColumnsType } from "antd/es/table";
import { Copy, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { ModelIcon } from "@/components/model-picker";
import { modelProtocolDefinition, modelProtocolLabel, type ModelProtocol } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { deleteAdminChannelModel, deleteAdminChannelModels, fetchAdminChannelModels, importAdminChannelModels, listAdminChannelModels, type ChannelModel } from "@/services/api/channel-models";
import type { ModelChannel } from "@/stores/use-config-store";
import { ChannelModelEditor } from "./channel-model-editor";
import { AdminBatchBar, AdminDataTable, AdminFilterChip, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { ChannelOrderDialog } from "./channel-order-dialog";
import { deselectVisibleModels, filterImportModels, normalizeFetchModelKey, selectExistingImportModels, selectVisibleModels } from "./channel-model-import-selection";
import { duplicateChannelModelValues, type ChannelModelFormValues } from "./channel-model-editor-form";
import { Select } from "@/components/ui/base/select";

export function ChannelModelManager({ channel, onChanged }: { channel: ModelChannel; onChanged: () => void | Promise<void> }) {
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<ChannelModel[]>([]);
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [deletingSelected, setDeletingSelected] = useState(false);
    const [editing, setEditing] = useState<ChannelModel | null>(null);
    const [copyDraft, setCopyDraft] = useState<ChannelModelFormValues | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [fetching, setFetching] = useState(false);
    const [fetchPreviewOpen, setFetchPreviewOpen] = useState(false);
    const [fetchPreviewModels, setFetchPreviewModels] = useState<string[]>([]);
    const [selectedFetchModels, setSelectedFetchModels] = useState<string[]>([]);
    const [fetchKeyword, setFetchKeyword] = useState("");
    const [importing, setImporting] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [capability, setCapability] = useState<ChannelModel["capability"] | "all">("all");
    const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [availableProtocols, setAvailableProtocols] = useState<import("@/lib/model-protocols").ModelProtocolDefinition[]>([]);
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [protocolError, setProtocolError] = useState("");
    const loadProtocols = async () => {
        setProtocolLoading(true);
        setProtocolError("");
        try {
            setAvailableProtocols(await fetchPluginProviderCatalog("admin.system-channel"));
        } catch (error) {
            setAvailableProtocols([]);
            setProtocolError(error instanceof Error ? error.message : tr("无法读取协议目录"));
        } finally {
            setProtocolLoading(false);
        }
    };
    const reload = async () => {
        if (!channel) return;
        setLoading(true);
        setLoadError("");
        try {
            const models = (await listAdminChannelModels(channel.id)).models;
            const availableIDs = new Set(models.map((item) => item.id));
            setItems(models);
            setSelectedModelIds((current) => current.filter((id) => availableIDs.has(id)));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : tr("读取渠道模型失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
        void loadProtocols();
        setEditing(null);
        setCopyDraft(null);
        setEditorOpen(false);
        setSelectedModelIds([]);
        resetFetchPreview();
        setKeyword("");
        setCapability("all");
        setStatus("all");
        setPage(1);
    }, [channel.id]);

    const fetchModels = async () => {
        setFetching(true);
        try {
            const result = await fetchAdminChannelModels(channel.id);
            if (result.models.length === 0) {
                message.warning(tr("上游没有返回可用模型"));
                return;
            }
            setFetchPreviewModels(result.models);
            setSelectedFetchModels(selectExistingImportModels(result.models, items.flatMap((item) => [item.modelKey, item.providerModelKey].filter(Boolean))));
            setFetchPreviewOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("拉取模型失败"));
        } finally {
            setFetching(false);
        }
    };

    const closeFetchPreview = () => {
        if (importing) return;
        resetFetchPreview();
    };

    const resetFetchPreview = () => {
        setFetchPreviewOpen(false);
        setFetchPreviewModels([]);
        setSelectedFetchModels([]);
        setFetchKeyword("");
    };

    const importSelectedModels = async () => {
        if (!selectedFetchModels.length) return;
        if (!selectedNewFetchModels.length) {
            message.info(tr("当前勾选的模型均已存在，没有需要新增的模型"));
            resetFetchPreview();
            return;
        }
        setImporting(true);
        try {
            const result = await importAdminChannelModels(channel.id, selectedFetchModels);
            await reload();
            await onChanged();
            resetFetchPreview();
            if (result.added > 0) message.success(tr("已导入 {0} 个模型，新增模型仍需配置价格后启用", result.added));
            else message.info(tr("所选模型均已存在，没有新增模型"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("导入模型失败"));
        } finally {
            setImporting(false);
        }
    };

    const startCreate = () => {
        setEditing(null);
        setCopyDraft(null);
        setEditorOpen(true);
    };
    const startEdit = (item: ChannelModel) => {
        setEditing(item);
        setCopyDraft(null);
        setEditorOpen(true);
    };
    const startCopy = (item: ChannelModel) => {
        setEditing(null);
        setCopyDraft(duplicateChannelModelValues(item, availableProtocols));
        setEditorOpen(true);
    };

    const remove = async (item: ChannelModel) => {
        try {
            await deleteAdminChannelModel(channel.id, item.id);
            await reload();
            await onChanged();
            message.success(tr("模型已删除"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("删除模型失败"));
        }
    };

    const confirmBatchRemove = () => {
        if (!selectedModelIds.length) return;
        const count = selectedModelIds.length;
        modal.confirm({
            title: tr("删除已选的 {0} 个模型？", count),
            content: tr("删除后模型不再显示，且不能在页面恢复。只要其中任一模型仍被前台供应线路或进行中任务使用，本次就不会删除任何模型。"),
            okText: tr("批量删除"),
            cancelText: tr("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                setDeletingSelected(true);
                try {
                    const result = await deleteAdminChannelModels(channel.id, selectedModelIds);
                    setSelectedModelIds([]);
                    setPage(1);
                    await reload();
                    await onChanged();
                    message.success(tr("已删除 {0} 个模型", result.deleted));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : tr("批量删除模型失败"));
                } finally {
                    setDeletingSelected(false);
                }
            },
        });
    };
    const columns: ColumnsType<ChannelModel> = [
        {
            title: tr("模型"),
            width: 240,
            render: (_, item) => (
                <div className="flex min-w-0 items-center gap-2">
                    <span className="admin-channel-model-icon">
                        <ModelIcon model={item.modelKey} icon={item.icon} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate font-medium" title={item.displayName || item.modelKey}>
                            {item.displayName || item.modelKey}
                        </div>
                        <div className="admin-monospace truncate text-xs text-foreground/45">{item.modelKey}</div>
                        {item.channelLabel ? <div className="truncate text-xs text-foreground/60">{tr("渠道展示名：")}{item.channelLabel}</div> : null}
                        {item.providerModelKey && item.providerModelKey !== item.modelKey ? <div className="admin-monospace truncate text-xs text-foreground/35">{tr("上游：")}{item.providerModelKey}</div> : null}
                    </div>
                </div>
            ),
        },
        { title: tr("能力"), dataIndex: "capability", width: 90, render: capabilityLabel },
        {
            title: tr("请求协议"),
            dataIndex: "protocol",
            width: 190,
            render: (value: ModelProtocol) =>
                value ? (
                    <div>
                        <div className="text-xs font-medium">{modelProtocolLabel(value, availableProtocols)}</div>
                        <div className="truncate text-[var(--fs-tiny)] text-foreground/45">{modelProtocolDefinition(value, availableProtocols)?.create}</div>
                    </div>
                ) : (
                    <AdminStatusBadge label={tr("待配置")} tone="warning" />
                ),
        },
        { title: tr("规格档"), width: 90, render: (_, item) => item.priceTiers.filter((tier) => tier.enabled).length },
        { title: tr("状态"), dataIndex: "enabled", width: 85, render: (enabled) => <AdminStatusBadge label={enabled ? tr("启用") : tr("停用")} tone={enabled ? "success" : "neutral"} /> },
        {
            title: tr("操作"),
            width: 130,
            fixed: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Button size="small" icon={<Pencil className="size-3.5" />} disabled={deletingSelected} onClick={() => startEdit(item)}>
                        {tr("编辑")}
                    </Button>
                    <Tooltip title={tr("复制模型")}>
                        <Button size="small" aria-label={tr("复制模型 {0}", item.displayName || item.modelKey)} disabled={deletingSelected} icon={<Copy className="size-3.5" />} onClick={() => startCopy(item)} />
                    </Tooltip>
                    <Popconfirm title={tr("删除模型")} description={tr("已被前台供应线路或进行中任务使用的模型不能删除；删除后模型不再显示，且不能在页面恢复。")} okText={tr("删除")} cancelText={tr("取消")} onConfirm={() => void remove(item)}>
                        <Button size="small" danger disabled={deletingSelected} title={tr("删除模型")} aria-label={tr("删除模型")} icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const filteredItems = items.filter((item) => {
        const query = keyword.trim().toLowerCase();
        if (query && !`${item.modelKey} ${item.providerModelKey} ${item.displayName} ${item.channelLabel || ""}`.toLowerCase().includes(query)) return false;
        if (capability !== "all" && item.capability !== capability) return false;
        if (status === "enabled" && !item.enabled) return false;
        if (status === "disabled" && item.enabled) return false;
        return true;
    });
    const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
    const existingFetchModelKeys = new Set(items.flatMap((item) => [item.modelKey, item.providerModelKey].filter(Boolean).map(normalizeFetchModelKey)));
    const selectedNewFetchModels = selectedFetchModels.filter((name) => !existingFetchModelKeys.has(normalizeFetchModelKey(name)));
    const selectedExistingFetchCount = selectedFetchModels.length - selectedNewFetchModels.length;
    const fetchKeywordQuery = fetchKeyword.trim().toLowerCase();
    const visibleFetchModels = filterImportModels(fetchPreviewModels, fetchKeyword);
    const allVisibleFetchModelsSelected = visibleFetchModels.length > 0 && visibleFetchModels.every((name) => selectedFetchModels.includes(name));
    const selectedVisibleFetchCount = visibleFetchModels.filter((name) => selectedFetchModels.includes(name)).length;
    const fetchModelOptions = visibleFetchModels.map((name) => ({
        label: <span className="break-all">{name}</span>,
        value: name,
    }));

    return (
        <div className="admin-channel-model-manager">
            <div className="admin-channel-model-toolbar">
                <div>
                    <h3 className="admin-channel-model-heading">
                        {tr("模型管理")} <span className="admin-channel-count">{items.length}</span>
                    </h3>
                    <p className="admin-channel-model-hint">{tr("点击“自定义排序”调整模型展示顺序；规格展示成本价 / 销售价及加价率，勾选模型可统一调价")}</p>
                </div>
                <Space wrap>
                    <ChannelOrderDialog
                        channelId={channel.id}
                        onSaved={async () => {
                            await reload();
                            await onChanged();
                        }}
                    />
                    <Button loading={fetching} icon={<RefreshCw className="size-4" />} onClick={() => void fetchModels()}>
                        {tr("拉取模型")}
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                        {tr("新增模型")}
                    </Button>
                </Space>
            </div>
            {loadError ? (
                <div className="admin-channel-load-error" role="alert">
                    <span>{loadError}</span>
                    <Button size="small" onClick={() => void reload()}>
                        {tr("重新加载模型")}
                    </Button>
                </div>
            ) : null}
            <AdminDataTable
                empty={
                    <AdminTableEmpty
                        title={loadError ? tr("模型列表加载失败") : items.length ? tr("没有匹配的模型") : tr("这个渠道还没有模型")}
                        description={loadError ? tr("请重试加载，暂时无法确认模型列表。") : items.length ? tr("调整搜索或筛选条件后重试。") : tr("点击上方“拉取模型”从上游导入，或手动新增模型。")}
                    />
                }
                toolbar={
                    <Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={tr("搜索模型标识或显示名称")}
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? (
                            <AdminFilterChip
                                label={tr("搜索：{0}", keyword)}
                                onRemove={() => {
                                    setKeyword("");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {capability !== "all" ? (
                            <AdminFilterChip
                                label={tr("能力：{0}", capability)}
                                onRemove={() => {
                                    setCapability("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {status !== "all" ? (
                            <AdminFilterChip
                                label={tr("状态：{0}", status === "enabled" ? tr("已启用") : tr("已停用"))}
                                onRemove={() => {
                                    setStatus("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                    </>
                }
                toolbarActive={Boolean(keyword || capability !== "all" || status !== "all")}
                toolbarFilters={
                    <>
                        <Select
                            className="w-32"
                            value={capability}
                            onChange={(value) => {
                                setCapability(value);
                                setPage(1);
                            }}
                            options={[
                                { label: tr("全部能力"), value: "all" },
                                { label: tr("文本"), value: "text" },
                                { label: tr("图片"), value: "image" },
                                { label: tr("视频"), value: "video" },
                                { label: tr("音频"), value: "audio" },
                            ]}
                        />
                        <Select
                            className="w-32"
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: tr("全部状态"), value: "all" },
                                { label: tr("已启用"), value: "enabled" },
                                { label: tr("已停用"), value: "disabled" },
                            ]}
                        />
                    </>
                }
                onReset={() => {
                    setKeyword("");
                    setCapability("all");
                    setStatus("all");
                    setPage(1);
                }}
                batchActions={
                    <AdminBatchBar count={selectedModelIds.length} onClear={() => setSelectedModelIds([])}>
                        <Button danger size="small" icon={<Trash2 className="size-3.5" />} loading={deletingSelected} onClick={confirmBatchRemove}>
                            {tr("批量删除")}
                        </Button>
                    </AdminBatchBar>
                }
                table={{
                    className: "app-data-table",
                    rowKey: "id",
                    size: "small",
                    loading,
                    rowSelection: {
                        selectedRowKeys: selectedModelIds,
                        preserveSelectedRowKeys: true,
                        onChange: (keys) => {
                            const next = keys.map(String);
                            if (next.length > 100) message.warning(tr("单次最多选择 100 个模型"));
                            setSelectedModelIds(next.slice(0, 100));
                        },
                    },
                    columns,
                    dataSource: pagedItems,
                    pagination: false,
                    scroll: { x: 1090 },
                }}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filteredItems.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
            <Modal
                title={tr("选择要导入的模型")}
                open={fetchPreviewOpen}
                centered
                width={720}
                rootClassName="admin-modal-root admin-model-import-modal"
                onCancel={closeFetchPreview}
                maskClosable={!importing}
                closable={!importing}
                footer={[
                    <Button key="cancel" disabled={importing} onClick={closeFetchPreview}>
                        {tr("取消")}
                    </Button>,
                    <Button key="confirm" type="primary" loading={importing} disabled={!selectedFetchModels.length} onClick={() => void importSelectedModels()}>
                        {tr("确认导入")}
                    </Button>,
                ]}
            >
                <div className="space-y-3">
                    <p className="m-0 text-sm text-foreground/65">{tr("上游共返回 {0} 个模型。默认勾选已存在的模型，新模型默认不勾选；可批量全选或取消全选，已存在的模型不会重复导入。", fetchPreviewModels.length)}</p>
                    <Input
                        allowClear
                        autoFocus
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={fetchKeyword}
                        placeholder={tr("搜索模型标识，例如 minimax、sd2.5")}
                        aria-label={tr("搜索上游模型")}
                        disabled={importing}
                        onChange={(event) => setFetchKeyword(event.target.value)}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2">
                        <span className="text-sm font-medium text-foreground/70" aria-live="polite">
                            {tr("已选择 {0} / {1} 个模型", selectedFetchModels.length, fetchPreviewModels.length)}
                            {fetchKeywordQuery ? tr("，当前匹配 {0} 个（其中 {1} 个已勾选）", visibleFetchModels.length, selectedVisibleFetchCount) : ""}
                        </span>
                        <Space size={4}>
                            <Button
                                size="small"
                                disabled={importing || !visibleFetchModels.length || allVisibleFetchModelsSelected}
                                onClick={() => setSelectedFetchModels((current) => selectVisibleModels(current, visibleFetchModels))}
                            >
                                {fetchKeywordQuery ? tr("全选匹配的 {0} 个", visibleFetchModels.length) : tr("全选")}
                            </Button>
                            <Button
                                size="small"
                                disabled={importing || selectedVisibleFetchCount === 0}
                                onClick={() => setSelectedFetchModels((current) => deselectVisibleModels(current, visibleFetchModels))}
                            >
                                {fetchKeywordQuery ? tr("取消选中匹配的") : tr("取消全选")}
                            </Button>
                        </Space>
                    </div>
                    <div className="max-h-[min(60vh,520px)] overflow-y-auto rounded-md border border-border/70 p-3">
                        {visibleFetchModels.length ? (
                            <Checkbox.Group
                                className="channel-model-import-picker grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
                                value={selectedFetchModels}
                                options={fetchModelOptions}
                                disabled={importing}
                                onChange={(values) => setSelectedFetchModels(values as string[])}
                            />
                        ) : (
                            <p className="m-0 py-6 text-center text-sm text-foreground/55">
                                {tr("没有匹配「{0}」的模型", fetchKeyword.trim())}
                            </p>
                        )}
                    </div>
                    <div className="text-xs text-foreground/50">
                        {selectedNewFetchModels.length > 0 ? tr("将导入 {0} 个新模型", selectedNewFetchModels.length) : tr("当前勾选的模型均已存在")}
                        {selectedExistingFetchCount > 0 ? tr("，另有 {0} 个已存在模型已勾选", selectedExistingFetchCount) : ""}
                    </div>
                </div>
            </Modal>
            {editorOpen && (
                <ChannelModelEditor
                    channel={channel}
                    editing={editing}
                    draftValues={copyDraft ?? undefined}
                    protocols={availableProtocols}
                    protocolLoading={protocolLoading}
                    protocolError={protocolError}
                    onRetryProtocols={() => void loadProtocols()}
                    onClose={() => {
                        setEditorOpen(false);
                        setCopyDraft(null);
                        setEditing(null);
                    }}
                    onSaved={async () => {
                        await reload();
                        await onChanged();
                    }}
                />
            )}
        </div>
    );
}

function capabilityLabel(value: ChannelModel["capability"]) {
    return { text: tr("文本"), image: tr("图片"), video: tr("视频"), audio: tr("音频"), "": tr("待配置") }[value];
}
