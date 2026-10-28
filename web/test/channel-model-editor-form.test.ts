import { describe, expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import {
    changeChannelModelCapability,
    duplicateChannelModelValues,
    editorSectionForField,
    initialChannelModelValues,
    updateChannelModelUpstreamCapabilities,
    validateChannelModelProtocol,
    validateChannelModelSpecTiers,
} from "../src/pages/admin/components/channel-model-editor-form";
import { defaultPriceTier } from "../src/pages/admin/components/channel-model-price-tier-form";
import type { ChannelModel, ChannelModelPriceTier } from "../src/services/api/channel-models";

const definition = (value: string, capability: ModelProtocolDefinition["capability"], enabled = true): ModelProtocolDefinition => ({ value, capability, enabled, label: value, create: "POST /test", contentType: "application/json", media: "url" });
const protocols = [definition("disabled-text", "text", false), definition("text", "text"), definition("image", "image"), definition("video", "video")];
const protocolsWithAudio = [...protocols, definition("audio", "audio")];

describe("channel model editor drafts", () => {
    test("new drafts use 未分类 and imported drafts display the upstream ID without overwriting custom names", () => {
        expect(initialChannelModelValues(null, protocols).displayName).toBe("未分类");
        const imported = { modelKey: "product-id", providerModelKey: "upstream-id", displayName: "未分类", channelLabel: "", priceTiers: [] } as unknown as ChannelModel;
        expect(initialChannelModelValues(imported, protocols)).toMatchObject({ displayName: "未分类", channelLabel: "upstream-id" });
        expect(initialChannelModelValues({ ...imported, displayName: "product-id", channelLabel: "手动命名" }, protocols)).toMatchObject({ displayName: "product-id", channelLabel: "手动命名" });
    });
    test("Kemei Seedream selection initializes the image profile and preserves routing", () => {
        const draft = initialChannelModelValues(null, protocols);
        draft.priceTiers[0].providerModelKey = "seedream-route";
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "km-kemei-seedream", modelKey: "doubao-seedream-5-0-pro-260628" }, [definition("km-kemei-seedream", "image")]);
        expect(next.capabilityConfig?.image).toMatchObject({ references: { maxImages: 10, maskSupported: false }, maxOutputs: 1, size: { default: "2048x2048" } });
        expect(next.priceTiers[0].providerModelKey).toBe("seedream-route");
    });
    test("new drafts select an enabled protocol and never share tier state", () => {
        const first = initialChannelModelValues(null, protocols);
        first.priceTiers[0].providerModelKey = "shared?";
        first.tags.push({ text: "限时特价", color: "purple" });
        const second = initialChannelModelValues(null, protocols);
        expect(second.protocol).toBe("text");
        expect(second.priceTiers[0].providerModelKey).toBe("");
        expect(second.modelKey).toBe("");
        expect(second.tags).toEqual([]);
    });
    test("duplicate drafts clear model IDs and inherited tier IDs while preserving custom routing and configuration", () => {
        const tier = (id: string, providerModelKey: string): ChannelModelPriceTier => ({
            id,
            channelModelId: "source-id",
            selector: {},
            selectorKey: "{}",
            resolution: "*",
            videoSeconds: 0,
            providerModelKey,
            enabled: true,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
        });
        const item: ChannelModel = {
            id: "source-id",
            channelId: "channel-id",
            modelKey: "product-video",
            providerModelKey: "models/vendor-video",
            displayName: "视频模型组",
            channelLabel: "原渠道",
            tags: [{ text: "稳定", color: "green" }],
            description: "视频生成配置",
            icon: "",
            capability: "video",
            protocol: "video",
            enabled: false,
            priceTiers: [tier("default-tier", "vendor-video"), tier("custom-tier", "vendor-video-hq")],
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
        };

        const draft = duplicateChannelModelValues(item, protocols);

        expect(draft).toMatchObject({
            modelKey: "",
            providerModelKey: "",
            displayName: "视频模型组",
            channelLabel: "原渠道",
            tags: [{ text: "稳定", color: "green" }],
            description: "视频生成配置",
            capability: "video",
            protocol: "video",
            enabled: false,
            priceTiers: [{ providerModelKey: "" }, { providerModelKey: "vendor-video-hq" }],
        });
        expect(draft.tags).not.toBe(item.tags);
    });
    test("missing catalogs do not invent a protocol", () => {
        expect(initialChannelModelValues(null, []).protocol).toBeUndefined();
        expect(() => validateChannelModelProtocol("text", "text", [])).toThrow("已启用");
    });
    test("rejects disabled, missing and capability-mismatched protocols", () => {
        for (const protocol of [undefined, "missing", "disabled-text", "image"]) {
            expect(() => validateChannelModelProtocol("text", protocol, protocols)).toThrow();
        }
        expect(() => validateChannelModelProtocol("text", "text", protocols)).not.toThrow();
    });
    test("capability changes clear old selectors but preserve tier routing", () => {
        const draft = initialChannelModelValues(null, protocols);
        const tier = { ...defaultPriceTier("advanced"), providerModelKey: "gpt-image-2-hq", operation: "text_to_video", resolution: "1080p", videoSeconds: 5, videoGenerateAudio: "false", imageCount: 2 };
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "video", providerModelKey: "gpt-image-2", priceTiers: [tier] }, protocols);
        expect(next.protocol).toBe("image");
        expect(next.capabilityConfig).toEqual(defaultModelCapabilityConfig("image", "gpt-image-2"));
        expect(next.priceTiers[0]).toMatchObject({ providerModelKey: "gpt-image-2-hq", operation: "*", resolution: "*", videoSeconds: 0, videoGenerateAudio: "*", imageCount: 0 });
        expect(tier.operation).toBe("text_to_video");
        expect(() => validateChannelModelSpecTiers(next)).toThrow("匹配条件");
    });
    test("audio does not retain image/video configuration", () => {
        const draft = initialChannelModelValues(null, protocols);
        expect(changeChannelModelCapability({ ...draft, capability: "audio" }, protocols).capabilityConfig).toBeUndefined();
    });
    test("switching capability to a Midjourney protocol uses its image defaults", () => {
        const draft = initialChannelModelValues(null, protocols);
        const next = changeChannelModelCapability({ ...draft, capability: "image", protocol: "cangyuan-midjourney-v7", modelKey: "midjourney-v7" }, [...protocols, definition("cangyuan-midjourney-v7", "image")]);
        expect(next.capabilityConfig?.image).toMatchObject({ references: { promptMaxChars: 4000, maxImages: 5, maskSupported: false }, maxOutputs: 1 });
    });
    test("Kacang image protocol selection fills capabilities without changing tier routing", () => {
        for (const protocol of ["kacang-midjourney-special", "kacang-midjourney-v7", "kacang-midjourney"]) {
            const draft = initialChannelModelValues(null, protocols);
            draft.priceTiers[0].providerModelKey = "kacang-route";
            const next = changeChannelModelCapability({ ...draft, capability: "image", protocol }, [definition(protocol, "image")]);
            expect(next.protocol).toBe(protocol);
            expect(next.capabilityConfig?.image?.maxOutputs).toBe(1);
            expect(next.capabilityConfig?.image?.references.maxImages).toBe(protocol === "kacang-midjourney" ? 5 : 1);
            expect(next.priceTiers[0].providerModelKey).toBe("kacang-route");
            expect(updateChannelModelUpstreamCapabilities(next)).toBe(next);
        }
    });
    test("V8.2 upstream changes only retier presets and preserve administrator settings", () => {
        const draft = initialChannelModelValues(null, protocols);
        const capabilityConfig = defaultModelCapabilityConfig("cangyuan-midjourney-v82", "midjourney-1k");
        capabilityConfig.image!.references.promptMaxChars = 12000;
        capabilityConfig.image!.size.default = "6:11";
        const next = updateChannelModelUpstreamCapabilities({ ...draft, capability: "image", protocol: "cangyuan-midjourney-v82", modelKey: "midjourney-1k", providerModelKey: "midjourney-2k", capabilityConfig });
        expect(new Set(next.capabilityConfig!.image!.size.presets!.map((preset) => preset.tier))).toEqual(new Set(["2k"]));
        expect(next.capabilityConfig!.image!.size.values).toEqual(capabilityConfig.image!.size.values);
        expect(next.capabilityConfig!.image!.size.default).toBe("6:11");
        expect(next.capabilityConfig!.image!.references.promptMaxChars).toBe(12000);
        expect(next.priceTiers).toBe(draft.priceTiers);
        expect(capabilityConfig.image!.size.presets![0].tier).toBe("1k");
        expect(updateChannelModelUpstreamCapabilities(next)).toBe(next);
        const back = updateChannelModelUpstreamCapabilities({ ...next, providerModelKey: "midjourney-1k" });
        expect(back.capabilityConfig!.image!.size.presets![0].tier).toBe("1k");
    });
    test("existing model profiles retain saved custom capabilities on reopening", () => {
        const capabilityConfig = defaultModelCapabilityConfig("cangyuan-midjourney-v7", "midjourney-v7");
        capabilityConfig.image!.references.maxImages = 2;
        const item = { modelKey: "midjourney-v7", providerModelKey: "midjourney-v7", capability: "image" as const, protocol: "cangyuan-midjourney-v7", capabilityConfig, enabled: true };
        const reopened = initialChannelModelValues(item as Parameters<typeof initialChannelModelValues>[0], [definition("cangyuan-midjourney-v7", "image")]);
        expect(reopened.capabilityConfig?.image?.references.maxImages).toBe(2);
        expect(updateChannelModelUpstreamCapabilities(reopened)).toBe(reopened);
    });
    test("validation errors map to their mounted tab", () => {
        expect(editorSectionForField(["priceTiers", 2, "providerModelKey"])).toBe("pricing");
        expect(editorSectionForField(["capabilityConfig"])).toBe("capabilities");
        expect(editorSectionForField(["protocol"])).toBe("identity");
    });
});

describe("spec tier write validation", () => {
    const draft = initialChannelModelValues(null, protocols);
    test("accepts the default all-spec tier", () => expect(() => validateChannelModelSpecTiers(draft)).not.toThrow());
    test("requires exactly one or zero fallback tiers", () => {
        expect(() => validateChannelModelSpecTiers({ ...draft, priceTiers: [] })).toThrow("至少");
        expect(() => validateChannelModelSpecTiers({ ...draft, priceTiers: [defaultPriceTier(), defaultPriceTier()] })).toThrow("只能");
    });
    test("rejects empty or stale advanced selectors", () => {
        expect(() => validateChannelModelSpecTiers({ ...draft, priceTiers: [defaultPriceTier("advanced")] })).toThrow("匹配条件");
        expect(() => validateChannelModelSpecTiers({ ...draft, priceTiers: [{ ...defaultPriceTier("advanced"), operation: "text_to_video" }] })).toThrow("不匹配");
    });
    test("rejects removed video conditions and accepts visible operation or resolution matches", () => {
        for (const hiddenCondition of [{ videoGenerateAudio: "false" }, { videoSeconds: 5 }, { imageCount: 2 }]) {
            expect(() => validateChannelModelSpecTiers({ ...draft, capability: "video", priceTiers: [{ ...defaultPriceTier("advanced"), ...hiddenCondition }] })).toThrow("匹配条件");
        }
        expect(() => validateChannelModelSpecTiers({ ...draft, capability: "video", priceTiers: [{ ...defaultPriceTier("advanced"), operation: "image_to_video" }] })).not.toThrow();
        expect(() => validateChannelModelSpecTiers({ ...draft, capability: "video", priceTiers: [{ ...defaultPriceTier("advanced"), resolution: "1080p" }] })).not.toThrow();
    });
});

test("platform pages load inside one settings modal boundary instead of replaying page loaders", async () => {
    const modal = await Bun.file(new URL("../src/components/settings/settings-modal.tsx", import.meta.url)).text();
    const pages = await Bun.file(new URL("../src/pages/admin/admin-route-pages.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text();
    expect(modal.match(/<Suspense/g)).toHaveLength(1);
    expect(pages).not.toContain("<Suspense");
    expect(css).not.toContain("admin-page-enter");
});
