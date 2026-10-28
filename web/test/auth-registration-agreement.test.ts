import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("注册服务协议", () => {
    test("公开认证设置暴露协议字段，管理接口可回传协议正文", () => {
        const auth = readFileSync(resolve(import.meta.dir, "../src/services/api/auth.ts"), "utf8");
        const adminSettings = readFileSync(resolve(import.meta.dir, "../src/services/api/admin-settings.ts"), "utf8");
        const panel = readFileSync(resolve(import.meta.dir, "../src/pages/admin/components/access-settings-panel.tsx"), "utf8");

        expect(auth).toContain("agreementTitle?: string;");
        expect(auth).toContain("agreementContent?: string;");
        expect(adminSettings).toContain("agreementTitle?: string");
        expect(adminSettings).toContain("agreementContent?: string");
        expect(panel).toContain("服务协议名称与条款");
        expect(panel).toContain("saveAgreement");
    });
});
