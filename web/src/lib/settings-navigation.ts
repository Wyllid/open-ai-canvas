// Settings open as a modal over the current page: the `settings` search parameter names the section,
// so any route can show it and closing it returns to exactly where the user was.

export const SETTINGS_PARAM = "settings";

export type SettingsSectionKey =
    | "account"
    | "login-history"
    | "models"
    | "preferences"
    | "prompts"
    | "agent-memory"
    | "channels"
    | "runninghub"
    | "my-storage"
    | "model-channels"
    | "model-catalog"
    | "prompt-templates"
    | "workbench-tools"
    | "resources"
    | "storage"
    | "ark-assets"
    | "modules"
    | "plugins"
    | "skills"
    | "appearance"
    | "drawing"
    | "runtime"
    | "response-interception"
    | "third-party"
    | "updates"
    | "overview"
    | "requests"
    | "performance"
    | "diagnostics";

/** Sections that older links (`/settings?section=` and `/admin/...`) may still ask for. */
export type SettingsSection = "profile" | "channels" | "models" | "preferences" | "prompts" | "storage";

const LEGACY_SETTINGS_SECTIONS: Record<string, SettingsSectionKey> = {
    profile: "account",
    channels: "channels",
    models: "models",
    runninghub: "runninghub",
    preferences: "preferences",
    prompts: "prompts",
    "agent-memory": "agent-memory",
    storage: "my-storage",
    diagnostics: "diagnostics",
};

const LEGACY_ADMIN_PATHS: Record<string, SettingsSectionKey> = {
    "": "overview",
    users: "account",
    "login-logs": "login-history",
    channels: "model-channels",
    models: "model-catalog",
    plugins: "plugins",
    "workbench-tools": "workbench-tools",
    "skill-curation": "skills",
    "prompt-templates": "prompt-templates",
    "storyboard-prompts": "prompt-templates",
    announcements: "overview",
    "banner-announcements": "overview",
    "agent-lessons": "agent-memory",
    resources: "resources",
    logs: "requests",
    settings: "runtime",
    "settings/appearance": "appearance",
    "settings/drawing-engine": "drawing",
    "settings/concurrency": "runtime",
    "settings/runtime-policy": "runtime",
    "settings/features": "modules",
    "settings/storage": "storage",
    "settings/ark-private-assets": "ark-assets",
    "settings/response-interception": "response-interception",
    "settings/third-party": "third-party",
    "settings/libtv": "third-party",
    "settings/system-update": "updates",
    "settings/system-performance": "performance",
};

export function settingsSectionFromLegacy(section: string | null): SettingsSectionKey {
    return (section && LEGACY_SETTINGS_SECTIONS[section]) || "account";
}

export function settingsSectionFromAdminPath(pathname: string): SettingsSectionKey {
    const rest = pathname.replace(/^\/admin\/?/, "").replace(/\/+$/, "");
    return LEGACY_ADMIN_PATHS[rest] ?? "overview";
}

/** Search string for the current page with the settings modal open on `section`. */
export function settingsSearch(currentSearch: string, section: SettingsSectionKey, extra?: Record<string, string>) {
    const params = new URLSearchParams(currentSearch);
    params.set(SETTINGS_PARAM, section);
    for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
    return `?${params.toString()}`;
}

/** Search string for the current page with the settings modal and its own parameters removed. */
export function settingsClosedSearch(currentSearch: string) {
    const params = new URLSearchParams(currentSearch);
    for (const key of [SETTINGS_PARAM, "continue", "taskId", "projectId"]) params.delete(key);
    const search = params.toString();
    return search ? `?${search}` : "";
}

export function settingsPath(section?: SettingsSection, continueCreation = false) {
    const key = section ? settingsSectionFromLegacy(section) : continueCreation ? "channels" : "account";
    const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
    const search = typeof window === "undefined" ? "" : window.location.search;
    return `${pathname}${settingsSearch(search, key, continueCreation ? { continue: "1" } : undefined)}`;
}

/**
 * 画布深层组件没有路由上下文出口时，通过 workspace:navigate 打开设置弹窗；没有监听者时整页跳转。
 */
export function navigateToSettings(options?: { section?: SettingsSection; continueCreation?: boolean }) {
    dispatchWorkspaceNavigate(settingsPath(options?.section, options?.continueCreation));
}

/** Opens any settings section over the current page from code that has no router context. */
export function openSettingsSection(section: SettingsSectionKey) {
    dispatchWorkspaceNavigate(`${window.location.pathname}${settingsSearch(window.location.search, section)}`);
}

function dispatchWorkspaceNavigate(to: string) {
    const event = new CustomEvent<{ to: string }>("workspace:navigate", { detail: { to }, cancelable: true });
    if (window.dispatchEvent(event)) window.location.assign(to);
}
