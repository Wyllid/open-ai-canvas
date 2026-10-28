import { describe, expect, test } from "bun:test";

import { defaultPriceTier, priceTierPayloadFromForm, priceTierResolutionFromForm, priceTierToForm, priceTierVideoSecondsFromForm, skuSelectorFromForm } from "../src/pages/admin/components/channel-model-price-tier-form";
import type { ChannelModelPriceTier } from "../src/services/api/channel-models";

describe("channel model spec tier defaults", () => {
    test("creates a usable all-spec fallback tier by default", () => {
        const tier = defaultPriceTier();

        expect(tier.matchMode).toBe("default");
        expect(tier.enabled).toBe(true);
        expect(skuSelectorFromForm("image", { ...tier, quality: "2k", size: "1:1" })).toEqual({});
    });

    test("keeps explicit image specification selectors when advanced mode is selected", () => {
        const tier = defaultPriceTier("advanced");

        expect(skuSelectorFromForm("image", { ...tier, quality: "2k", size: "1:1" })).toEqual({ quality: "2k", size: "1:1" });
    });

    test("drops stale video selectors after switching back to the default tier", () => {
        const tier = { ...defaultPriceTier("advanced"), resolution: "1080p", videoSeconds: 10, videoGenerateAudio: "false", imageCount: 2 };
        const defaultTier = { ...tier, matchMode: "default" as const };

        expect(skuSelectorFromForm("video", defaultTier)).toEqual({});
        expect(priceTierResolutionFromForm("video", defaultTier)).toBe("*");
        expect(priceTierVideoSecondsFromForm("video", defaultTier)).toBe(0);
    });

    test("restores existing specific tiers in advanced mode and wildcard tiers as defaults", () => {
        const base: ChannelModelPriceTier = {
            id: "tier-1",
            channelModelId: "model-1",
            selector: {},
            selectorKey: "{}",
            resolution: "*",
            videoSeconds: 0,
            providerModelKey: "gpt-image-2",
            enabled: true,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
        };

        expect(priceTierToForm(base).matchMode).toBe("default");
        expect(priceTierToForm({ ...base, selector: { quality: "2k" } }).matchMode).toBe("advanced");
        expect(priceTierToForm({ ...base, selector: { videoGenerateAudio: "false" } })).toMatchObject({ matchMode: "default", videoGenerateAudio: "false" });
    });

    test("keeps video matching limited to operation and resolution", () => {
        for (const videoGenerateAudio of ["true", "false"]) {
            const tier = { ...defaultPriceTier("advanced"), operation: "image_to_video", resolution: "1080p", videoSeconds: 10, videoGenerateAudio, imageCount: 2 };
            expect(skuSelectorFromForm("video", tier)).toEqual({ operation: "image_to_video", vquality: "1080p" });
            expect(priceTierVideoSecondsFromForm("video", tier)).toBe(0);
            expect(skuSelectorFromForm("image", { ...defaultPriceTier("advanced"), videoSeconds: 10, videoGenerateAudio, imageCount: 2 })).toEqual({});
        }
        expect(skuSelectorFromForm("video", defaultPriceTier("advanced"))).toEqual({});
    });

    test("payload carries selector, routing and enabled state only", () => {
        const tier = { ...defaultPriceTier("advanced"), videoGenerateAudio: "false" };
        expect(priceTierPayloadFromForm("video", tier, "seedance")).toEqual({ selector: {}, resolution: "*", videoSeconds: 0, providerModelKey: "seedance", enabled: true });
        expect(priceTierPayloadFromForm("video", { ...tier, providerModelKey: " seedance-hq " }, "seedance").providerModelKey).toBe("seedance-hq");
        expect(priceTierToForm({ ...(priceTierPayloadFromForm("video", tier, "seedance") as ChannelModelPriceTier) })).toMatchObject({ providerModelKey: "seedance", enabled: true });
    });
});
