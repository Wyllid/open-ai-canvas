import { tr } from "@/i18n";
import { App, Button, InputNumber } from "antd";
import { SettingsRow } from "@/components/ui/product/settings-row";
import { ArrowLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { UserOSSSettingsForm } from "@/components/layout/user-oss-settings-form";
import { refreshSystemChannels } from "@/lib/user-session";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { ChannelSettingsPane, channelValidationError, focusInvalidChannelField, isChannelReady } from "./channel-settings-pane";
import { ModelDefaultGrid } from "./model-default-grid";
import { PromptPreferencesPane } from "./prompt-preferences-pane";
import DiagnosticsPanel from "./diagnostics-panel";
import AgentMemoryPane from "./agent-memory-pane";
import { RunningHubSettingsPane } from "./runninghub-settings-pane";
import { RUNNINGHUB_PLUGIN_ID } from "@/lib/plugins/builtin/workflows";
import { usePluginStore } from "@/stores/use-plugin-store";
import { ProfilePane } from "./profile-pane";

export type PersonalSettingsSection = "profile" | "channels" | "models" | "runninghub" | "preferences" | "prompts" | "agent-memory" | "storage" | "diagnostics";

/**
 * Account and creation preferences shown inside the settings modal. `section` is chosen by the modal;
 * `onSelect` switches to another personal section and `onClose` leaves the modal.
 */
export default function PersonalSettingsContent({ section, onSelect, onClose }: { section: PersonalSettingsSection; onSelect: (section: PersonalSettingsSection) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const [searchParams] = useSearchParams();
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const runningHubPluginEnabled = runtimeStatuses[RUNNINGHUB_PLUGIN_ID] === "enabled";
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const shouldPromptContinue = searchParams.get("continue") === "1";
    const userId = useUserStore((state) => state.user?.id);
    const userChannels = config.channels.filter((channel) => channel.scope !== "system");

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void refreshSystemChannels().catch((error) => {
            if (!cancelled) message.warning(error instanceof Error ? tr("系统模型刷新失败：{0}", error.message) : tr("系统模型刷新失败，继续使用本地缓存"));
        });
        return () => {
            cancelled = true;
        };
    }, [message, userId]);

    const selectSection = (next: PersonalSettingsSection) => {
        if (next === "runninghub" && !runningHubPluginEnabled) return;
        onSelect(next);
    };

    const finishConfig = () => {
        const invalidChannel = customChannelsEnabled ? userChannels.find((channel) => channelValidationError(channel)) : undefined;
        if (invalidChannel) {
            selectSection("channels");
            message.warning(`${invalidChannel.name || tr("未命名渠道")}：${channelValidationError(invalidChannel)}`);
            focusInvalidChannelField(invalidChannel);
            return;
        }
        const workflowReady = Boolean(runningHubPluginEnabled && config.runningHub.enabled && config.runningHub.workflowId.trim() && config.runningHub.baseUrl.trim() && config.runningHub.apiKey.trim());
        if (!effectiveConfig.channels.some(isChannelReady) && !workflowReady) {
            selectSection(customChannelsEnabled ? "channels" : "models");
            message.error(customChannelsEnabled ? (shouldPromptContinue ? tr("请先完成至少一个渠道的 Base URL、API Key 和模型配置") : tr("当前没有可用渠道，请先完成连接信息和模型配置")) : tr("当前没有可用的系统模型，请联系管理员配置系统渠道"));
            return;
        }
        message.success(tr("配置已保存，正在返回创作页面"));
        onClose();
    };

    const panes: Record<PersonalSettingsSection, ReactNode> = {
        profile: (
            <SettingsPane>
                <ProfilePane key={userId} />
            </SettingsPane>
        ),
        channels: (
            <SettingsPane>
                <ChannelSettingsPane onOpenModels={() => selectSection("models")} onOpenRunningHub={runningHubPluginEnabled ? () => selectSection("runninghub") : undefined} />
            </SettingsPane>
        ),
        models: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{tr("模型选择")}</h2>
                        <p>{tr("按领域选择默认模型；模型能力与请求协议在渠道“模型与能力”中配置。")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <ModelDefaultGrid config={effectiveConfig} onChange={(key, model) => updateConfig(key, model)} />
                </div>
            </SettingsPane>
        ),
        runninghub: (
            <SettingsPane>
                <RunningHubSettingsPane />
            </SettingsPane>
        ),
        preferences: (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{tr("生成偏好")}</h2>
                        <p>{tr("设置新建生成任务时使用的初始值，节点内仍可单独覆盖。")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <section className="settings-preference-block">
                        <div className="settings-preference-heading">
                            <h3>{tr("画布生成")}</h3>
                            <p>{tr("用于新建图片生成任务，节点内仍可单独覆盖。")}</p>
                        </div>
                        <SettingsRow
                            label={tr("默认生图张数")}
                            control={
                                <InputNumber
                                    min={1}
                                    max={15}
                                    precision={0}
                                    className="w-full"
                                    value={Number(config.canvasImageCount)}
                                    onChange={(value) => updateConfig("canvasImageCount", normalizeImageCount(String(value ?? defaultConfig.canvasImageCount)))}
                                />
                            }
                            controlClassName="w-[200px]"
                        />
                    </section>
                </div>
            </SettingsPane>
        ),
        prompts: (
            <SettingsPane fill>
                <PromptPreferencesPane />
            </SettingsPane>
        ),
        "agent-memory": (
            <SettingsPane>
                <div className="settings-pane-header">
                    <div className="min-w-0">
                        <h2>{tr("Agent 记忆")}</h2>
                        <p>{tr("只属于你。Agent 记下的先待批准；手动添加立刻生效。可导入导出，也可用文本模型压缩相近条目。")}</p>
                    </div>
                </div>
                <div className="settings-section">
                    <AgentMemoryPane />
                </div>
            </SettingsPane>
        ),
        diagnostics: (
            <SettingsPane>
                <DiagnosticsPanel taskId={searchParams.get("taskId") || undefined} projectId={searchParams.get("projectId") || undefined} />
            </SettingsPane>
        ),
        storage: (
            <SettingsPane>
                <div className="settings-section">
                    <UserOSSSettingsForm />
                </div>
            </SettingsPane>
        ),
    };

    return (
        <div className={`app-user-workspace settings-page settings-pane-root ${section === "prompts" ? "h-full w-full" : "w-full"}`}>
            {panes[section]}
            {shouldPromptContinue ? (
                <div className="settings-continue-bar">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={onClose}>
                        {tr("返回创作")}
                    </Button>
                    <Button type="primary" onClick={finishConfig}>
                        {tr("保存并返回")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

function SettingsPane({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
    return <div className={fill ? "settings-pane h-full" : "settings-pane"}>{children}</div>;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || Number(defaultConfig.canvasImageCount)))));
}
