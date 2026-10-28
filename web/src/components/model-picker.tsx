import { tr } from "@/i18n";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover } from "antd";
import { usePopoverAnchorAlign } from "@/hooks/use-popover-anchor-align";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { compatibleModelInGroup, configuredModelDisplayName, modelCompatibilityError, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { groupModelsForPicker, isDirectSystemModel, modelChannelLabel, type ModelPickerGroup } from "@/lib/model-picker-groups";
import { cn } from "@/lib/utils";
import { modelDisplayName, modelIcon, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { ModelLogo } from "@/components/model-logo";
import { ModelTags } from "@/components/model-tags";
import { videoReferenceCapabilityTag } from "@/lib/model-tags";
import type { PublicChannelModelAvailability } from "@/services/api/logical-models";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    popoverClassName?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    variant?: "default" | "creation";
    requirements?: ModelRequirements;
    showConfiguredModelName?: boolean;
    modelFilter?: (model: string) => boolean;
    /** 调用方额外的不可选原因（例如短剧只能用平台模型）；返回非空串时选项置灰并显示原因。 */
    modelDisabledReason?: (model: string) => string;
};

export function ModelPicker({
    config,
    value,
    onChange,
    capability,
    className,
    popoverClassName,
    fullWidth = false,
    placeholder = tr("选择模型"),
    onMissingConfig,
    variant = "creation",
    requirements,
    showConfiguredModelName = false,
    modelFilter,
    modelDisabledReason,
}: ModelPickerProps) {
    const pickerId = useId();
    // 双保险：即使 store merge 写出非法 theme，这里也兜底到 dark，避免 "reading 'node'" 崩溃
    const rawTheme = useActiveTheme();
    const theme = (canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark) as CanvasTheme;
    const [open, setOpen] = useState(false);
    const popoverRef = usePopoverAnchorAlign(open);
    const [availableHeight, setAvailableHeight] = useState(0);
    const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, capability).filter((model) => Boolean(model) && (!modelFilter || modelFilter(model))))), [capability, config, modelFilter]);
    const optionGroups = useMemo(() => groupModelsForPicker(config, options), [config, options]);
    const storedCurrent = value?.trim() || "";
    // 参数档位会在选中模型后由调用方归一到其能力配置，不能因为旧模型留下的参数而禁止切换。
    const selectionRequirements = requirements ? { ...requirements, videoSeconds: undefined, imageSize: undefined, options: undefined } : undefined;
    const resolvedCurrent = isDirectSystemModel(config, storedCurrent) ? storedCurrent : resolveCompatibleModel(config, storedCurrent, selectionRequirements) || storedCurrent;
    // 旧画布可能保存过已下架或前端历史内置模型；它们不能重新进入当前可选目录。
    const current = options.includes(resolvedCurrent) ? resolvedCurrent : "";
    const creationVariant = variant === "creation";
    const currentChannel = current ? resolveModelChannel(config, current) : undefined;
    const isCurrentCustomChannel = Boolean(current && currentChannel && currentChannel.scope !== "system");

    useLayoutEffect(() => {
        if (!open) return;
        const updateAvailableHeight = () => {
            const { top, bottom } = triggerRef.current!.getBoundingClientRect();
            setAvailableHeight(Math.max(top, window.innerHeight - bottom));
        };
        updateAvailableHeight();
        window.addEventListener("resize", updateAvailableHeight);
        window.addEventListener("scroll", updateAvailableHeight, true);
        return () => {
            window.removeEventListener("resize", updateAvailableHeight);
            window.removeEventListener("scroll", updateAvailableHeight, true);
        };
    }, [open]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useEffect(() => {
        if (!open) return;
        // 画布拖拽从 pointerdown 开始，须在捕获阶段关闭 Portal 菜单，避免菜单与触发器分离。
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    }, [open]);

    const setPickerOpen = (nextOpen: boolean) => {
        if (nextOpen && !options.length) onMissingConfig?.();
        if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        if (nextOpen) {
            setActiveGroupKey(optionGroups.find((group) => group.models.some((item) => item.models.includes(current)))?.key ?? null);
        }
        setOpen(nextOpen);
    };
    const focusMenuOption = (last = false) => {
        window.requestAnimationFrame(() => {
            const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-model-picker-item]:not(:disabled)');
            const target = last ? buttons?.item((buttons?.length || 1) - 1) : buttons?.item(0);
            focusPickerOption(target);
        });
    };
    const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        setPickerOpen(true);
        focusMenuOption(event.key === "ArrowUp");
    };
    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
            return;
        }
        if (event.key === "ArrowLeft" && activeGroupKey !== null) {
            event.preventDefault();
            setActiveGroupKey(null);
            focusMenuOption();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-picker-item]:not(:disabled)'));
        if (!buttons.length) return;
        event.preventDefault();
        const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowUp" ? Math.max(0, activeIndex - 1) : Math.min(buttons.length - 1, activeIndex + 1);
        focusPickerOption(buttons[nextIndex]);
    };
    const content = (
        <div
            ref={menuRef}
            data-canvas-no-zoom
            className={cn(
                "canvas-model-picker-menu creation-model-picker-menu max-w-[calc(100vw-24px)]",
                activeGroupKey === null ? "is-brand-list" : "is-model-list",
            )}
            style={{ background: theme.node.panel, color: theme.node.text, "--canvas-model-picker-available-height": `${availableHeight}px` } as CSSProperties}
            role="listbox"
            aria-label={placeholder}
            onKeyDown={handleMenuKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {optionGroups.length ? (
                activeGroupKey === null ? (
                    <div className="canvas-model-picker-brands" aria-label={tr("选择产品模型")}>
                        {optionGroups.map((group) => {
                            const groupCurrent = group.models.find((item) => item.models.includes(current));
                            return <button key={group.key} type="button" data-model-picker-item className={cn("canvas-model-picker-brand", groupCurrent && "is-active")} aria-pressed={Boolean(groupCurrent)} onClick={() => { setActiveGroupKey(group.key); focusMenuOption(); }}>
                                <span className="canvas-model-picker-brand-icon"><ModelLogo icon={group.icon} size={22} /></span>
                                <span className="canvas-model-picker-brand-copy">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <strong className="truncate">{group.label}</strong>
                                        {group.scope === "我的模型" ? (
                                            <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">
                                                {tr("个人渠道")}
                                            </span>
                                        ) : null}
                                    </span>
                                    <small className="canvas-model-picker-brand-meta">
                                        <span className="canvas-model-picker-brand-subtext">{group.models.length} {tr("个")}{group.kind === "product" ? tr("渠道") : tr("模型")}{group.scope ? ` · ${group.scope}` : ""}</span>
                                        <ModelRecentHealthTrack availability={groupAvailability(config, group)} />
                                    </small>
                                </span>
                                <ChevronDown className="canvas-model-picker-brand-arrow" aria-hidden="true" />
                            </button>;
                        })}
                    </div>
                ) : <div className="canvas-model-picker-two-pane">
                    <div className="canvas-model-picker-brand-rail" aria-label={tr("产品模型")}>
                        {optionGroups.map((group) => {
                            return <button key={group.key} type="button" className={cn("canvas-model-picker-brand", activeGroupKey === group.key && "is-active")} aria-pressed={activeGroupKey === group.key} onClick={() => setActiveGroupKey(group.key)}>
                                <span className="canvas-model-picker-brand-icon"><ModelLogo icon={group.icon} size={22} /></span>
                                <span className="canvas-model-picker-brand-copy">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <strong className="truncate">{group.label}</strong>
                                        {group.scope === "我的模型" ? (
                                            <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">
                                                {tr("个人渠道")}
                                            </span>
                                        ) : null}
                                    </span>
                                    <small className="canvas-model-picker-brand-meta">
                                        <span className="canvas-model-picker-brand-subtext">{group.models.length} {tr("个")}{group.kind === "product" ? tr("渠道") : tr("模型")}{group.scope ? ` · ${group.scope}` : ""}</span>
                                        <ModelRecentHealthTrack availability={groupAvailability(config, group)} />
                                    </small>
                                </span>
                                <ChevronDown className="canvas-model-picker-brand-arrow" aria-hidden="true" />
                            </button>;
                        })}
                    </div>
                    {optionGroups.filter((group) => group.key === activeGroupKey).map((group) => <section key={group.key} className="canvas-model-picker-group canvas-model-picker-model-pane min-w-0">
                        <div className="grid min-w-0 gap-1">
                            {group.models.map((modelGroup) => {
                                const selected = modelGroup.models.includes(current);
                                const usable = modelDisabledReason ? modelGroup.models.filter((item) => !modelDisabledReason(item)) : modelGroup.models;
                                const model = usable.length ? compatibleModelInGroup(config, usable, selectionRequirements, selected ? current : undefined) : undefined;
                                const displayModel = model || (selected ? current : modelGroup.models[0]);
                                const disabledReason = model ? "" : usable.length ? modelCompatibilityError(config, usable[0], selectionRequirements) || tr("当前输入不符合该模型能力") : modelDisabledReason?.(modelGroup.models[0]) || tr("该模型不可用");
                                return (
                                    <button
                                        key={modelGroup.key}
                                        type="button"
                                        data-model-picker-item
                                        role="option"
                                        aria-selected={selected}
                                        aria-disabled={Boolean(disabledReason)}
                                        disabled={Boolean(disabledReason)}
                                        className="canvas-model-picker-option disabled:cursor-not-allowed disabled:opacity-45"
                                        style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                                        onClick={() => {
                                            if (!model) return;
                                            onChange(model);
                                        }}
                                    >
                                        <ModelLabel
                                            config={config}
                                            model={displayModel}
                                            capability={capability}
                                            theme={theme}
                                            creationVariant
                                            showConfiguredModelName={showConfiguredModelName}
                                            label={group.kind === "product" ? modelGroup.label : undefined}
                                            disabledReason={disabledReason}
                                            showDescription
                                        />
                                        <span className="canvas-model-picker-option-check ml-1 shrink-0" aria-hidden="true">{selected ? <Check className="size-full" style={{ color: theme.node.activeStroke }} /> : null}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>)}
                </div>
            ) : (
                <div className="canvas-model-picker-empty" style={{ color: theme.node.muted }}>
                    {emptyModelLabel(config, capability)}
                </div>
            )}
        </div>
    );

    return (
        <div className={cn(fullWidth ? "w-full min-w-0" : "w-fit max-w-full")} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Popover
                ref={popoverRef}
                open={open}
                onOpenChange={setPickerOpen}
                trigger="click"
                placement="bottomLeft"
                align={{ overflow: { adjustY: true, shiftX: true } }}
                arrow={false}
                motion={{ motionName: "" }}
                content={content}
                classNames={{
                    root: cn("canvas-model-picker-popover", "creation-model-picker-popover", popoverClassName),
                    container: cn("canvas-composer-popover-surface", "creation-model-picker-surface"),
                    content: "canvas-composer-popover-content",
                }}
            >
                <button
                    ref={triggerRef}
                    type="button"
                    className={cn("canvas-composer-model-picker", fullWidth ? "w-full" : "min-w-36 max-w-full", className)}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-label={placeholder}
                    title={current ? pickerModelOptionLabel(config, current, showConfiguredModelName) : placeholder}
                    onKeyDown={handleTriggerKeyDown}
                >
                    <span className="canvas-model-picker-label flex min-w-0 items-center gap-2">
                        <span className="canvas-model-picker-trigger-icon" style={{ background: theme.toolbar.itemHover }}>
                            <ModelIcon config={config} model={current} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{current ? (creationVariant ? pickerModelDisplayName(config, current, showConfiguredModelName) : pickerModelOptionLabel(config, current, showConfiguredModelName)) : placeholder}</span>
                        {isCurrentCustomChannel ? (
                            <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">
                                {tr("个人")}
                            </span>
                        ) : null}
                    </span>
                    <ChevronDown className={cn("canvas-model-picker-chevron", open && "is-open")} aria-hidden="true" />
                </button>
            </Popover>
        </div>
    );
}

function focusPickerOption(target: HTMLButtonElement | null | undefined) {
    if (!target) return;
    target.focus({ preventScroll: true });
    // Only reveal the focused row inside its pane; scrolling portal ancestors moves the page.
    const pane = target.closest<HTMLElement>(".canvas-model-picker-model-pane, .canvas-model-picker-menu");
    if (!pane) return;
    const row = target.getBoundingClientRect();
    const top = pane.getBoundingClientRect().top + pane.clientTop;
    const bottom = top + pane.clientHeight;
    const delta = row.top < top ? row.top - top : row.bottom > bottom ? row.bottom - bottom : 0;
    if (delta) pane.scrollTop += delta;
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? tr("生图") : capability === "video" ? tr("视频") : capability === "text" ? tr("文本") : capability === "audio" ? tr("音频") : "";
    if (capability && config.models.length) return tr("暂无支持当前输入的{0}模型", label);
    return config.models.length ? tr("暂无匹配的{0}模型", label) : tr("当前没有可用模型，请联系管理员或检查模型配置");
}

export function ModelLabel({
    config,
    model,
    capability,
    theme,
    creationVariant,
    showConfiguredModelName,
    label,
    disabledReason,
    showDescription,
}: {
    config: AiConfig;
    model: string;
    capability?: ModelCapability;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    creationVariant: boolean;
    showConfiguredModelName: boolean;
    label?: string;
    disabledReason?: string;
    showDescription: boolean;
}) {
    const meta = modelMenuMeta(model, capability);
    const channel = resolveModelChannel(config, model);
    const logicalCost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const logicalSpec = logicalCost?.logicalCapabilitySpec;
    const videoProfile = capability === "video" ? modelCapabilityConfigFor(config, model).video : undefined;
    const videoSummary = videoProfile ? [videoProfile.durationSupported === false ? "" : formatDurationSummary(videoProfile), videoProfile.resolutions.map((item) => item.toUpperCase()).join("/")].filter(Boolean).join(" · ") : "";
    const capabilityTag = videoReferenceCapabilityTag(videoProfile?.references);
    const modelTags = capabilityTag ? [capabilityTag, ...(logicalCost?.tags || [])] : logicalCost?.tags;
    const capabilitySummary =
        disabledReason ||
        logicalCost?.description?.trim() ||
        (isDirectSystemModel(config, model) ? "" : logicalSpec ? logicalCapabilitySummary(logicalSpec) : videoProfile ? videoSummary : meta.description);
    return (
        <span className="flex w-full min-w-0 items-center gap-2 overflow-hidden py-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                <ModelIcon config={config} model={model} />
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="canvas-model-picker-option-heading">
                    <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        <span className="canvas-model-picker-option-name text-[var(--fs-label)] font-medium leading-none truncate !flex-initial max-w-full" title={label || pickerModelDisplayName(config, model, showConfiguredModelName)}>{label || pickerModelDisplayName(config, model, showConfiguredModelName)}</span>
                        {channel.scope !== "system" ? (
                            <span className="shrink-0 rounded px-2 py-0.5 text-[var(--fs-label)] font-medium leading-none bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/25">
                                {tr("个人")}
                            </span>
                        ) : null}
                    </span>
                    <ModelAvailabilityBadge availability={modelAvailability(config, model)} available={logicalCost?.available ?? true} showAvailability={channel.scope === "system"} />
                </span>
                <span className={cn("canvas-model-picker-description mt-1 block", showDescription && "is-visible")} style={{ color: theme.node.muted }}>
                    {capabilitySummary}
                </span>
                <ModelTags tags={modelTags} />
            </span>
            {!creationVariant && meta.time ? (
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[var(--fs-tiny)] tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {meta.time}
                </span>
            ) : null}
        </span>
    );
}

function logicalCapabilitySummary(spec: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalCapabilitySpec"]>) {
    const operationLabels: Record<string, string> = {
        text_to_video: tr("文生视频"),
        image_to_video: tr("图生视频"),
        reference_to_video: tr("全模态参考"),
        audio_to_video: tr("音频生视频"),
        extend: tr("视频续写"),
        inpaint: tr("局部修改"),
        replace_element: tr("元素替换"),
        camera_motion: tr("运镜调整"),
        style_transfer: tr("风格迁移"),
    };
    const inputLabels: Record<string, { label: string; unit: string }> = {
        image: { label: spec.capability === "text" ? tr("图片理解") : tr("参考图片"), unit: tr("张") },
        video: { label: spec.capability === "text" ? tr("视频理解") : tr("参考视频"), unit: tr("个") },
        audio: { label: tr("参考音频"), unit: tr("个") },
        mask: { label: tr("蒙版"), unit: tr("张") },
    };
    const optionLabels: Record<string, string> = {
        size: tr("画面比例"),
        aspectRatio: tr("画面比例"),
        quality: tr("生成质量"),
        count: tr("输出数量"),
        videoSeconds: tr("视频时长"),
        duration: tr("视频时长"),
        vquality: tr("输出分辨率"),
        resolution: tr("输出分辨率"),
        audioVoice: tr("音色"),
        audioFormat: tr("音频格式"),
        audioSpeed: tr("语速"),
    };
    const values: string[] = [];
    values.push(...(spec.operations || []).map((operation) => operationLabels[operation] || operation));
    for (const [name, constraint] of Object.entries(spec.inputs || {})) {
        if (constraint.max <= 0) continue;
        const definition = inputLabels[name];
        if (!definition) continue;
        values.push(spec.capability === "text" ? tr("支持{0}", definition.label) : tr("{0}最多 {1}{2}", definition.label, constraint.max, definition.unit));
    }
    for (const [name, constraint] of Object.entries(spec.options || {})) {
        const label = optionLabels[name];
        if (!label) continue;
        if (constraint.values?.length) values.push(`${label} ${constraint.values.map(publicScalarLabel).join("/")}`);
        else if (constraint.min !== undefined && constraint.max !== undefined) values.push(`${label} ${constraint.min}-${constraint.max}`);
    }
    return values.slice(0, 2).join(" · ") || tr("智能匹配当前输入");
}

function publicScalarLabel(value: unknown) {
    if (value === true) return tr("支持");
    if (value === false) return tr("关闭");
    return String(value);
}

function formatDurationSummary(profile: NonNullable<ReturnType<typeof modelCapabilityConfigFor>["video"]>) {
    const values = videoDurationOptions(profile);
    if (profile.duration.selection === "enum") return values.map((item) => `${item}s`).join("/");
    return `${profile.duration.min || values[0]}-${profile.duration.max || values[values.length - 1]}s`;
}

function pickerModelDisplayName(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const name = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    return isDirectSystemModel(config, model) ? `${name} · ${modelChannelLabel(config, model)}` : name;
}

function pickerModelOptionLabel(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const displayName = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? pickerModelDisplayName(config, model, showConfiguredModelName) : `${displayName}（${channel.name}）`;
}

function modelAvailability(config: AiConfig, model: string): PublicChannelModelAvailability | undefined {
    if (!model) return undefined;
    const channel = resolveModelChannel(config, model);
    return channel.modelCosts?.find((item) => item.model === modelOptionName(model))?.availability;
}

function groupAvailability(config: AiConfig, group: ModelPickerGroup): PublicChannelModelAvailability | undefined {
    for (const mg of group.models) {
        for (const m of mg.models) {
            const avail = modelAvailability(config, m);
            if (avail) return avail;
        }
    }
    return undefined;
}

export function ModelRecentHealthTrack({ availability, inPopover = false }: { availability?: PublicChannelModelAvailability; inPopover?: boolean }) {
    const recentResults = availability?.recentResults ?? [];
    const successCount = recentResults.filter(Boolean).length;
    const failCount = recentResults.filter((item) => item === false).length;
    const hasRuns = recentResults.length > 0;
    const title = hasRuns
        ? tr("最近 {0} 次调用：{1} 成功，{2} 失败", recentResults.length, successCount, failCount)
        : tr("近期暂无调用记录");

    return (
        <span className={cn("model-picker-availability-track", inPopover && "in-popover")} title={title} aria-label={title}>
            {Array.from({ length: 10 }).map((_, idx) => {
                const hasRun = idx < recentResults.length;
                const isSuccess = hasRun ? recentResults[idx] : null;
                const stateClass = isSuccess === true ? "is-success" : isSuccess === false ? "is-failed" : "is-empty";
                return (
                    <span
                        key={idx}
                        className={cn("model-picker-availability-pill", inPopover && "in-popover", stateClass)}
                        title={inPopover ? (hasRun ? tr("第 {0} 次：{1}", idx + 1, isSuccess ? tr("成功") : tr("失败")) : tr("槽位 {0}：未发生调用", idx + 1)) : undefined}
                    />
                );
            })}
        </span>
    );
}

function ModelAvailabilityBadge({ availability, available, showAvailability }: { availability?: PublicChannelModelAvailability; available: boolean; showAvailability: boolean }) {
    const [open, setOpen] = useState(false);
    const popoverRef = usePopoverAnchorAlign(open);
    if (!showAvailability) return null;
    const recentResults = availability?.recentResults ?? [];
    const successCount = recentResults.filter(Boolean).length;
    const failCount = recentResults.filter((item) => item === false).length;
    const hasRuns = recentResults.length > 0;

    const label = availability?.dataState === "ready" && availability.rate24h !== null
        ? `${Math.round(availability.rate24h * 100)}%`
        : availability?.dataState === "insufficient"
            ? tr("数据不足")
            : tr("暂无数据");
    const trend = availability?.trend7d || [];
    const trendSamples = trend.reduce((total, item) => total + item.sampleCount, 0);
    const summary = hasRuns
        ? tr("最近{0}次调用：{1}成功、{2}失败；当前{3}", recentResults.length, successCount, failCount, available ? tr("可用") : tr("不可用"))
        : availability
            ? tr("当前{0}；近24小时{1}，暂无近期调用记录", available ? tr("可用") : tr("不可用"), label)
            : tr("当前{0}；历史成功率暂不可用", available ? tr("可用") : tr("不可用"));

    const content = availability ? (
        <div className="model-picker-availability-popover">
            <div className="model-picker-availability-popover-head">
                <strong>{tr("最近 10 次调用")}</strong>
                <span className={failCount > 0 ? "has-failures" : ""}>
                    {hasRuns ? tr("{0} 成功 / {1} 失败", successCount, failCount) : tr("暂无调用记录")}
                </span>
            </div>
            <div className="model-picker-availability-popover-meta">
                {hasRuns ? tr("共记录最近 {0} 次执行（绿=成功 红=失败 灰=无记录）", recentResults.length) : tr("该模型近期尚无调用记录，默认展示10个空槽")}
            </div>
            <div style={{ margin: "6px 0 8px" }}>
                <ModelRecentHealthTrack availability={availability} inPopover />
            </div>
            <div className="model-picker-availability-popover-head" style={{ marginTop: 8 }}>
                <strong>{tr("近24小时成功率")}</strong>
                <span>{label}</span>
            </div>
            <div className="model-picker-availability-popover-meta">{availability.sampleCount24h} {tr("次 create 尝试 · 7天样本")} {trendSamples} {tr("条")}</div>
            <div className="model-picker-availability-trend" aria-label={tr("近7天成功率趋势")}>
                {trend.map((item) => {
                    const dayLabel = item.rate === null ? tr("暂无数据") : `${Math.round(item.rate * 100)}%`;
                    return <span key={item.day} className={`model-picker-availability-segment is-${item.dataState}`} title={tr("{0}：{1}，{2} 条", item.day, dayLabel, item.sampleCount)} style={item.rate === null ? undefined : { opacity: 0.35 + item.rate * 0.65 }} />;
                })}
            </div>
            <div className="model-picker-availability-popover-foot">{tr("绿点=成功 · 红点=失败 · 灰点=空槽")}</div>
        </div>
    ) : null;
    return (
        <Popover ref={popoverRef} open={open} onOpenChange={setOpen} content={content} trigger={["hover", "focus"]} placement="topRight" arrow={false}>
            <span
                className={`model-picker-availability is-${availability?.dataState || "unavailable"}`}
                role="img"
                tabIndex={0}
                aria-label={summary}
                title={summary}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <ModelRecentHealthTrack availability={availability} />
                <span className="model-picker-availability-label">
                    {hasRuns ? `${successCount}/${recentResults.length}` : label}
                </span>
            </span>
        </Popover>
    );
}
function modelMenuMeta(model: string, capability?: ModelCapability): { description: string; time?: string } {
    const name = modelOptionName(model).toLowerCase();
    if (capability === "image") {
        if (name.includes("nano banana") || name.includes("nanobanana") || name.includes("imagen")) return { description: tr("Gemini 高质量图片生成，适合角色和商业成片") };
        if (name.includes("nano") || name.includes("pro")) return { description: tr("高质量图片生成，适合角色和商业成片") };
        if (name.includes("seedream")) return { description: tr("快速出图，适合批量探索风格") };
        if (name.includes("gpt") || name.includes("image")) return { description: tr("通用图片模型，提示词理解稳定") };
        return { description: tr("图片生成模型") };
    }
    if (capability === "video") {
        if (name.includes("veo") || name.includes("omni flash") || name.includes("omni-flash")) return { description: tr("Gemini 镜头生成与图生视频，适合成片流程"), time: "3m" };
        if (name.includes("seedance") || name.includes("sora")) return { description: tr("镜头生成与图生视频，适合成片流程"), time: "3m" };
        return { description: tr("视频生成模型"), time: "3m" };
    }
    if (capability === "audio") return { description: tr("语音、音效或音乐生成"), time: "20s" };
    if (name.includes("claude")) return { description: tr("长文本、推理与创意写作"), time: "10s" };
    if (name.includes("gemini")) return { description: tr("多模态理解与快速文本生成"), time: "10s" };
    if (name.includes("deepseek")) return { description: tr("推理、代码和结构化文本"), time: "10s" };
    return { description: capability === "text" ? tr("文本生成模型") : tr("当前模型"), time: "10s" };
}

export function ModelIcon({ config, model, icon }: { config?: AiConfig; model?: string; icon?: string }) {
    return <ModelLogo icon={icon || (config && model ? modelIcon(config, model) : "")} size={14} />;
}
