import { tr } from "@/i18n";
import type { ModelCapabilityChoice } from "@/components/model-protocol-picker";
import type { FormInstance } from "antd";
import { defaultModelCapabilityConfig, normalizeLegacyImageResolutionConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import { imagePresetForRatio, imageSizePresets } from "@/lib/image-size-presets";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ChannelModel } from "@/services/api/channel-models";
import type { ModelTag } from "@/lib/model-tags";
import { initializeImageRatioDefaults, resolveImageParameters } from "@/lib/image-parameters";
import { findProtocolWorkflow, resolveWorkflowVideoScreenSpec } from "@/lib/video-screen-specs";
import { defaultPriceTier, legacyPriceTierToForm, normalizeUpstreamModelKey, priceTierToForm, type PriceTierFormValues } from "./channel-model-price-tier-form";

export type ChannelModelFormValues = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    channelLabel?: string;
    tags: ModelTag[];
    description?: string;
    icon?: string;
    capability: ModelCapabilityChoice;
    protocol?: string;
    priceTiers: PriceTierFormValues[];
    enabled: boolean;
    capabilityConfig?: ModelCapabilityConfig;
};

export type EditorSection = "identity" | "capabilities" | "pricing";

export function replaceChannelModelFormValues(form: Pick<FormInstance<ChannelModelFormValues>, "setFieldsValue" | "setFieldValue">, values: ChannelModelFormValues) {
    const { capabilityConfig, ...fields } = values;
    form.setFieldsValue(fields);
    // 整体替换协议配置，避免 setFieldsValue 深合并后残留旧协议字段。
    form.setFieldValue("capabilityConfig", capabilityConfig);
}

export function editorSectionForField(name: (string | number)[]): EditorSection {
    return name[0] === "priceTiers" ? "pricing" : name[0] === "capabilityConfig" ? "capabilities" : "identity";
}

export function initialChannelModelValues(item: ChannelModel | null, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = item?.capability || "text";
    const protocol = item ? item.protocol : protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const upstreamModel = item?.providerModelKey || item?.modelKey || "";
    const rawCapabilityConfig = item?.capabilityConfig || defaultModelCapabilityConfig(protocol, upstreamModel);
    let capabilityConfig =
        capability === "audio"
            ? undefined
            : (() => {
                  const normalized = normalizeModelCapabilityConfig(rawCapabilityConfig);
                  return normalized.image ? { ...normalized, image: normalizeLegacyImageResolutionConfig(protocol, normalized.image) } : normalized;
              })();
    const definitions = protocols.find((p) => p.value === protocol)?.imageParameters;
    if (capabilityConfig?.image && capability === "image" && definitions) capabilityConfig = { ...capabilityConfig, image: resolveImageParameters(capabilityConfig.image, definitions, upstreamModel) };
    return {
        modelKey: item?.modelKey || "",
        providerModelKey: upstreamModel,
        displayName: item?.displayName || tr("未分类"),
        channelLabel: item?.channelLabel || upstreamModel,
        tags: item?.tags?.map((tag) => ({ ...tag })) || [],
        description: item?.description || "",
        icon: item?.icon || "",
        capability,
        protocol,
        priceTiers: item ? (item.priceTiers?.length ? item.priceTiers.map((tier) => priceTierToForm(tier, capabilityConfig?.image, protocol)) : [legacyPriceTierToForm(item)]) : [defaultPriceTier()],
        enabled: item?.enabled ?? true,
        capabilityConfig,
    };
}

export function duplicateChannelModelValues(item: ChannelModel, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const values = initialChannelModelValues(item, protocols);
    const sourceUpstream = normalizeUpstreamModelKey(item.providerModelKey || item.modelKey);
    return {
        ...values,
        modelKey: "",
        providerModelKey: "",
        priceTiers: values.priceTiers.map((tier) => (normalizeUpstreamModelKey(tier.providerModelKey) === sourceUpstream ? { ...tier, providerModelKey: "" } : tier)),
    };
}

// Clear incompatible selectors, but keep each tier's upstream routing.
export function changeChannelModelCapability(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[]): ChannelModelFormValues {
    const capability = values.capability;
    const protocol = protocols.find((p) => p.value === values.protocol && p.capability === capability && p.enabled !== false)?.value || protocols.find((p) => p.capability === capability && p.enabled !== false)?.value;
    const capabilityConfig = capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    if (capabilityConfig?.image && protocols.find((p) => p.value === protocol)?.imageParameters) {
        capabilityConfig.image.parameters = [];
        if (!capabilityConfig.image.resolution.supported || !protocols.find((p) => p.value === protocol)?.imageParameters?.some((p) => p.name === "size" && p.encoding === "pixels" && !p.values?.length)) capabilityConfig.image.size.presets = undefined;
    }
    return updateChannelModelUpstreamCapabilities(
        {
            ...values,
            protocol,
            capabilityConfig,
            priceTiers: values.priceTiers.map((tier) => ({
                ...tier,
                operation: "*",
                imageSelector: {},
                imageResolution: "*",
                quality: "*",
                size: "*",
                resolution: "*",
                videoSeconds: 0,
                videoGenerateAudio: "*",
                imageCount: 0,
            })),
        },
        protocols,
    );
}

export function changeChannelModelProtocol(values: ChannelModelFormValues, protocol: string, protocols: ModelProtocolDefinition[] = []): ChannelModelFormValues {
    const capabilityConfig = values.capability === "audio" ? undefined : defaultModelCapabilityConfig(protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    if (capabilityConfig?.image && protocols.find((p) => p.value === protocol)?.imageParameters) {
        capabilityConfig.image.parameters = [];
        if (!capabilityConfig.image.resolution.supported || !protocols.find((p) => p.value === protocol)?.imageParameters?.some((p) => p.name === "size" && p.encoding === "pixels" && !p.values?.length)) capabilityConfig.image.size.presets = undefined;
    }
    const next: ChannelModelFormValues = {
        ...values,
        protocol,
        capabilityConfig,
        priceTiers: values.capability === "image" ? values.priceTiers.map((tier) => ({ ...tier, imageResolution: "*", quality: "*", imageSelector: {} })) : values.priceTiers,
    };
    return updateChannelModelUpstreamCapabilities(next, protocols);
}

export function updateChannelModelUpstreamCapabilities(values: ChannelModelFormValues, protocols: ModelProtocolDefinition[] = []): ChannelModelFormValues {
    const workflows = protocols.find((p) => p.value === values.protocol)?.workflows;
    if (values.capability === "video" && workflows?.length) {
        // 工作流协议的画面规格必须写回表单；只在界面上投影会让保存提交旧协议的分辨率。
        const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
        const workflow = findProtocolWorkflow(workflows, values.protocol, values.providerModelKey?.trim() || values.modelKey.trim());
        if (!profile.video || !workflow) return values;
        const video = resolveWorkflowVideoScreenSpec(profile.video, workflow);
        if (JSON.stringify(video) === JSON.stringify(profile.video)) return values;
        return { ...values, capabilityConfig: { ...profile, video } };
    }
    const definitions = protocols.find((p) => p.value === values.protocol)?.imageParameters;
    if (values.capability === "image" && definitions) {
        const profile = values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, values.providerModelKey || values.modelKey);
        if (profile.image) {
            const fresh = profile.image.parameters?.length === 0;
            const resolved = resolveImageParameters(profile.image, definitions, values.providerModelKey?.trim() || values.modelKey.trim());
            return { ...values, capabilityConfig: { ...profile, image: fresh ? initializeImageRatioDefaults(resolved, resolved.parameters!) : resolved } };
        }
    }
    if (values.capability !== "image" || values.protocol !== "cangyuan-midjourney-v82") return values;
    const defaults = defaultModelCapabilityConfig(values.protocol, values.providerModelKey?.trim() || values.modelKey.trim());
    const image = values.capabilityConfig?.image;
    if (!image) return { ...values, capabilityConfig: defaults };
    if (image.size.parameter !== "aspect_ratio") return values;
    const tier = defaults.image!.size.presets![0].tier;
    const presets = imageSizePresets(image);
    if (presets.length && presets.every((preset) => preset.tier === tier)) return values;
    const ratios = Array.from(new Set(presets.map((preset) => preset.ratio)));
    return {
        ...values,
        capabilityConfig: {
            ...values.capabilityConfig!,
            image: { ...image, size: { ...image.size, presets: ratios.length ? ratios.map((ratio) => imagePresetForRatio(tier, ratio)) : defaults.image!.size.presets } },
        },
    };
}

export function validateChannelModelProtocol(capability: string, protocol: string | undefined, protocols: ModelProtocolDefinition[]) {
    if (!protocols.some((p) => p.value === protocol && p.capability === capability && p.enabled !== false)) {
        throw new Error(tr("请选择当前能力下已启用的请求协议"));
    }
}

export function validateChannelModelSpecTiers(values: Pick<ChannelModelFormValues, "capability" | "priceTiers" | "capabilityConfig">) {
    const { capability, priceTiers } = values;
    if (!priceTiers?.length) throw new Error(tr("请至少配置一个规格档"));
    if (priceTiers.filter((tier) => tier.matchMode === "default").length > 1) throw new Error(tr("只能配置一个统一规格档"));
    const operations: Record<string, string[]> = {
        text: ["text_generation"],
        image: ["text_to_image", "image_to_image"],
        video: ["text_to_video", "image_to_video", "video_to_video"],
        audio: [],
    };
    priceTiers.forEach((tier, index) => {
        const fail = (text: string) => {
            throw new Error(tr("规格档 {0}：{1}", index + 1, text));
        };
        if (tier.matchMode === "advanced") {
            if (tier.operation && tier.operation !== "*" && !operations[capability]?.includes(tier.operation)) fail(tr("生成方式与模型能力不匹配"));
            const specific = (value: string | undefined) => Boolean(value && value !== "*");
            const image = values.capabilityConfig?.image;
            const imageCondition =
                Object.values(tier.imageSelector || {}).some(specific) ||
                (image?.resolution.supported !== false && specific(tier.imageResolution)) ||
                (image?.quality.supported !== false && specific(tier.quality)) ||
                specific(tier.resolution) ||
                specific(tier.size);
            if (!(specific(tier.operation) || (capability === "image" && imageCondition) || (capability === "video" && specific(tier.resolution)))) fail(tr("规格档至少需要一个匹配条件；统一规格请选择默认规格"));
        }
    });
}
