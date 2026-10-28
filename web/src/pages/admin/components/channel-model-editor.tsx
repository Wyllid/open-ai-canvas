import { tr } from "@/i18n";
import { useRef, useState } from "react";
import { Alert, App, AutoComplete, Button, Form, Input, Segmented, Switch, Tabs } from "antd";
import { useAdminContext } from "../admin-context";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { FlaskConical, Plus } from "lucide-react";
import { ModelIconPicker } from "@/components/model-logo";
import { ModelIcon } from "@/components/model-picker";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { createAdminChannelModel, testAdminChannelModel, updateAdminChannelModel, type ChannelModel } from "@/services/api/channel-models";
import type { ModelChannel } from "@/stores/use-config-store";
import { defaultPriceTier, normalizeUpstreamModelKey, priceTierPayloadFromForm } from "./channel-model-price-tier-form";
import { PriceTierFields } from "./channel-model-price-tier-fields";
import { ChannelModelTagsEditor } from "./channel-model-tags-editor";
import {
    changeChannelModelCapability,
    changeChannelModelProtocol,
    editorSectionForField,
    initialChannelModelValues,
    replaceChannelModelFormValues,
    updateChannelModelUpstreamCapabilities,
    validateChannelModelSpecTiers,
    validateChannelModelProtocol,
    type ChannelModelFormValues as FormValues,
    type EditorSection,
} from "./channel-model-editor-form";

export function ChannelModelEditor({
    channel,
    editing,
    draftValues,
    protocols,
    protocolLoading,
    protocolError,
    onRetryProtocols,
    onClose,
    onSaved,
}: {
    channel: ModelChannel;
    editing: ChannelModel | null;
    draftValues?: FormValues;
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onRetryProtocols: () => void;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { message, modal } = App.useApp();
    const { references } = useAdminContext();
    const displayNameOptions = [...new Set([tr("未分类"), ...references.channels.flatMap((item) => item.modelDisplayNames ?? [])])].sort((a, b) => a.localeCompare(b, "zh-CN")).map((value) => ({ value }));
    const [groupSearch, setGroupSearch] = useState("");
    const [form] = Form.useForm<FormValues>();
    const [initialValues] = useState(() => draftValues ?? initialChannelModelValues(editing, protocols));
    const previousUpstream = useRef(normalizeUpstreamModelKey(initialValues.providerModelKey || initialValues.modelKey));
    const [activeSection, setActiveSection] = useState<EditorSection>("identity");
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [configurationChanged, setConfigurationChanged] = useState(false);
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);
    const modelCapability = Form.useWatch("capability", form);
    const modelProtocol = Form.useWatch("protocol", form);
    const modelKey = Form.useWatch("modelKey", form) || "";
    const providerModelKey = Form.useWatch("providerModelKey", form) || "";
    const capabilityConfig = Form.useWatch("capabilityConfig", form);
    const modelEnabled = Form.useWatch("enabled", form) !== false;
    const priceTiers = Form.useWatch("priceTiers", form) || [];
    const hasDefaultPriceTier = priceTiers.some((tier) => tier.matchMode === "default");
    const tiersWithOwnUpstream = priceTiers.filter((tier) => tier.providerModelKey?.trim());
    const modelUpstream = normalizeUpstreamModelKey(providerModelKey || modelKey);
    const busy = saving || testing;

    const requestClose = () => {
        if (busyRef.current) return;
        if (!dirtyRef.current) {
            onClose();
            return;
        }
        modal.confirm({ title: tr("放弃未保存的修改？"), content: tr("当前修改尚未保存，关闭后将丢弃。"), okText: tr("放弃修改"), cancelText: tr("继续编辑"), onOk: onClose });
    };

    const handleFormValuesChange = (changed: Partial<FormValues>) => {
        dirtyRef.current = true;
        if (changed.capability) {
            replaceChannelModelFormValues(form, changeChannelModelCapability(form.getFieldsValue(true), protocols));
            setConfigurationChanged(true);
        } else if (changed.protocol) {
            replaceChannelModelFormValues(form, changeChannelModelProtocol(form.getFieldsValue(true), changed.protocol, protocols));
            setConfigurationChanged(true);
        } else if (changed.providerModelKey !== undefined || changed.modelKey !== undefined) {
            const values = form.getFieldsValue(true);
            const upstream = normalizeUpstreamModelKey(values.providerModelKey || values.modelKey);
            if (!values.channelLabel?.trim() || values.channelLabel.trim() === previousUpstream.current) {
                form.setFieldValue("channelLabel", upstream);
            }
            previousUpstream.current = upstream;
            const next = updateChannelModelUpstreamCapabilities(values, protocols);
            if (next !== values) {
                form.setFieldValue("capabilityConfig", next.capabilityConfig);
                setConfigurationChanged(true);
            }
        }
    };

    const validateEditor = async (names?: string[]): Promise<FormValues | undefined> => {
        busyRef.current = true;
        try {
            await form.validateFields(names);
            return form.getFieldsValue(true);
        } catch (error) {
            const fields = (error as { errorFields?: { name: (string | number)[] }[] }).errorFields;
            if (fields?.length) {
                setActiveSection(editorSectionForField(fields[0].name));
                requestAnimationFrame(() => form.scrollToField(fields[0].name, { block: "center", focus: true }));
                message.warning(tr("请检查标记的配置项后重试"));
            } else message.error(error instanceof Error ? error.message : tr("表单校验失败"));
            return undefined;
        } finally {
            busyRef.current = false;
        }
    };

    const save = async () => {
        if (busyRef.current) return;
        const values = await validateEditor();
        if (!values) return;
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
        busyRef.current = true;
        setSaving(true);
        try {
            const payload = {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                displayName: values.displayName?.trim() || tr("未分类"),
                channelLabel: values.channelLabel?.trim() || upstreamModel,
                tags: (values.tags || []).map((tag) => ({ text: tag.text.trim(), color: tag.color })),
                description: values.description?.trim() || "",
                icon: values.icon?.trim() || "",
                capability: values.capability,
                protocol: values.protocol,
                priceTiers: values.priceTiers.map((tier) => priceTierPayloadFromForm(values.capability, tier, upstreamModel, capabilityConfig)),
                enabled: values.enabled !== false,
                capabilityConfig,
            };
            if (editing) await updateAdminChannelModel(channel.id, editing.id, payload);
            else await createAdminChannelModel(channel.id, payload);
            try {
                await onSaved();
            } catch {
                message.warning(tr("模型已保存，但列表刷新失败，请手动刷新"));
            }
            onClose();
            message.success(editing ? tr("模型配置已更新") : tr("模型已添加"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("保存模型失败"));
        } finally {
            busyRef.current = false;
            setSaving(false);
        }
    };

    const testModel = async () => {
        if (busyRef.current) return;
        const values = await validateEditor(["modelKey", "providerModelKey", "capability", "protocol", "capabilityConfig"]);
        if (!values) return;
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
        busyRef.current = true;
        setTesting(true);
        try {
            const result = await testAdminChannelModel(channel.id, {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                capability: values.capability,
                protocol: values.protocol,
                capabilityConfig,
            });
            message.success(tr("模型测试通过，耗时 {0} 秒", (result.durationMs / 1000).toFixed(2)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("模型测试失败"));
        } finally {
            busyRef.current = false;
            setTesting(false);
        }
    };

    return (
        <AdminModal
            open
            title={
                <div className="admin-model-editor-title">
                    <span>{draftValues ? tr("复制模型") : editing ? tr("编辑模型") : tr("新增模型")}</span>
                    <p>
                        {channel.name} · {editing?.displayName || editing?.modelKey || draftValues?.displayName || tr("配置调用方式与规格")}
                    </p>
                </div>
            }
            width={1120}
            centered
            rootClassName="admin-modal-root admin-model-editor-modal"
            mask={{ closable: false }}
            keyboard={!busy}
            closable={!busy}
            onCancel={requestClose}
            flush
            styles={{ body: { minHeight: 0, flex: 1 }, header: { margin: 0 }, footer: { margin: 0 } }}
            footer={
                <div className="admin-model-editor-footer-actions">
                    <div className="admin-model-editor-footer-status">
                        <Switch
                            aria-label={tr("启用模型")}
                            checked={modelEnabled}
                            disabled={busy}
                            onChange={(checked) => {
                                dirtyRef.current = true;
                                form.setFieldValue("enabled", checked);
                            }}
                        />
                        <div>
                            <strong>{modelEnabled ? tr("模型启用") : tr("模型停用")}</strong>
                            <small>{tr("保存后生效")}</small>
                        </div>
                    </div>
                    <div className="admin-model-editor-footer-primary">
                        <Button
                            icon={<FlaskConical className="size-4" />}
                            loading={testing}
                            disabled={saving || protocolLoading || Boolean(protocolError)}
                            onClick={() => modal.confirm({ title: tr("测试模型连接？"), content: tr("测试会向上游发送真实请求，可能产生供应商费用；不会保存当前修改。"), okText: tr("开始测试"), cancelText: tr("取消"), onOk: testModel })}
                        >
                            {tr("测试模型")}
                        </Button>
                        <Button disabled={busy} onClick={requestClose}>
                            {tr("取消")}
                        </Button>
                        <Button type="primary" loading={saving} disabled={testing || protocolLoading || Boolean(protocolError)} onClick={() => void save()}>
                            {editing ? tr("保存修改") : tr("添加模型")}
                        </Button>
                    </div>
                </div>
            }
        >
            <Form className="admin-model-editor-form" form={form} initialValues={initialValues} layout="vertical" disabled={busy} inert={busy} onValuesChange={handleFormValuesChange}>
                <Form.Item name="capabilityConfig" noStyle>
                    <CapabilityConfigField />
                </Form.Item>
                <Form.Item name="enabled" noStyle>
                    <EnabledConfigField />
                </Form.Item>
                <Tabs
                    activeKey={activeSection}
                    onChange={(key) => setActiveSection(key as EditorSection)}
                    animated={false}
                    items={[
                        {
                            key: "identity",
                            label: tr("基本信息"),
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title={tr("模型身份")} description={tr("区分产品侧展示标识与上游实际调用 ID。")} />
                                        <div className="admin-model-editor-section-content admin-model-identity-grid admin-model-identity-grid-with-icon">
                                            <Form.Item
                                                name="modelKey"
                                                label={tr("产品模型标识")}
                                                tooltip={tr("不同渠道使用相同标识时，创作端归为同一个产品模型。不同版本（例如 Fast）应使用不同标识；请勿为分组随意修改已有标识。")}
                                                rules={[{ required: true, whitespace: true, message: tr("请输入产品模型标识") }]}
                                            >
                                                <Input
                                                    prefix={
                                                        <span className="grid size-6 place-items-center">
                                                            <ModelIcon model={modelKey} />
                                                        </span>
                                                    }
                                                    placeholder={tr("例如：seedance-2-5")}
                                                />
                                            </Form.Item>
                                            <Form.Item name="providerModelKey" label={tr("上游模型 ID")} tooltip={tr("实际发送给供应商；留空时使用产品模型标识。规格档可配置独立上游 ID，命中时优先于此处。")}>
                                                <Input placeholder={tr("留空则使用产品模型标识")} />
                                            </Form.Item>
                                            <Form.Item name="displayName" label={tr("模型展示名（一级目录）")} tooltip={tr("跨所有系统渠道按此名称分组；新模型默认未分类。同名模型归入同一组，不改变调用 ID。")}>
                                                <AutoComplete
                                                    options={displayNameOptions}
                                                    filterOption={(_, option) => Boolean(option?.value.toLowerCase().includes(groupSearch.trim().toLowerCase()))}
                                                    onSearch={setGroupSearch}
                                                    onFocus={() => setGroupSearch("")}
                                                    onOpenChange={(open) => {
                                                        if (open) setGroupSearch("");
                                                    }}
                                                    placeholder={tr("选择已有分组或输入新名称，默认为未分类")}
                                                    allowClear
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                name="channelLabel"
                                                label={tr("渠道展示名（二级目录）")}
                                                tooltip={tr("默认跟随上游模型 ID；手动名称最多 80 字。")}
                                                rules={[
                                                    {
                                                        validator: async (_, value: string | undefined) => {
                                                            if (value?.trim() !== modelUpstream && Array.from(value?.trim() || "").length > 80) throw new Error(tr("渠道展示名不能超过 80 字"));
                                                        },
                                                    },
                                                ]}
                                            >
                                                <Input maxLength={80} placeholder={modelUpstream || tr("默认使用上游模型 ID")} />
                                            </Form.Item>
                                            <Form.Item name="icon" label={tr("模型 Logo")}>
                                                <ModelIconPicker />
                                            </Form.Item>
                                        </div>
                                        {tiersWithOwnUpstream.length ? (
                                            <Alert
                                                type="info"
                                                showIcon
                                                title={tr("{0} 个规格档配置了独立上游模型 ID", tiersWithOwnUpstream.length)}
                                                description={tr("命中的请求会优先使用规格档的上游 ID；修改上方上游模型 ID 时，只有与旧值相同的档位会自动跟随更新，其余保持不变。")}
                                            />
                                        ) : null}
                                        <ChannelModelTagsEditor />
                                        <Form.Item name="description" label={tr("模型描述")} extra={tr("在创作端二级渠道选项中常驻显示，可说明适用场景、渠道差异和注意事项。")} rules={[{ max: 500, message: tr("模型描述不能超过 500 字") }]}>
                                            <Input.TextArea rows={3} maxLength={500} showCount placeholder={tr("填写此渠道模型的使用说明")} />
                                        </Form.Item>
                                    </section>
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title={tr("能力与协议")} description={tr("先选任务类型，再选择对应的调用协议；更换后请核对参数与规格。")} />
                                        <div className="admin-model-editor-section-content admin-model-protocol-grid">
                                            <Form.Item name="capability" label={tr("模型能力")} rules={[{ required: true }]}>
                                                <Segmented
                                                    block
                                                    options={[
                                                        { label: tr("文本"), value: "text" },
                                                        { label: tr("图片"), value: "image" },
                                                        { label: tr("视频"), value: "video" },
                                                        { label: tr("音频"), value: "audio" },
                                                    ]}
                                                />
                                            </Form.Item>
                                            <Form.Item className="admin-model-protocol-field" name="protocol" label={tr("调用协议")} rules={[{ validator: async (_, value) => validateChannelModelProtocol(form.getFieldValue("capability"), value, protocols) }]}>
                                                <ModelProtocolBrowser disabled={busy} capability={modelCapability} protocols={protocols} loading={protocolLoading} error={protocolError} />
                                            </Form.Item>
                                            {protocolError && (
                                                <Alert
                                                    type="error"
                                                    showIcon
                                                    title={tr("协议目录读取失败")}
                                                    description={protocolError}
                                                    action={
                                                        <Button size="small" onClick={onRetryProtocols}>
                                                            {tr("重试")}
                                                        </Button>
                                                    }
                                                />
                                            )}
                                        </div>
                                    </section>
                                </div>
                            ),
                        },
                        {
                            key: "capabilities",
                            label: tr("能力与参数"),
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    {configurationChanged && <Alert type="warning" showIcon title={tr("能力或协议已变更")} description={tr("引用与参数已恢复为新协议默认值，旧规格条件已在切换能力时清除，请在保存前核对。")} />}{" "}
                                    {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                                        <section className="admin-model-editor-section admin-model-editor-section-stacked admin-model-editor-references">
                                            <SectionHeading title={tr("引用与限制")} description={tr("按媒体类型纵向配置数量、大小、时长及通用约束。")} />
                                            <div className="admin-model-editor-section-content">
                                                <ModelCapabilityEditor
                                                    capability={modelCapability}
                                                    model={providerModelKey || modelKey}
                                                    protocol={form.getFieldValue("protocol")}
                                                    section="references"
                                                    imageParameters={protocols.find((item) => item.value === modelProtocol)?.imageParameters}
                                                    workflows={protocols.find((item) => item.value === modelProtocol)?.workflows}
                                                    value={capabilityConfig}
                                                    onChange={(next) => {
                                                        dirtyRef.current = true;
                                                        form.setFieldValue("capabilityConfig", next);
                                                    }}
                                                />
                                            </div>
                                        </section>
                                    ) : null}
                                    {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                                        <section className="admin-model-editor-section admin-model-editor-section-stacked admin-model-editor-parameters">
                                            <SectionHeading title={tr("协议参数")} description={tr("配置可发送参数、支持值与默认值；仅影响当前模型。")} />
                                            <div className="admin-model-editor-section-content">
                                                <ModelCapabilityEditor
                                                    capability={modelCapability}
                                                    model={providerModelKey || modelKey}
                                                    protocol={form.getFieldValue("protocol")}
                                                    section="protocol"
                                                    imageParameters={protocols.find((item) => item.value === modelProtocol)?.imageParameters}
                                                    workflows={protocols.find((item) => item.value === modelProtocol)?.workflows}
                                                    value={capabilityConfig}
                                                    onChange={(next) => {
                                                        dirtyRef.current = true;
                                                        form.setFieldValue("capabilityConfig", next);
                                                    }}
                                                />
                                            </div>
                                        </section>
                                    ) : null}
                                    {modelCapability === "audio" && <Alert type="info" title={tr("音频模型无需额外配置引用与参数")} description={tr("调用协议和规格仍需在对应分组中配置。")} />}
                                </div>
                            ),
                        },
                        {
                            key: "pricing",
                            label: tr("规格"),
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    {configurationChanged && <Alert type="warning" showIcon title={tr("请核对规格")} description={tr("能力或协议已变更。请重新检查规格条件。")} />}{" "}
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title={tr("模型规格")} description={tr("默认只需一个统一规格；需要按生成方式、质量或尺寸路由到不同上游模型时，再添加规格档。")} />
                                        <div className="admin-model-editor-section-content">
                                            <Form.List
                                                name="priceTiers"
                                                rules={[
                                                    {
                                                        validator: async (_, value) => {
                                                            validateChannelModelSpecTiers({ capability: form.getFieldValue("capability"), priceTiers: value });
                                                        },
                                                    },
                                                ]}
                                            >
                                                {(fields, { add, remove }, { errors }) => (
                                                    <div className="admin-price-tier-list-shell">
                                                        <div className="admin-price-tier-list" aria-label={tr("规格档列表")}>
                                                            {fields.map((field, index) => (
                                                                <PriceTierFields
                                                                    key={field.key}
                                                                    index={field.name}
                                                                    ordinal={index + 1}
                                                                    form={form}
                                                                    capability={modelCapability}
                                                                    protocol={modelProtocol}
                                                                    capabilityConfig={capabilityConfig}
                                                                    modelUpstream={modelUpstream}
                                                                    onDirty={() => {
                                                                        dirtyRef.current = true;
                                                                    }}
                                                                    onRemove={() => remove(field.name)}
                                                                />
                                                            ))}
                                                        </div>
                                                        <div className="admin-price-tier-list-footer">
                                                            <Button className="admin-model-editor-add-tier" type="dashed" block icon={<Plus className="size-4" />} onClick={() => add(defaultPriceTier(hasDefaultPriceTier ? "advanced" : "default"))}>
                                                                {hasDefaultPriceTier ? tr("新增规格档") : tr("新增统一默认规格")}
                                                            </Button>
                                                            <Form.ErrorList errors={errors} />
                                                        </div>
                                                    </div>
                                                )}
                                            </Form.List>
                                        </div>
                                    </section>
                                </div>
                            ),
                        },
                    ]}
                />
            </Form>
        </AdminModal>
    );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
    return (
        <header className="admin-model-editor-section-heading">
            <h2>{title}</h2>
            <p>{description}</p>
        </header>
    );
}
function CapabilityConfigField(_: { value?: ModelCapabilityConfig; onChange?: (value: ModelCapabilityConfig) => void }) {
    return null;
}
function EnabledConfigField(_: { value?: boolean; onChange?: (value: boolean) => void }) {
    return null;
}
