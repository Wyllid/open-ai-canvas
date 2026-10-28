import { describe, expect, test } from "bun:test";

import { tr, trIn, trParts } from "@/i18n";

// Without a loaded catalog the source text is the translation, as in tests and the Chinese interface.
describe("i18n", () => {
    test("tr fills numbered placeholders", () => {
        expect(tr("第 {0} 集 · {1}", 2, "改编剧本")).toBe("第 2 集 · 改编剧本");
        expect(tr("找到 {0} 个节点")).toBe("找到 {0} 个节点");
    });

    test("trParts keeps args as values, including repeated placeholders", () => {
        const range = { kind: "range" };
        expect(trParts("第 {0} {1}，共 {2} {1}", range, "条", "30")).toEqual(["第 ", range, " ", "条", "，共 ", "30", " ", "条", ""]);
    });

    test("trIn falls back to the plain source text", () => {
        expect(trIn("user", "角色")).toBe("角色");
    });
});
