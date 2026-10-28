import { tr } from "@/i18n";
import { App, Button, Form, Input, InputNumber, Switch } from "antd";
import { Bot, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Select } from "@/components/ui/base/select";
import { getAgentModelSetup, saveAgentModelSetup, type AgentModelProtocol, type AgentModelSetup } from "@/services/api/agent-model-setup";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { agentModelProtocolOptions, agentModelSetupPayload, type AgentModelFormValues } from "./agent-model-setup-form";

/** One form that creates the agent's text channel and model, instead of building the catalog by hand. */
export function AgentModelSetupCard({ onSaved }: { onSaved?: () => void | Promise<void> }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<AgentModelFormValues>();
    const [setup, setSetup] = useState<AgentModelSetup | null>(null);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        let active = true;
        getAgentModelSetup()
            .then(({ setup }) => {
                if (!active) return;
                setSetup(setup);
                form.setFieldsValue({ protocol: setup.protocol, baseUrl: setup.baseUrl, model: setup.model, vision: setup.vision, contextWindowTokens: setup.contextWindowTokens, maxOutputTokens: setup.maxOutputTokens, apiKey: "" });
            })
            .catch((error: unknown) => active && setLoadError(error instanceof Error ? error.message : tr("Could not read the agent model setup")));
        return () => {
            active = false;
        };
    }, [form]);

    const submit = async (values: AgentModelFormValues) => {
        setSaving(true);
        try {
            const { setup } = await saveAgentModelSetup(agentModelSetupPayload(values));
            setSetup(setup);
            form.setFieldValue("apiKey", "");
            message.success(tr("Agent model saved. New agent runs use it."));
            await onSaved?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("Could not save the agent model"));
        } finally {
            setSaving(false);
        }
    };

    const status = setup?.configured ? <AdminStatusBadge tone={setup.enabled ? "success" : "warning"} label={setup.enabled ? tr("Configured") : tr("Disabled")} /> : <AdminStatusBadge label={tr("Not set")} />;

    return (
        <SettingsSectionCard
            icon={<Bot className="size-4" />}
            title={tr("Agent model")}
            description={tr("Point the canvas agent at any OpenAI-compatible or Anthropic endpoint. This creates the channel and text model for you; you can still edit them below.")}
            status={status}
            layout="stacked"
            className="admin-agent-model-setup"
        >
            {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
            <Form form={form} layout="vertical" requiredMark={false} disabled={!setup} onFinish={(values) => void submit(values)} initialValues={{ protocol: "chat-completion", vision: false }}>
                <div className="grid gap-x-4 md:grid-cols-2">
                    <Form.Item name="protocol" label={tr("API format")} rules={[{ required: true, message: tr("Choose an API format") }]}>
                        <Select
                            options={agentModelProtocolOptions.map(({ label, value }) => ({ label, value }))}
                            onChange={(value: AgentModelProtocol) => {
                                const current = form.getFieldValue("baseUrl");
                                const known = agentModelProtocolOptions.some((option) => option.baseUrl === current);
                                if (!current || known) form.setFieldValue("baseUrl", agentModelProtocolOptions.find((option) => option.value === value)?.baseUrl);
                            }}
                        />
                    </Form.Item>
                    <Form.Item name="baseUrl" label={tr("Base URL")} rules={[{ required: true, whitespace: true, message: tr("Enter the base URL") }]}>
                        <Input autoComplete="off" placeholder="https://api.openai.com/v1" />
                    </Form.Item>
                    <Form.Item name="model" label={tr("Model name")} rules={[{ required: true, whitespace: true, message: tr("Enter the model name") }]}>
                        <Input autoComplete="off" placeholder={tr("gpt-5.1, claude-sonnet-4-5, deepseek-chat…")} />
                    </Form.Item>
                    <Form.Item name="apiKey" label={tr("API key")} rules={[{ required: !setup?.hasApiKey, whitespace: true, message: tr("Enter the API key") }]}>
                        <Input.Password autoComplete="new-password" placeholder={setup?.hasApiKey ? tr("Leave empty to keep the saved key") : "sk-…"} />
                    </Form.Item>
                    <Form.Item name="contextWindowTokens" label={tr("Context window (tokens)")}>
                        <InputNumber min={4096} max={10000000} precision={0} controls={false} className="w-full" placeholder="128000" />
                    </Form.Item>
                    <Form.Item name="maxOutputTokens" label={tr("Max output (tokens)")}>
                        <InputNumber min={256} max={1000000} precision={0} controls={false} className="w-full" placeholder="16384" />
                    </Form.Item>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Form.Item name="vision" valuePropName="checked" noStyle>
                        <Switch checkedChildren={tr("Can see images")} unCheckedChildren={tr("Text only")} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving} icon={<Save className="size-4" />}>
                        {tr("Save agent model")}
                    </Button>
                </div>
            </Form>
        </SettingsSectionCard>
    );
}
