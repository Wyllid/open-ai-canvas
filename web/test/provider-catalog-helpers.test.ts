import { describe, expect, test } from "bun:test";

import { matchesProvider, tierSpecLabel } from "../src/pages/admin/channels/provider-catalog-helpers";

describe("provider catalog helpers", () => {
    test("labels selectors and matches search", () => {
        expect(tierSpecLabel({ selector: { operation: "text_to_video", vquality: "1080p", videoSeconds: "5" } })).toBe("文生 · 1080p · 5s");
        expect(tierSpecLabel({})).toBe("默认规格");
        const provider = { name: "Acme", baseUrl: "https://api.acme.example", models: [{ displayName: "Seedance Pro", modelKey: "seedance-pro" }] } as never;
        expect(matchesProvider(provider, "seedance")).toBe(true);
        expect(matchesProvider(provider, "kimi")).toBe(false);
    });
});
