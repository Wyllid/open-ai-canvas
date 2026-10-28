import { currentLocale, tr } from "@/i18n";
import { App, Button, Form, Input, InputNumber, Skeleton } from "antd";
import { Select } from "@/pages/admin/ui/controls";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, AtSign, BadgeCheck, KeyRound, MailCheck, RefreshCw, RotateCcw, Save, Send, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminEmailSetting, updateAdminEmailSetting, type EmailSetting } from "@/services/api/admin-settings";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";

type EmailFormValues = Pick<EmailSetting, "enabled" | "host" | "port" | "username" | "password" | "encryption" | "fromEmail" | "fromName"> & {
    registrationAllowedDomains: string;
};

type NormalizedEmailFormValues = Omit<EmailFormValues, "registrationAllowedDomains"> & {
    registrationAllowedDomains: string[];
};

export default function EmailSettingsPanel() {
    const { message, modal } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const [setting, setSetting] = useState<EmailSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftEnabled, setDraftEnabled] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<EmailFormValues>();
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminEmailSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isEmailSetting(result.setting)) throw new Error(tr("服务端返回的邮件配置格式无效"));
                setSetting(result.setting);
                setDirty(false);
                setSaveError("");
                if (announce) message.success(tr("已重新读取当前邮件服务配置"));
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : tr("读取邮件配置失败");
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

    useEffect(() => {
        if (loading || !setting) return;
        form.setFieldsValue(toEmailFormValues(setting));
        setDraftEnabled(setting.enabled);
    }, [form, loading, setting]);

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
            title: tr("放弃邮件服务调整？"),
            content: tr("当前 SMTP 表单有尚未保存的调整，离开后这些内容会丢失。服务端正在使用的邮件配置不会改变。"),
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
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-email-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        form.setFieldsValue(toEmailFormValues(setting));
        form.setFields([]);
        setDraftEnabled(setting.enabled);
        setDirty(false);
        setSaveError("");
        message.info(tr("已撤销邮件服务的未保存调整"));
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: tr("放弃调整并重新读取？"),
            content: tr("重新读取会丢弃当前 SMTP 表单中的未保存内容，并以服务端配置为准。"),
            okText: tr("放弃并刷新"),
            cancelText: tr("继续编辑"),
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const save = async (values: EmailFormValues) => {
        const expected = normalizeEmailFormValues(values);
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminEmailSetting(expected);
            if (!isEmailSetting(result.setting) || !emailResponseMatches(result.setting, expected)) throw new Error(tr("服务端返回的邮件配置与本次保存内容不一致，请重新读取后核对"));
            setSetting(result.setting);
            form.setFieldsValue(toEmailFormValues(result.setting));
            setDraftEnabled(result.setting.enabled);
            setDirty(false);
            message.success(tr("邮件服务配置已保存"));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : tr("保存邮件配置失败");
            setSaveError(tr("{0}。未自动重试，请重新读取当前配置后再决定是否保存。", errorMessage));
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    };

    const submitSave = async () => {
        let values: EmailFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const validationError = validateEmailDraft(values, setting);
        if (validationError) {
            message.error(validationError);
            return;
        }
        try {
            await save(values);
        } catch {
            // 保存错误已在 save 中就地提示。
        }
    };

    const toggleEnabled = (enabled: boolean) => {
        if (!setting || saving) return;
        form.setFieldValue("enabled", enabled);
        setDraftEnabled(enabled);
        setDirty(hasEmailChanges({ ...form.getFieldsValue(true), enabled }, setting));
        setSaveError("");
    };

    if (loading && !setting) {
        return (
            <div className="admin-settings-stack admin-email-settings" aria-label={tr("正在读取邮件服务配置")} role="status">
                <div className="admin-email-loading-card">
                    <Skeleton active paragraph={{ rows: 7 }} />
                </div>
            </div>
        );
    }

    if (!setting) {
        return (
            <div className="admin-settings-stack admin-email-settings">
                <div className="admin-email-load-error" role="alert">
                    <span className="admin-email-load-error-icon">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                        <h2>{tr("无法读取邮件服务配置")}</h2>
                        <p>{loadError || tr("当前没有可显示的配置，请稍后重试。")}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                        {tr("重新读取")}
                    </Button>
                </div>
            </div>
        );
    }

    const currentValues = normalizeEmailFormValues(form.getFieldsValue(true));
    const smtpReady = Boolean(currentValues.host && currentValues.port && currentValues.fromEmail);

    return (
        <div className="admin-settings-stack admin-email-settings">
            <div className={cn("admin-email-command-bar", dirty && "is-dirty")}>
                <div className="admin-email-command-copy" aria-live="polite">
                    <span className="admin-email-command-icon">
                        <MailCheck className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <strong>{dirty ? tr("有未保存的邮件调整") : tr("账户邮件：{0}", setting.enabled ? tr("已启用") : tr("未启用"))}</strong>
                        <p>{dirty ? tr("完成当前配置后保存生效。") : formatSettingTime(setting.updatedAt, tr("使用系统默认值"))}</p>
                    </div>
                </div>
                <div className="admin-email-command-actions">
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
                <div className="admin-email-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || tr("{0}。页面仍显示上一次成功读取的配置。", loadError)}</span>
                </div>
            ) : null}

            <div id="admin-email-delivery" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-email-section admin-email-delivery-section"
                    icon={<Send className="size-4" aria-hidden="true" />}
                    title={tr("1. 是否发送账户安全邮件")}
                    description={tr("这是注册验证码和密码找回邮件的主开关。关闭时不需要配置 SMTP；开启后再填写连接与发件信息。")}
                    status={<AdminStatusBadge label={draftEnabled ? (dirty && !setting.enabled ? tr("待启用") : tr("已启用")) : dirty && setting.enabled ? tr("待停用") : tr("未启用")} tone={dirty ? "warning" : draftEnabled ? "success" : "neutral"} />}
                    footer={
                        !draftEnabled ? (
                            <>
                                <div className="admin-email-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>{tr("关闭后，普通邮箱注册和密码找回都无法发送验证码。")}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {dirty ? (
                                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                            {tr("撤销")}
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                        {tr("保存设置")}
                                    </Button>
                                </div>
                            </>
                        ) : undefined
                    }
                >
                    <div className="admin-email-delivery-policy">
                        <span className="admin-email-policy-icon">
                            <MailCheck className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-email-policy-copy">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{tr("发送注册与密码找回验证码")}</strong>
                                <AdminStatusBadge label={tr("保存后生效")} tone="info" />
                            </div>
                            <p>{tr("启用后，普通邮箱注册和密码找回使用 6 位验证码；邮件发送失败时不会保留可用验证码。")}</p>
                            <span>{tr("关闭只停止后续账户邮件，不改变新用户注册开关，也不影响已有登录会话。")}</span>
                        </div>
                        <Switch checked={draftEnabled} disabled={loading || refreshing || saving} aria-label={tr("发送账户安全邮件")} onChange={toggleEnabled} />
                    </div>
                </SettingsSectionCard>
            </div>

            <Form
                form={form}
                className="admin-email-form-stack"
                layout="vertical"
                requiredMark={false}
                disabled={loading || refreshing || saving}
                onValuesChange={() => {
                    const values = form.getFieldsValue(true);
                    setDraftEnabled(Boolean(values.enabled));
                    setDirty(hasEmailChanges(values, setting));
                    setSaveError("");
                }}
            >
                <Form.Item name="enabled" valuePropName="checked" hidden>
                    <Switch />
                </Form.Item>

                {draftEnabled ? (
                    <div id="admin-email-smtp" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-email-section admin-email-configuration-section"
                        icon={<Server className="size-4" aria-hidden="true" />}
                        title={tr("2. 配置 SMTP 连接与发件身份")}
                        description={tr("填写邮件服务器、身份验证和发件人信息。保存不会主动探测或发送测试邮件。")}
                        status={<AdminStatusBadge label={dirty ? tr("待保存") : smtpReady ? tr("已配置") : tr("待配置")} tone={dirty ? "warning" : smtpReady ? "success" : "neutral"} />}
                        footer={
                            <>
                                <div className="admin-email-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>{tr("SMTP 密码由服务端加密保存且不回显明文")}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {dirty ? (
                                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                            {tr("撤销")}
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                        {draftEnabled ? tr("保存并启用") : tr("保存设置")}
                                    </Button>
                                </div>
                            </>
                        }
                    >
                            <div className="admin-email-form-section">
                                <FormSectionTitle icon={<Server className="size-4" />} title={tr("服务器连接")} description={tr("填写 SMTP 主机、端口和传输加密；STARTTLS 通常使用 587，直接 TLS 通常使用 465。")} />
                                <div className="admin-email-form-grid is-connection">
                                    <Form.Item name="host" label={tr("SMTP 主机")} extra={tr("仅填写主机名或 IP，不包含协议和端口。")}>
                                        <Input autoComplete="off" placeholder="smtp.example.com" />
                                    </Form.Item>
                                    <Form.Item
                                        name="port"
                                        label={tr("SMTP 端口")}
                                        rules={[
                                            {
                                                validator: (_, value: number | null | undefined) => (!draftEnabled || (Number(value) >= 1 && Number(value) <= 65535) ? Promise.resolve() : Promise.reject(new Error(tr("请输入 1 至 65535 的端口")))),
                                            },
                                        ]}
                                    >
                                        <InputNumber min={1} max={65535} precision={0} placeholder="587" controls={false} />
                                    </Form.Item>
                                    <Form.Item name="encryption" label={tr("连接加密")} rules={[{ required: true, message: tr("请选择连接加密方式") }]}>
                                        <Select
                                            options={[
                                                { label: tr("STARTTLS（推荐，通常 587）"), value: "starttls" },
                                                { label: tr("直接 TLS（通常 465）"), value: "tls" },
                                                { label: tr("无加密（仅限可信网络）"), value: "none" },
                                            ]}
                                        />
                                    </Form.Item>
                                </div>
                            </div>

                            <div className="admin-email-form-section">
                                <FormSectionTitle icon={<KeyRound className="size-4" />} title={tr("SMTP 身份验证")} description={tr("服务器要求登录时填写账号和密码；密码留空会保留服务端已配置值。")} />
                                <div className="admin-email-form-grid">
                                    <Form.Item name="username" label={tr("SMTP 用户名")} extra={tr("通常是完整邮箱地址；无需验证的服务器可留空。")}>
                                        <Input autoComplete="off" placeholder="mailer@example.com" />
                                    </Form.Item>
                                    <Form.Item name="password" label={setting.hasPassword ? tr("SMTP 密码（{0}）", configuredSecretText) : tr("SMTP 密码")} extra={tr("只在需要新增或替换密码时填写。")}>
                                        <Input.Password autoComplete="new-password" placeholder={setting.hasPassword ? tr("留空保留原密码") : tr("SMTP 密码或服务商授权码")} />
                                    </Form.Item>
                                </div>
                            </div>

                            <div className="admin-email-form-section">
                                <FormSectionTitle icon={<AtSign className="size-4" />} title={tr("发件人身份")} description={tr("这组名称和地址会显示在注册与密码重置邮件的 From 信息中。")} />
                                <div className="admin-email-form-grid">
                                    <Form.Item
                                        name="fromEmail"
                                        label={tr("发件邮箱")}
                                        rules={[
                                            {
                                                validator: (_, value: string | undefined) => (!draftEnabled || !value || isValidEmail(value.trim()) ? Promise.resolve() : Promise.reject(new Error(tr("请输入有效的发件邮箱")))),
                                            },
                                        ]}
                                        extra={tr("通常需要与 SMTP 账号或服务商验证域名一致。")}
                                    >
                                        <Input autoComplete="off" inputMode="email" placeholder="noreply@example.com" />
                                    </Form.Item>
                                    <Form.Item
                                        name="fromName"
                                        label={tr("发件人名称")}
                                        rules={[
                                            {
                                                validator: (_, value: string | undefined) => (!draftEnabled || !value || !/[\r\n]/.test(value) ? Promise.resolve() : Promise.reject(new Error(tr("发件人名称不能包含换行")))),
                                            },
                                        ]}
                                        extra={tr("留空时自动使用当前站点名称“{0}”；之后修改站点名称会同步更新。", brandName)}
                                    >
                                        <Input placeholder={brandName} />
                                    </Form.Item>
                                </div>
                            </div>
                    </SettingsSectionCard>
                    </div>
                ) : null}

                <div id="admin-email-registration-domains" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-email-section"
                        icon={<MailCheck className="size-4" aria-hidden="true" />}
                        title={tr("3. 电子邮件域名白名单")}
                        description={tr("每行填写一个允许注册的邮箱域名；不在白名单内的邮箱无法注册。")}
                        status={<AdminStatusBadge label={currentValues.registrationAllowedDomains.length > 0 ? tr("已限制范围") : tr("不限制服务商")} tone={currentValues.registrationAllowedDomains.length > 0 ? "info" : "neutral"} />}
                        footer={
                            <>
                                <div className="admin-email-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>{tr("规则只影响新用户注册，不限制发件邮箱和已有账号找回密码")}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {dirty ? (
                                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                            {tr("撤销")}
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                        {tr("保存设置")}
                                    </Button>
                                </div>
                            </>
                        }
                    >
                            <div className="admin-email-form-section">
                                <Form.Item
                                    name="registrationAllowedDomains"
                                    label={tr("电子邮件域名白名单")}
                                    extra={tr("每行一个域名。留空保存表示不限制邮箱域名。")}
                                    rules={[{ validator: (_, value: string | undefined) => validateDomainList(value) }]}
                                >
                                    <Input.TextArea
                                        autoSize={{ minRows: 9, maxRows: 16 }}
                                        placeholder="gmail.com&#10;163.com&#10;126.com&#10;qq.com"
                                        spellCheck={false}
                                    />
                                </Form.Item>
                            </div>
                    </SettingsSectionCard>
                </div>
            </Form>
        </div>
    );
}

function FormSectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
    return (
        <div className="admin-email-form-section-heading">
            <span>{icon}</span>
            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    );
}

function toEmailFormValues(setting: EmailSetting): EmailFormValues {
    return {
        enabled: setting.enabled,
        host: setting.host,
        port: setting.port,
        username: setting.username,
        password: "",
        encryption: setting.encryption,
        fromEmail: setting.fromEmail,
        fromName: setting.fromNameInherited ? "" : setting.fromName,
        registrationAllowedDomains: setting.registrationAllowedDomains.join("\n"),
    };
}

function normalizeEmailFormValues(values: Partial<EmailFormValues>): NormalizedEmailFormValues {
    return {
        enabled: Boolean(values.enabled),
        host: values.host?.trim() || "",
        port: Number(values.port) || 587,
        username: values.username?.trim() || "",
        password: values.password?.trim() || "",
        encryption: values.encryption === "tls" || values.encryption === "none" ? values.encryption : "starttls",
        fromEmail: values.fromEmail?.trim().toLowerCase() || "",
        fromName: values.fromName?.trim() || "",
        registrationAllowedDomains: normalizeDomains(values.registrationAllowedDomains),
    };
}

function hasEmailChanges(values: Partial<EmailFormValues>, setting: EmailSetting | null) {
    if (!setting) return false;
    const draft = normalizeEmailFormValues(values);
    const saved = normalizeEmailFormValues(toEmailFormValues(setting));
    if (draft.password) return true;
    const scalarFields: Array<keyof EmailFormValues> = ["enabled", "host", "port", "username", "encryption", "fromEmail", "fromName"];
    return scalarFields.some((key) => draft[key] !== saved[key]) || !arraysEqual(draft.registrationAllowedDomains, saved.registrationAllowedDomains);
}

function validateEmailDraft(values: EmailFormValues, setting: EmailSetting | null) {
    const draft = normalizeEmailFormValues(values);
    if (!draft.enabled) return "";
    if (/\r|\n/.test(draft.fromName)) return tr("发件人名称不能包含换行");
    if (!draft.host || draft.port < 1 || draft.port > 65535 || !draft.fromEmail) return tr("启用邮件服务前请完整填写 SMTP 主机、端口和发件邮箱");
    if (!isValidEmail(draft.fromEmail)) return tr("发件邮箱格式不正确");
    if (draft.username && !draft.password && !setting?.hasPassword) return tr("SMTP 用户名已填写，请同时填写密码或服务商授权码");
    return "";
}

function emailResponseMatches(setting: EmailSetting, expected: NormalizedEmailFormValues) {
    const actual = normalizeEmailFormValues(toEmailFormValues(setting));
    const fields: Array<keyof EmailFormValues> = ["enabled", "host", "port", "username", "encryption", "fromEmail", "fromName"];
    if (expected.password && !setting.hasPassword) return false;
    return fields.every((key) => actual[key] === expected[key]) && arraysEqual(actual.registrationAllowedDomains, expected.registrationAllowedDomains);
}

function isEmailSetting(value: unknown): value is EmailSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<EmailSetting>;
    return (
        typeof setting.enabled === "boolean" &&
        typeof setting.host === "string" &&
        typeof setting.port === "number" &&
        typeof setting.username === "string" &&
        ["starttls", "tls", "none"].includes(setting.encryption || "") &&
        typeof setting.fromEmail === "string" &&
        typeof setting.fromName === "string" &&
        typeof setting.fromNameInherited === "boolean" &&
        typeof setting.hasPassword === "boolean" &&
        Array.isArray(setting.registrationAllowedDomains) &&
        setting.registrationAllowedDomains.every((value) => typeof value === "string")
    );
}

function normalizeDomains(value?: string) {
    return Array.from(
        new Set(
            (value || "")
                .split(/[\s,，;；]+/)
                .map((domain) => domain.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, ""))
                .filter(Boolean),
        ),
    );
}

function arraysEqual(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateDomainList(value?: string) {
    const invalid = invalidDomain(value);
    return invalid ? Promise.reject(new Error(tr("邮箱域名格式不正确：“{0}”", invalid))) : Promise.resolve();
}

function invalidDomain(value?: string) {
    return normalizeDomains(value).find((domain) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain));
}

function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatSettingTime(value: string | undefined, fallback: string) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return fallback;
    return tr("更新于 {0}", date.toLocaleString(currentLocale(), { hour12: false }));
}
