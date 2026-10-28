import { tr } from "@/i18n";
export type SkinThemeMode = "light" | "dark";
export type SkinShadowStyle = "none" | "soft" | "strong";

export type SkinButtonFill = {
    mode: "solid" | "gradient";
    angle: number;
    start: string;
    end: string;
    hoverStart: string;
    hoverEnd: string;
    activeStart: string;
    activeEnd: string;
    foreground: string;
};

export const DEFAULT_BUTTON_GRADIENT: SkinButtonFill = {
    mode: "gradient", angle: 115,
    start: "#6554df", end: "#386fbc",
    hoverStart: "#5744cf", hoverEnd: "#356bbb",
    activeStart: "#4938b8", activeEnd: "#2c5da5", foreground: "#ffffff",
};

export const SKIN_BUTTON_COLOR_FIELDS = [
    { key: "start", label: tr("渐变起色") }, { key: "end", label: tr("渐变终色") },
    { key: "hoverStart", label: tr("悬停起色") }, { key: "hoverEnd", label: tr("悬停终色") },
    { key: "activeStart", label: tr("按下起色") }, { key: "activeEnd", label: tr("按下终色") },
    { key: "foreground", label: tr("渐变按钮文字") },
] as const;

export type SkinModeTokens = {
    canvas: string;
    surface: string;
    surfaceSubtle: string;
    surfaceRaised: string;
    overlay: string;
    text: string;
    textMuted: string;
    border: string;
    control: string;
    controlHover: string;
    controlActive: string;
    controlBorder: string;
    controlFocus: string;
    controlDisabledBackground: string;
    controlDisabledForeground: string;
    switchChecked: string;
    switchCheckedHover: string;
    switchCheckedHandle: string;
    switchUnchecked: string;
    switchUncheckedHover: string;
    switchUncheckedHandle: string;
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primaryForeground: string;
    selected: string;
    selectedHover: string;
    selectedActive: string;
    selectedForeground: string;
    icon: string;
    iconMuted: string;
    iconActive: string;
    success: string;
    warning: string;
    danger: string;
    dangerHover: string;
    dangerActive: string;
    dangerForeground: string;
    info: string;
    workspace: string;
    workspaceGrid: string;
    adminBackground: string;
    adminSurface: string;
    adminSubtle: string;
    adminStrong: string;
    authBackground: string;
    authPanel: string;
    authCard: string;
    authAccent: string;
    authMuted: string;
};

export type SkinComponentTokens = {
    buttonRadius: number;
    inputRadius: number;
    cardRadius: number;
    overlayRadius: number;
    menuRadius: number;
    checkboxRadius: number;
    controlHeight: number;
    controlHeightSmall: number;
    controlHeightLarge: number;
    borderWidth: number;
    focusRingWidth: number;
    iconSize: number;
    buttonFontWeight: number;
    hoverLift: number;
    motionFast: number;
    motionNormal: number;
    shadowStyle: SkinShadowStyle;
};

export type SkinTokens = {
    light: SkinModeTokens;
    dark: SkinModeTokens;
    components: SkinComponentTokens;
    buttons: Record<SkinThemeMode, SkinButtonFill>;
};

export type SkinDefinition = {
    id: string;
    name: string;
    description: string;
    locked: boolean;
    tokens: SkinTokens;
};

export type SkinAntOverrides = {
    text: string;
    textMuted: string;
    primary: string;
    primaryHover: string;
    primaryActive: string;
    primaryForeground: string;
    selected: string;
    selectedHover: string;
    selectedActive: string;
    selectedForeground: string;
    controlSurface: string;
    controlHover: string;
    controlActive: string;
    controlBorder: string;
    controlFocus: string;
    controlDisabledBackground: string;
    controlDisabledForeground: string;
    switchChecked: string;
    switchCheckedHover: string;
    switchCheckedHandle: string;
    switchUnchecked: string;
    switchUncheckedHover: string;
    switchUncheckedHandle: string;
    elevatedBackground: string;
    subtleBackground: string;
    menuBackground: string;
    menuForeground: string;
    icon: string;
    iconHover: string;
    success: string;
    warning: string;
    danger: string;
    dangerHover: string;
    dangerActive: string;
    dangerForeground: string;
    info: string;
    borderRadius: number;
    borderRadiusLG: number;
    borderRadiusSM: number;
    buttonRadius: number;
    inputRadius: number;
    overlayRadius: number;
    menuRadius: number;
    checkboxRadius: number;
    controlHeight: number;
    controlHeightSmall: number;
    controlHeightLarge: number;
    borderWidth: number;
    iconSize: number;
    buttonFontWeight: number;
    motionFast: number;
    motionNormal: number;
    shadowStyle: SkinShadowStyle;
};

export type SkinColorField = {
    key: keyof SkinModeTokens;
    label: string;
    help: string;
};

export type SkinColorGroup = {
    key: string;
    label: string;
    fields: readonly SkinColorField[];
};

export type SkinComponentNumberField = {
    key: Exclude<keyof SkinComponentTokens, "shadowStyle">;
    label: string;
    suffix: string;
    min: number;
    max: number;
    step?: number;
};

export const SKIN_COLOR_GROUPS: readonly SkinColorGroup[] = [
    {
        key: "foundation",
        label: tr("基础表面与文字"),
        fields: [
            { key: "canvas", label: tr("页面背景"), help: tr("全站页面与画布底色") },
            { key: "surface", label: tr("基础表面"), help: tr("卡片、常规容器与输入区") },
            { key: "surfaceSubtle", label: tr("次级表面"), help: tr("弱分区、表头与悬停底色") },
            { key: "surfaceRaised", label: tr("强调表面"), help: tr("高层级卡片与激活容器") },
            { key: "overlay", label: tr("浮层表面"), help: tr("下拉、弹窗和气泡菜单") },
            { key: "text", label: tr("主要文字"), help: tr("标题和正文") },
            { key: "textMuted", label: tr("次要文字"), help: tr("说明、占位和元数据") },
            { key: "border", label: tr("分隔与边界"), help: tr("普通描边和分隔线") },
        ],
    },
    {
        key: "controls",
        label: tr("控件与交互状态"),
        fields: [
            { key: "control", label: tr("控件背景"), help: tr("输入框、复选框和普通按钮") },
            { key: "controlHover", label: tr("控件悬停"), help: tr("普通控件 hover 背景") },
            { key: "controlActive", label: tr("控件按下"), help: tr("普通控件 active 背景") },
            { key: "controlBorder", label: tr("控件边框"), help: tr("输入与选择控件边界") },
            { key: "controlFocus", label: tr("键盘焦点"), help: tr("focus-visible 与输入焦点") },
            { key: "controlDisabledBackground", label: tr("禁用背景"), help: tr("不可操作控件背景") },
            { key: "controlDisabledForeground", label: tr("禁用前景"), help: tr("不可操作文字和图标") },
            { key: "switchChecked", label: tr("开关开启"), help: tr("Switch 开启轨道，须与关闭态明显区分") },
            { key: "switchCheckedHover", label: tr("开启悬停"), help: tr("开启状态 hover 轨道") },
            { key: "switchCheckedHandle", label: tr("开启滑块"), help: tr("开启状态圆形滑块") },
            { key: "switchUnchecked", label: tr("开关关闭"), help: tr("Switch 关闭轨道") },
            { key: "switchUncheckedHover", label: tr("关闭悬停"), help: tr("关闭状态 hover 轨道") },
            { key: "switchUncheckedHandle", label: tr("关闭滑块"), help: tr("关闭状态圆形滑块") },
            { key: "primary", label: tr("主操作"), help: tr("纯色主按钮与链接；开关使用独立颜色") },
            { key: "primaryHover", label: tr("主操作悬停"), help: tr("主要操作 hover") },
            { key: "primaryActive", label: tr("主操作按下"), help: tr("主要操作 active") },
            { key: "primaryForeground", label: tr("主操作前景"), help: tr("主按钮上的文字和图标") },
            { key: "selected", label: tr("选中背景"), help: tr("菜单、单选与分段控件") },
            { key: "selectedHover", label: tr("选中悬停"), help: tr("已选项 hover") },
            { key: "selectedActive", label: tr("选中按下"), help: tr("已选项 active") },
            { key: "selectedForeground", label: tr("选中前景"), help: tr("已选项文字和图标") },
        ],
    },
    {
        key: "signals",
        label: tr("图标与状态"),
        fields: [
            { key: "icon", label: tr("普通图标"), help: tr("工具栏和普通功能图标") },
            { key: "iconMuted", label: tr("弱化图标"), help: tr("低优先级和占位图标") },
            { key: "iconActive", label: tr("激活图标"), help: tr("当前工具和强调图标") },
            { key: "success", label: tr("成功"), help: tr("完成与可用状态") },
            { key: "warning", label: tr("警告"), help: tr("待处理与风险提示") },
            { key: "danger", label: tr("危险"), help: tr("错误、删除与破坏性操作") },
            { key: "dangerHover", label: tr("危险悬停"), help: tr("破坏性操作 hover") },
            { key: "dangerActive", label: tr("危险按下"), help: tr("破坏性操作 active") },
            { key: "dangerForeground", label: tr("危险前景"), help: tr("实心危险按钮文字和图标") },
            { key: "info", label: tr("信息"), help: tr("普通说明和处理中状态") },
        ],
    },
    {
        key: "scenes",
        label: tr("业务场景表面"),
        fields: [
            { key: "workspace", label: tr("创作工作区"), help: tr("工作区卡片和画布承载面") },
            { key: "workspaceGrid", label: tr("画布网格"), help: tr("画布网格与空间辅助线") },
            { key: "adminBackground", label: tr("后台底层"), help: tr("管理后台页面底色") },
            { key: "adminSurface", label: tr("后台卡片"), help: tr("管理后台主卡片") },
            { key: "adminSubtle", label: tr("后台次级层"), help: tr("后台弱分区") },
            { key: "adminStrong", label: tr("后台强调层"), help: tr("后台高对比区块") },
            { key: "authBackground", label: tr("登录页背景"), help: tr("登录页整体底色") },
            { key: "authPanel", label: tr("登录表单区"), help: tr("登录页右侧表单面板") },
            { key: "authCard", label: tr("登录卡片"), help: tr("登录表单卡片") },
            { key: "authAccent", label: tr("登录页强调"), help: tr("登录页品牌强调文字") },
            { key: "authMuted", label: tr("登录页次要文字"), help: tr("登录页说明和辅助信息") },
        ],
    },
] as const;

export const SKIN_COMPONENT_NUMBER_FIELDS: readonly SkinComponentNumberField[] = [
    { key: "buttonRadius", label: tr("按钮圆角"), suffix: "px", min: 0, max: 32 },
    { key: "inputRadius", label: tr("输入框圆角"), suffix: "px", min: 0, max: 32 },
    { key: "cardRadius", label: tr("卡片圆角"), suffix: "px", min: 0, max: 40 },
    { key: "overlayRadius", label: tr("弹窗与浮层圆角"), suffix: "px", min: 0, max: 40 },
    { key: "menuRadius", label: tr("菜单圆角"), suffix: "px", min: 0, max: 32 },
    { key: "checkboxRadius", label: tr("复选框圆角"), suffix: "px", min: 0, max: 12 },
    { key: "controlHeight", label: tr("标准控件高度"), suffix: "px", min: 30, max: 48 },
    { key: "controlHeightSmall", label: tr("小号控件高度"), suffix: "px", min: 24, max: 40 },
    { key: "controlHeightLarge", label: tr("大号控件高度"), suffix: "px", min: 36, max: 56 },
    { key: "borderWidth", label: tr("控件描边"), suffix: "px", min: 1, max: 3 },
    { key: "focusRingWidth", label: tr("键盘焦点环"), suffix: "px", min: 1, max: 4 },
    { key: "iconSize", label: tr("标准图标尺寸"), suffix: "px", min: 12, max: 24 },
    { key: "buttonFontWeight", label: tr("按钮字重"), suffix: "", min: 400, max: 700, step: 50 },
    { key: "hoverLift", label: tr("卡片悬停抬升"), suffix: "px", min: 0, max: 4 },
    { key: "motionFast", label: tr("快速反馈时长"), suffix: "ms", min: 0, max: 400, step: 10 },
    { key: "motionNormal", label: tr("常规过渡时长"), suffix: "ms", min: 0, max: 800, step: 10 },
] as const;

export const DEFAULT_CLASSIC_SKIN: SkinDefinition = {
    id: "classic",
    name: tr("经典黑白"),
    description: tr("项目原始样式 · 不可修改"),
    locked: true,
    tokens: {
        light: {
            canvas: "#ffffff",
            surface: "#ffffff",
            surfaceSubtle: "#f7f7f7",
            surfaceRaised: "#ececec",
            overlay: "#ffffff",
            text: "#171717",
            textMuted: "#737373",
            border: "#e5e5e5",
            control: "#ffffff",
            controlHover: "#f5f5f5",
            controlActive: "#ececec",
            controlBorder: "#d1d1d1",
            controlFocus: "#171717",
            controlDisabledBackground: "#f2f2f2",
            controlDisabledForeground: "#a3a3a3",
            switchChecked: "#16a34a",
            switchCheckedHover: "#15803d",
            switchCheckedHandle: "#ffffff",
            switchUnchecked: "#b8b8b8",
            switchUncheckedHover: "#9f9f9f",
            switchUncheckedHandle: "#ffffff",
            primary: "#171717",
            primaryHover: "#303030",
            primaryActive: "#404040",
            primaryForeground: "#ffffff",
            selected: "#e8e8e8",
            selectedHover: "#dedede",
            selectedActive: "#d5d5d5",
            selectedForeground: "#171717",
            icon: "#3f3f46",
            iconMuted: "#a1a1aa",
            iconActive: "#171717",
            success: "#16a34a",
            warning: "#d97706",
            danger: "#dc2626",
            dangerHover: "#b91c1c",
            dangerActive: "#991b1b",
            dangerForeground: "#ffffff",
            info: "#2563eb",
            workspace: "#ffffff",
            workspaceGrid: "#f3f3f3",
            adminBackground: "#f3f4f6",
            adminSurface: "#ffffff",
            adminSubtle: "#f7f8fa",
            adminStrong: "#eceff3",
            authBackground: "#ffffff",
            authPanel: "#f7f7f7",
            authCard: "#ffffff",
            authAccent: "#2563eb",
            authMuted: "#737373",
        },
        dark: {
            canvas: "#0a0a0a",
            surface: "#181818",
            surfaceSubtle: "#202020",
            surfaceRaised: "#2a2a2a",
            overlay: "#1f1f20",
            text: "#f5f5f5",
            textMuted: "#a3a3a3",
            border: "#2d2d2d",
            control: "#202020",
            controlHover: "#292929",
            controlActive: "#333333",
            controlBorder: "#4a4a4a",
            controlFocus: "#f5f5f5",
            controlDisabledBackground: "#252525",
            controlDisabledForeground: "#737373",
            switchChecked: "#22c55e",
            switchCheckedHover: "#4ade80",
            switchCheckedHandle: "#071a0f",
            switchUnchecked: "#525252",
            switchUncheckedHover: "#686868",
            switchUncheckedHandle: "#f5f5f5",
            primary: "#f5f5f5",
            primaryHover: "#ffffff",
            primaryActive: "#e5e5e5",
            primaryForeground: "#171717",
            selected: "#2b2b2b",
            selectedHover: "#343434",
            selectedActive: "#3d3d3d",
            selectedForeground: "#f5f5f5",
            icon: "#d4d4d8",
            iconMuted: "#71717a",
            iconActive: "#ffffff",
            success: "#4ade80",
            warning: "#fbbf24",
            danger: "#f87171",
            dangerHover: "#fca5a5",
            dangerActive: "#ef4444",
            dangerForeground: "#2b0808",
            info: "#60a5fa",
            workspace: "#181818",
            workspaceGrid: "#222222",
            adminBackground: "#101010",
            adminSurface: "#181818",
            adminSubtle: "#202020",
            adminStrong: "#2a2a2a",
            authBackground: "#08090c",
            authPanel: "#0b0c10",
            authCard: "#121318",
            authAccent: "#93c5fd",
            authMuted: "#8a8b91",
        },
        buttons: { light: { ...DEFAULT_BUTTON_GRADIENT }, dark: { ...DEFAULT_BUTTON_GRADIENT } },
        components: {
            buttonRadius: 6,
            inputRadius: 6,
            cardRadius: 12,
            overlayRadius: 12,
            menuRadius: 8,
            checkboxRadius: 4,
            controlHeight: 36,
            controlHeightSmall: 30,
            controlHeightLarge: 42,
            borderWidth: 1,
            focusRingWidth: 2,
            iconSize: 16,
            buttonFontWeight: 500,
            hoverLift: 1,
            motionFast: 120,
            motionNormal: 180,
            shadowStyle: "soft",
        },
    },
};

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const MANAGED_VARIABLES = [
    "--button-primary-bg", "--button-primary-hover-bg", "--button-primary-active-bg", "--button-primary-fg",
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--destructive-hover",
    "--destructive-active",
    "--destructive-foreground",
    "--border",
    "--input",
    "--ring",
    "--surface",
    "--surface-hover",
    "--surface-active",
    "--surface-card",
    "--surface-card-hover",
    "--card-surface",
    "--card-surface-hover",
    "--card-surface-raised",
    "--btn-solid-bg",
    "--btn-solid-hover-bg",
    "--btn-solid-active-bg",
    "--btn-solid-fg",
    "--control-selected-bg",
    "--control-selected-hover-bg",
    "--control-selected-fg",
    "--control-selected-border",
    "--control-check-bg",
    "--control-check-fg",
    "--control-switch-checked-bg",
    "--control-switch-checked-hover-bg",
    "--control-switch-checked-handle",
    "--control-switch-off-bg",
    "--control-switch-off-hover-bg",
    "--control-switch-off-handle",
    "--control-disabled-bg",
    "--control-disabled-fg",
    "--control-focus-ring",
    "--workspace-surface",
    "--workspace-surface-strong",
    "--workspace-border",
    "--workspace-border-strong",
    "--workspace-grid-line",
    "--workspace-accent",
    "--workspace-accent-soft",
    "--skin-admin-layer-0",
    "--skin-admin-layer-1",
    "--skin-admin-layer-2",
    "--skin-admin-layer-3",
    "--auth-page-bg",
    "--auth-panel-bg",
    "--auth-card-bg",
    "--auth-accent",
    "--auth-muted",
    "--palette-status-success",
    "--palette-status-error",
    "--palette-status-loading",
    "--palette-status-warning",
    "--icon-foreground",
    "--icon-muted",
    "--icon-active",
    "--r-sm",
    "--r-md",
    "--r-lg",
    "--r-xl",
    "--r-2xl",
    "--radius",
    "--control-radius",
    "--button-radius",
    "--input-radius",
    "--card-radius",
    "--overlay-radius",
    "--menu-radius",
    "--checkbox-radius",
    "--control-border-width",
    "--focus-ring-width",
    "--icon-size",
    "--theme-hover-lift",
    "--motion-instant",
    "--motion-state",
    "--elevation-card",
    "--elevation-card-hover",
    "--elevation-overlay",
    "--theme-admin-card-shadow",
] as const;

export function normalizeSkinDefinition(value: unknown, fallback: SkinDefinition = DEFAULT_CLASSIC_SKIN): SkinDefinition {
    if (!value || typeof value !== "object") return cloneSkinDefinition(fallback);
    const candidate = value as Partial<SkinDefinition>;
    const id = typeof candidate.id === "string" && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(candidate.id) ? candidate.id : fallback.id;
    const modes = candidate.tokens;
    const light = normalizeSkinMode(modes?.light, fallback.tokens.light);
    const dark = normalizeSkinMode(modes?.dark, fallback.tokens.dark);
    if (!modes || !light || !dark || !isSkinComponents(modes.components)) return cloneSkinDefinition(fallback);
    return {
        id,
        name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 40) : fallback.name,
        description: typeof candidate.description === "string" ? candidate.description.trim().slice(0, 100) : fallback.description,
        locked: id === "classic",
        tokens: { light, dark, components: { ...modes.components }, buttons: {
            light: normalizeButtonFill(modes.buttons?.light, id),
            dark: normalizeButtonFill(modes.buttons?.dark, id),
        } },
    };
}

export function cloneSkinDefinition(source: SkinDefinition): SkinDefinition {
    return { ...source, tokens: cloneSkinTokens(source.tokens) };
}

export function createSkinThemeID(existingIDs: Iterable<string>) {
    const existing = new Set(existingIDs);
    const base = `custom-${Date.now().toString(36)}`;
    let candidate = base;
    let suffix = 2;
    while (existing.has(candidate)) candidate = `${base}-${suffix++}`;
    return candidate;
}

export function duplicateSkinDefinition(source: SkinDefinition, existingIDs: Iterable<string>, name?: string): SkinDefinition {
    const copy = cloneSkinDefinition(source);
    copy.id = createSkinThemeID(existingIDs);
    copy.name = (name || tr("{0} 副本", source.name)).slice(0, 40);
    copy.description = source.id === "classic" ? tr("从经典黑白参数复制，可自由调整") : tr("复制自 {0}", source.name);
    copy.locked = false;
    return copy;
}

export function skinSwatches(skin: SkinDefinition) {
    const frequencyOrder: readonly (keyof SkinModeTokens)[] = [
        "canvas",
        "surface",
        "text",
        "textMuted",
        "border",
        "surfaceSubtle",
        "control",
        "controlHover",
        "primary",
        "primaryHover",
        "selected",
        "selectedForeground",
        "surfaceRaised",
        "overlay",
        "controlBorder",
        "switchChecked",
        "switchUnchecked",
        "icon",
        "iconMuted",
        "iconActive",
        "success",
        "warning",
        "danger",
        "info",
        "workspace",
        "workspaceGrid",
        "adminBackground",
        "adminSurface",
        "adminSubtle",
        "adminStrong",
        "authBackground",
        "authPanel",
        "authCard",
        "authAccent",
        "authMuted",
        "controlActive",
        "controlFocus",
        "controlDisabledBackground",
        "controlDisabledForeground",
        "primaryActive",
        "primaryForeground",
        "selectedHover",
        "selectedActive",
        "switchCheckedHover",
        "switchCheckedHandle",
        "switchUncheckedHover",
        "switchUncheckedHandle",
        "dangerHover",
        "dangerActive",
        "dangerForeground",
    ];
    const colors = frequencyOrder.flatMap((key) => [skin.tokens.light[key], skin.tokens.dark[key]]);
    return [...new Set(colors)];
}

export function normalizeSkinID(value: unknown) {
    return normalizeSkinDefinition(value).id;
}

export function getSkinAntOverrides(value: unknown, mode: SkinThemeMode): Partial<SkinAntOverrides> {
    const skin = normalizeSkinDefinition(value);
    if (skin.id === "classic") return {};
    const color = skin.tokens[mode];
    const component = skin.tokens.components;
    return {
        text: color.text,
        textMuted: color.textMuted,
        primary: color.primary,
        primaryHover: color.primaryHover,
        primaryActive: color.primaryActive,
        primaryForeground: color.primaryForeground,
        selected: color.selected,
        selectedHover: color.selectedHover,
        selectedActive: color.selectedActive,
        selectedForeground: color.selectedForeground,
        controlSurface: color.control,
        controlHover: color.controlHover,
        controlActive: color.controlActive,
        controlBorder: color.controlBorder,
        controlFocus: color.controlFocus,
        controlDisabledBackground: color.controlDisabledBackground,
        controlDisabledForeground: color.controlDisabledForeground,
        switchChecked: color.switchChecked,
        switchCheckedHover: color.switchCheckedHover,
        switchCheckedHandle: color.switchCheckedHandle,
        switchUnchecked: color.switchUnchecked,
        switchUncheckedHover: color.switchUncheckedHover,
        switchUncheckedHandle: color.switchUncheckedHandle,
        elevatedBackground: color.overlay,
        subtleBackground: color.surfaceSubtle,
        menuBackground: color.selected,
        menuForeground: color.selectedForeground,
        icon: color.icon,
        iconHover: color.iconActive,
        success: color.success,
        warning: color.warning,
        danger: color.danger,
        dangerHover: color.dangerHover,
        dangerActive: color.dangerActive,
        dangerForeground: color.dangerForeground,
        info: color.info,
        borderRadius: component.buttonRadius,
        borderRadiusLG: component.cardRadius,
        borderRadiusSM: component.inputRadius,
        buttonRadius: component.buttonRadius,
        inputRadius: component.inputRadius,
        overlayRadius: component.overlayRadius,
        menuRadius: component.menuRadius,
        checkboxRadius: component.checkboxRadius,
        controlHeight: component.controlHeight,
        controlHeightSmall: component.controlHeightSmall,
        controlHeightLarge: component.controlHeightLarge,
        borderWidth: component.borderWidth,
        iconSize: component.iconSize,
        buttonFontWeight: component.buttonFontWeight,
        motionFast: component.motionFast,
        motionNormal: component.motionNormal,
        shadowStyle: component.shadowStyle,
    };
}

export function applySkinTheme(skinValue: unknown, mode: SkinThemeMode, targetDocument: Document | undefined = typeof document === "undefined" ? undefined : document) {
    if (!targetDocument) return;
    const skin = normalizeSkinDefinition(skinValue);
    const root = targetDocument.documentElement;
    for (const property of MANAGED_VARIABLES) root.style.removeProperty(property);
    if (skin.id !== "classic") {
        const values = skinCSSVariables(skin, mode);
        for (const [property, value] of Object.entries(values)) root.style.setProperty(property, value);
    }
    for (const [property, value] of Object.entries(skinButtonCSSVariables(skin, mode))) root.style.setProperty(property, value);
    root.dataset.skin = skin.id;
}

export function isSkinButtonFill(value: unknown): value is SkinButtonFill {
    if (!value || typeof value !== "object") return false;
    const fill = value as SkinButtonFill;
    return ["solid", "gradient"].includes(fill.mode) && Number.isInteger(fill.angle) && fill.angle >= 0 && fill.angle <= 360
        && SKIN_BUTTON_COLOR_FIELDS.every(({ key }) => typeof fill[key] === "string" && HEX_COLOR.test(fill[key]));
}

function normalizeButtonFill(value: unknown, skinID: string): SkinButtonFill {
    return isSkinButtonFill(value) ? { ...value } : { ...DEFAULT_BUTTON_GRADIENT, mode: skinID === "classic" ? "gradient" : "solid" };
}

export function getSkinButtonAppearance(skin: SkinDefinition, mode: SkinThemeMode) {
    const fill = normalizeButtonFill(skin.tokens.buttons?.[mode], skin.id);
    const color = skin.tokens[mode];
    const gradient = (start: string, end: string) => `linear-gradient(${fill.angle}deg, ${start}, ${end})`;
    return fill.mode === "gradient" ? {
        background: gradient(fill.start, fill.end), hover: gradient(fill.hoverStart, fill.hoverEnd),
        active: gradient(fill.activeStart, fill.activeEnd), foreground: fill.foreground,
    } : { background: color.primary, hover: color.primaryHover, active: color.primaryActive, foreground: color.primaryForeground };
}

function skinButtonCSSVariables(skin: SkinDefinition, mode: SkinThemeMode) {
    const button = getSkinButtonAppearance(skin, mode);
    return { "--button-primary-bg": button.background, "--button-primary-hover-bg": button.hover,
        "--button-primary-active-bg": button.active, "--button-primary-fg": button.foreground };
}

export function skinCSSVariables(skin: SkinDefinition, mode: SkinThemeMode): Record<string, string> {
    const color = skin.tokens[mode];
    const component = skin.tokens.components;
    const shadows = skinShadowVariables(component.shadowStyle, mode);
    return {
        "--background": color.canvas,
        "--foreground": color.text,
        "--card": color.surface,
        "--card-foreground": color.text,
        "--popover": color.overlay,
        "--popover-foreground": color.text,
        "--primary": color.primary,
        "--primary-foreground": color.primaryForeground,
        "--secondary": color.surfaceSubtle,
        "--secondary-foreground": color.text,
        "--muted": color.surfaceSubtle,
        "--muted-foreground": color.textMuted,
        "--accent": color.selected,
        "--accent-foreground": color.selectedForeground,
        "--destructive": color.danger,
        "--destructive-hover": color.dangerHover,
        "--destructive-active": color.dangerActive,
        "--destructive-foreground": color.dangerForeground,
        "--border": color.border,
        "--input": color.controlBorder,
        "--ring": color.controlFocus,
        "--surface": color.surface,
        "--surface-hover": color.controlHover,
        "--surface-active": color.controlActive,
        "--surface-card": color.surfaceSubtle,
        "--surface-card-hover": color.controlHover,
        "--card-surface": color.surfaceSubtle,
        "--card-surface-hover": color.controlHover,
        "--card-surface-raised": color.surfaceRaised,
        "--btn-solid-bg": color.primary,
        "--btn-solid-hover-bg": color.primaryHover,
        "--btn-solid-active-bg": color.primaryActive,
        "--btn-solid-fg": color.primaryForeground,
        "--control-selected-bg": color.selected,
        "--control-selected-hover-bg": color.selectedHover,
        "--control-selected-fg": color.selectedForeground,
        "--control-selected-border": color.controlBorder,
        "--control-check-bg": color.primary,
        "--control-check-fg": color.primaryForeground,
        "--control-switch-checked-bg": color.switchChecked,
        "--control-switch-checked-hover-bg": color.switchCheckedHover,
        "--control-switch-checked-handle": color.switchCheckedHandle,
        "--control-switch-off-bg": color.switchUnchecked,
        "--control-switch-off-hover-bg": color.switchUncheckedHover,
        "--control-switch-off-handle": color.switchUncheckedHandle,
        "--control-disabled-bg": color.controlDisabledBackground,
        "--control-disabled-fg": color.controlDisabledForeground,
        "--control-focus-ring": color.controlFocus,
        "--workspace-surface": color.workspace,
        "--workspace-surface-strong": color.surfaceRaised,
        "--workspace-border": color.border,
        "--workspace-border-strong": color.controlBorder,
        "--workspace-grid-line": color.workspaceGrid,
        "--workspace-accent": color.primary,
        "--workspace-accent-soft": `color-mix(in srgb, ${color.primary} 12%, transparent)`,
        "--skin-admin-layer-0": color.adminBackground,
        "--skin-admin-layer-1": color.adminSurface,
        "--skin-admin-layer-2": color.adminSubtle,
        "--skin-admin-layer-3": color.adminStrong,
        "--auth-page-bg": color.authBackground,
        "--auth-panel-bg": color.authPanel,
        "--auth-card-bg": color.authCard,
        "--auth-accent": color.authAccent,
        "--auth-muted": color.authMuted,
        "--palette-status-success": color.success,
        "--palette-status-error": color.danger,
        "--palette-status-loading": color.info,
        "--palette-status-warning": color.warning,
        "--icon-foreground": color.icon,
        "--icon-muted": color.iconMuted,
        "--icon-active": color.iconActive,
        "--r-sm": `${component.inputRadius}px`,
        "--r-md": `${component.buttonRadius}px`,
        "--r-lg": `${component.cardRadius}px`,
        "--r-xl": `${component.overlayRadius}px`,
        "--r-2xl": `${component.overlayRadius}px`,
        "--radius": `${component.buttonRadius / 16}rem`,
        "--control-radius": `${component.inputRadius}px`,
        "--button-radius": `${component.buttonRadius}px`,
        "--input-radius": `${component.inputRadius}px`,
        "--card-radius": `${component.cardRadius}px`,
        "--overlay-radius": `${component.overlayRadius}px`,
        "--menu-radius": `${component.menuRadius}px`,
        "--checkbox-radius": `${component.checkboxRadius}px`,
        "--control-border-width": `${component.borderWidth}px`,
        "--focus-ring-width": `${component.focusRingWidth}px`,
        "--icon-size": `${component.iconSize}px`,
        "--theme-hover-lift": `${component.hoverLift}px`,
        "--motion-instant": `${component.motionFast}ms`,
        "--motion-state": `${component.motionNormal}ms`,
        ...shadows,
    };
}

function skinShadowVariables(style: SkinShadowStyle, mode: SkinThemeMode) {
    if (style === "none") return { "--elevation-card": "none", "--elevation-card-hover": "none", "--elevation-overlay": "none", "--theme-admin-card-shadow": "none" };
    // 每档阴影两层：贴边、清晰的小阴影交代边缘，大而淡的阴影交代悬浮高度。
    if (style === "strong") {
        return mode === "dark"
            ? { "--elevation-card": "0 1px 2px #00000080, 0 6px 16px #00000066", "--elevation-card-hover": "0 1px 3px #00000080, 0 18px 44px #0000008c", "--elevation-overlay": "0 2px 6px #00000080, 0 30px 90px #000000a6", "--theme-admin-card-shadow": "0 1px 2px #00000070, 0 6px 16px #00000052" }
            : { "--elevation-card": "0 1px 2px #0f172a1f, 0 6px 16px #0f172a1f", "--elevation-card-hover": "0 1px 3px #0f172a24, 0 18px 44px #0f172a33", "--elevation-overlay": "0 2px 6px #0f172a29, 0 30px 90px #0f172a42", "--theme-admin-card-shadow": "0 1px 2px #1118271f, 0 6px 16px #1118271a" };
    }
    return mode === "dark"
        ? { "--elevation-card": "0 1px 2px #00000052, 0 4px 12px #00000047", "--elevation-card-hover": "0 1px 3px #00000061, 0 12px 30px #00000066", "--elevation-overlay": "0 2px 6px #00000066, 0 26px 72px #00000085", "--theme-admin-card-shadow": "0 1px 2px #00000047, 0 4px 12px #0000003d" }
        : { "--elevation-card": "0 1px 2px #0f172a14, 0 4px 12px #0f172a0d", "--elevation-card-hover": "0 1px 3px #0f172a1a, 0 12px 30px #0f172a1f", "--elevation-overlay": "0 2px 6px #0f172a1a, 0 26px 72px #0f172a2b", "--theme-admin-card-shadow": "0 1px 2px #1118270f, 0 4px 12px #1118270a" };
}

function cloneSkinTokens(tokens: SkinTokens): SkinTokens {
    return { light: { ...tokens.light }, dark: { ...tokens.dark }, components: { ...tokens.components },
        buttons: { light: { ...tokens.buttons.light }, dark: { ...tokens.buttons.dark } } };
}

function isSkinMode(value: unknown): value is SkinModeTokens {
    if (!value || typeof value !== "object") return false;
    return SKIN_COLOR_GROUPS.flatMap((group) => group.fields).every((field) => HEX_COLOR.test(String((value as Record<string, unknown>)[field.key] || "")));
}

function normalizeSkinMode(value: unknown, fallback: SkinModeTokens): SkinModeTokens | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<SkinModeTokens>;
    const result: SkinModeTokens = {
        ...fallback,
        ...candidate,
        switchChecked: candidate.switchChecked || candidate.primary || fallback.switchChecked,
        switchCheckedHover: candidate.switchCheckedHover || candidate.primaryHover || fallback.switchCheckedHover,
        switchCheckedHandle: candidate.switchCheckedHandle || candidate.primaryForeground || fallback.switchCheckedHandle,
        switchUnchecked: candidate.switchUnchecked || candidate.controlBorder || fallback.switchUnchecked,
        switchUncheckedHover: candidate.switchUncheckedHover || candidate.controlActive || fallback.switchUncheckedHover,
        switchUncheckedHandle: candidate.switchUncheckedHandle || candidate.selectedForeground || fallback.switchUncheckedHandle,
        dangerHover: candidate.dangerHover || candidate.danger || fallback.dangerHover,
        dangerActive: candidate.dangerActive || candidate.danger || fallback.dangerActive,
        dangerForeground: candidate.dangerForeground || candidate.primaryForeground || fallback.dangerForeground,
    };
    return isSkinMode(result) ? result : null;
}

function isSkinComponents(value: unknown): value is SkinComponentTokens {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return SKIN_COMPONENT_NUMBER_FIELDS.every((field) => typeof candidate[field.key] === "number" && Number.isFinite(candidate[field.key])) && ["none", "soft", "strong"].includes(String(candidate.shadowStyle));
}
