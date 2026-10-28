import { describe, expect, test } from "bun:test";
import { profileAvatarError, PROFILE_AVATAR_MAX_BYTES, profilePasswordError } from "../src/pages/settings/profile-validation";
import { settingsClosedSearch, settingsPath, settingsSearch, settingsSectionFromAdminPath, settingsSectionFromLegacy } from "../src/lib/settings-navigation";
import { changeLocalAccount, getUserProfile, resetProfileAvatar, selectDefaultProfileAvatar, uploadProfileAvatar } from "../src/services/api/profile";
import { ApiError, apiClient } from "../src/services/api/request";

describe("profile input and security expiry", () => {
    test("rejects unsupported, empty and oversized avatar uploads", () => {
        expect(profileAvatarError({ type: "image/svg+xml", size: 100 })).toBeDefined();
        expect(profileAvatarError({ type: "image/png", size: 0 })).toBeDefined();
        expect(profileAvatarError({ type: "image/jpeg", size: PROFILE_AVATAR_MAX_BYTES + 1 })).toBeDefined();
        expect(profileAvatarError({ type: "image/png", size: PROFILE_AVATAR_MAX_BYTES })).toBeUndefined();
    });
    test("requires 12 characters and checks the UTF-8 byte limit to prevent bcrypt truncation", () => {
        expect(profilePasswordError("12345678901")).toBeDefined();
        expect(profilePasswordError("123456789012")).toBeUndefined();
        expect(profilePasswordError("a".repeat(72))).toBeUndefined();
        expect(profilePasswordError("a".repeat(73))).toBeDefined();
        expect(profilePasswordError("密".repeat(24))).toBeUndefined();
        expect(profilePasswordError("密".repeat(25))).toBeDefined();
        expect(profilePasswordError("😀".repeat(11))).toBeDefined();
        expect(profilePasswordError("😀".repeat(18))).toBeUndefined();
    });
    test("settings open as a modal on the current page", () => {
        // Without a browser location the modal opens over the home page.
        expect(settingsPath()).toBe("/?settings=account");
        expect(settingsPath(undefined, true)).toBe("/?settings=channels&continue=1");
        expect(settingsPath("models", true)).toBe("/?settings=models&continue=1");
        expect(settingsSearch("?tab=cast", "account")).toBe("?tab=cast&settings=account");
        expect(settingsSearch("?settings=account&taskId=t", "diagnostics")).toBe("?settings=diagnostics&taskId=t");
        expect(settingsClosedSearch("?tab=cast&settings=models&continue=1&taskId=t")).toBe("?tab=cast");
    });
    test("old settings and admin links open the matching section", () => {
        expect(settingsSectionFromLegacy("profile")).toBe("account");
        expect(settingsSectionFromLegacy("storage")).toBe("my-storage");
        expect(settingsSectionFromLegacy(null)).toBe("account");
        expect(settingsSectionFromAdminPath("/admin")).toBe("overview");
        expect(settingsSectionFromAdminPath("/admin/users")).toBe("account");
        expect(settingsSectionFromAdminPath("/admin/settings/appearance/")).toBe("appearance");
        expect(settingsSectionFromAdminPath("/admin/unknown")).toBe("overview");
    });
});

describe("profile API request contract", () => {
    test("forwards load cancellation and uses multipart avatar without forcing content type", async () => {
        const original = apiClient.request;
        const requests: Array<Record<string, unknown>> = [];
        apiClient.request = (async (config: Record<string, unknown>) => {
            requests.push(config);
            return { data: { code: 0, data: { user: { id: "user-1" } }, msg: "ok" }, status: 200 };
        }) as typeof apiClient.request;
        try {
            const signal = new AbortController().signal;
            await getUserProfile(signal);
            const file = new File(["image-bytes"], "avatar.png", { type: "image/png" });
            await uploadProfileAvatar(file);
            await resetProfileAvatar();
            await selectDefaultProfileAvatar("cat");
            expect(requests[0]).toMatchObject({ url: "/auth/profile", method: "get", signal });
            expect(requests[1]).toMatchObject({ url: "/auth/profile/avatar", method: "put" });
            const multipart = requests[1].data as FormData;
            expect(multipart.get("file")).toBeInstanceOf(File);
            expect((multipart.get("file") as File).name).toBe("avatar.png");
            expect(requests[1].headers).toBeUndefined();
            expect(requests[2]).toMatchObject({ url: "/auth/profile/avatar", method: "delete" });
            expect(requests[3]).toMatchObject({ url: "/auth/profile/avatar/default", method: "post", data: { preset: "cat" } });
        } finally {
            apiClient.request = original;
        }
    });
    test("keeps passwords in POST bodies", async () => {
        const original = apiClient.request;
        const requests: Array<Record<string, unknown>> = [];
        apiClient.request = (async (config: Record<string, unknown>) => {
            requests.push(config);
            return { data: { code: 0, data: { changed: true }, msg: "ok" }, status: 200 };
        }) as typeof apiClient.request;
        try {
            await changeLocalAccount({ currentPassword: "old-password", username: "studio", newPassword: "a-new-long-password" });
            expect(requests.map((request) => request.url)).toEqual(["/auth/profile/account"]);
            expect(requests.every((request) => request.method === "post" && request.params === undefined)).toBe(true);
            expect(requests[0].data).toEqual({ currentPassword: "old-password", username: "studio", newPassword: "a-new-long-password" });
        } finally {
            apiClient.request = original;
        }
    });
    test("propagates failed security writes with the backend reason", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => ({ data: { code: 40001, data: null, msg: "身份验证失败", reason: "bad_auth_request" }, status: 400 })) as typeof apiClient.request;
        try {
            const error = await changeLocalAccount({ currentPassword: "wrong", username: "studio", newPassword: "a-new-long-password" }).catch((failure) => failure);
            expect(error).toBeInstanceOf(ApiError);
            expect(error.reason).toBe("bad_auth_request");
        } finally {
            apiClient.request = original;
        }
    });
});
