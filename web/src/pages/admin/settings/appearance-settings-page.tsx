import { tr } from "@/i18n";
import { commitPublicAppearance, DEFAULT_PUBLIC_APPEARANCE } from "@/stores/use-appearance-store";
import { deleteAdminResources } from "@/services/api/admin-storage";
import { AdminStatusBadge, SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { Palette, RefreshCw, Undo2, RotateCcw, Save, Sun, Moon, Globe2, Search, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/pages/admin/ui/controls";
import { WelcomeSetting } from "@/pages/admin/settings/components/welcome-setting";
import { SkinThemeEditor } from "@/pages/admin/settings/components/skin-theme-editor";
import { CanvasAppearanceEditor } from "./components/canvas-appearance-editor";
import { DEFAULT_UPDATE_ANNOUNCEMENT, normalizeUpdateAnnouncement, validateUpdateAnnouncement, type UpdateAnnouncement } from "@/lib/update-announcement";
import { App, Button, Tabs, Form, Input } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { cloneSkinDefinition, DEFAULT_CLASSIC_SKIN, normalizeSkinDefinition, type SkinDefinition, duplicateSkinDefinition } from "@/lib/skin-themes";
import { DEFAULT_CANVAS_APPEARANCE, type CanvasAppearance } from "@/lib/canvas/agent-appearance";
import { getAdminAppearance, type AdminAppearance, type AppearanceAssetSlot, resetAdminAppearance, uploadAppearanceAsset, updateAdminAppearance } from "@/services/api/appearance";
import { normalizeDraftCopy, normalizeSingleLine, hasUnsupportedControlCharacter, validateSkinDrafts, useAppearancePreviews, AppearanceSkeleton, AssetPicker, LogoThemePreview } from "./appearance-settings-parts";
import { type DraftFiles, FILE_RULES, type ResetState } from "./appearance-settings-parts";

export { type DraftFiles, FILE_RULES, type ResetState } from "./appearance-settings-parts";

const EMPTY_FILES: DraftFiles = { logo: null, "logo-dark": null, video: null, poster: null };
const EMPTY_RESETS: ResetState = { logo: false, "logo-dark": false, video: false, poster: false };

export default function AppearanceSettingsPage() {
    const { message, modal } = App.useApp();
    const [activeTab, setActiveTab] = useState("brand");
    const [setting, setSetting] = useState<AdminAppearance | null>(null);
    const [brandName, setBrandName] = useState("");
    const [canvas, setCanvas] = useState<CanvasAppearance>(DEFAULT_CANVAS_APPEARANCE);
    const [updates, setUpdates] = useState<UpdateAnnouncement>(DEFAULT_UPDATE_ANNOUNCEMENT);
    const [canvasUploading, setCanvasUploading] = useState(false);
    const [brandSlug, setBrandSlug] = useState("");
    const [authHeroTitle, setAuthHeroTitle] = useState("");
    const [authHeroDescription, setAuthHeroDescription] = useState("");
    const [authVideoAutoplay, setAuthVideoAutoplay] = useState(true);
    const [logoFrameEnabled, setLogoFrameEnabled] = useState(true);
    const [skinId, setSkinId] = useState("classic");
    const [skinThemes, setSkinThemes] = useState<SkinDefinition[]>([DEFAULT_CLASSIC_SKIN]);
    const [seoTitle, setSeoTitle] = useState("");
    const [seoDescription, setSeoDescription] = useState("");
    const [seoKeywords, setSeoKeywords] = useState("");
    const [footerCopyright, setFooterCopyright] = useState("");
    const [icpFilingEnabled, setIcpFilingEnabled] = useState(false);
    const [icpFilingNumber, setIcpFilingNumber] = useState("");
    const [redeemPurchaseUrl, setRedeemPurchaseUrl] = useState("");
    const [files, setFiles] = useState<DraftFiles>(EMPTY_FILES);
    const [resets, setResets] = useState<ResetState>(EMPTY_RESETS);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [loadError, setLoadError] = useState("");
    const requestVersionRef = useRef(0);
    const inputRefs = {
        logo: useRef<HTMLInputElement>(null),
        "logo-dark": useRef<HTMLInputElement>(null),
        video: useRef<HTMLInputElement>(null),
        poster: useRef<HTMLInputElement>(null),
    };

    const dirty =
        Boolean(setting) &&
        (JSON.stringify(updates) !== JSON.stringify(normalizeUpdateAnnouncement(setting?.updates)) ||
            JSON.stringify(canvas) !== JSON.stringify(setting?.canvas || DEFAULT_CANVAS_APPEARANCE) ||
            canvasUploading ||
            brandName.trim() !== setting?.brandName ||
            brandSlug.trim().toLocaleLowerCase() !== setting?.brandSlug ||
            normalizeDraftCopy(authHeroTitle) !== setting?.authHeroTitle ||
            normalizeDraftCopy(authHeroDescription) !== setting?.authHeroDescription ||
            authVideoAutoplay !== setting?.authVideoAutoplay ||
            logoFrameEnabled !== setting?.logoFrameEnabled ||
            skinId !== setting?.skinId ||
            JSON.stringify(skinThemes) !== JSON.stringify(setting?.skinThemes) ||
            normalizeSingleLine(seoTitle) !== setting?.seoTitle ||
            normalizeDraftCopy(seoDescription) !== setting?.seoDescription ||
            normalizeSingleLine(seoKeywords) !== setting?.seoKeywords ||
            normalizeSingleLine(footerCopyright) !== setting?.footerCopyright ||
            icpFilingEnabled !== setting?.icpFilingEnabled ||
            normalizeSingleLine(icpFilingNumber) !== setting?.icpFilingNumber ||
            normalizeSingleLine(redeemPurchaseUrl) !== setting?.redeemPurchaseUrl ||
            Object.values(files).some(Boolean) ||
            Object.values(resets).some(Boolean));
    const blocker = useBlocker(dirty && !saving && !restoring);

    const applySetting = useCallback((value: AdminAppearance) => {
        const themes = value.skinThemes.length ? value.skinThemes.map((theme) => normalizeSkinDefinition(theme)) : [cloneSkinDefinition(DEFAULT_CLASSIC_SKIN)];
        const selectedID = themes.some((theme) => theme.id === value.skinId) ? value.skinId : "classic";
        setSetting({ ...value, skinThemes: themes, skinId: selectedID });
        setBrandName(value.brandName);
        setCanvas(value.canvas || DEFAULT_CANVAS_APPEARANCE);
        setUpdates(normalizeUpdateAnnouncement(value.updates));
        setBrandSlug(value.brandSlug);
        setAuthHeroTitle(value.authHeroTitle);
        setAuthHeroDescription(value.authHeroDescription);
        setAuthVideoAutoplay(value.authVideoAutoplay);
        setLogoFrameEnabled(value.logoFrameEnabled);
        setSkinThemes(themes);
        setSkinId(selectedID);
        setSeoTitle(value.seoTitle);
        setSeoDescription(value.seoDescription);
        setSeoKeywords(value.seoKeywords);
        setFooterCopyright(value.footerCopyright);
        setIcpFilingEnabled(value.icpFilingEnabled);
        setIcpFilingNumber(value.icpFilingNumber);
        setRedeemPurchaseUrl(value.redeemPurchaseUrl);
        setFiles(EMPTY_FILES);
        setResets(EMPTY_RESETS);
        setLoadError("");
    }, []);

    const load = useCallback(
        async (initial = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            try {
                const value = await getAdminAppearance();
                if (requestVersion === requestVersionRef.current) applySetting(value);
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const detail = error instanceof Error ? error.message : tr("读取外观配置失败");
                setLoadError(detail);
                if (!initial) message.error(detail);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [applySetting, message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (blocker.state !== "blocked") return;
        modal.confirm({
            title: tr("放弃站点及外观调整？"),
            content: tr("当前品牌、画布 Agent、更新公告、SEO、备案、皮肤或媒体配置尚未保存，离开后草稿会丢失。线上站点不会改变。"),
            okText: tr("放弃并离开"),
            cancelText: tr("继续编辑"),
            okButtonProps: { danger: true },
            onOk: () => blocker.proceed(),
            onCancel: () => blocker.reset(),
        });
    }, [blocker, modal]);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving || restoring) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, restoring, saving]);

    const selectFile = (slot: AppearanceAssetSlot, file?: File) => {
        if (!file) return;
        const rule = FILE_RULES[slot];
        if (!rule.accept.split(",").includes(file.type) || file.size <= 0 || file.size > rule.maxBytes) {
            message.error(tr("{0}须使用支持的格式，且不超过 {1}MB", rule.label, rule.maxBytes >> 20));
            if (inputRefs[slot].current) inputRefs[slot].current.value = "";
            return;
        }
        setFiles((current) => ({
            ...current,
            [slot]: file,
            ...(slot === "video" ? { poster: null } : {}),
        }));
        setResets((current) => ({
            ...current,
            [slot]: false,
            ...(slot === "video" ? { poster: true } : {}),
        }));
        if (slot === "video" && inputRefs.poster.current) inputRefs.poster.current.value = "";
    };

    const resetAsset = (slot: AppearanceAssetSlot) => {
        setFiles((current) => ({
            ...current,
            [slot]: null,
            ...(slot === "video" ? { poster: null } : {}),
        }));
        setResets((current) => ({
            ...current,
            [slot]: true,
            ...(slot === "video" ? { poster: true } : {}),
        }));
        if (inputRefs[slot].current) inputRefs[slot].current.value = "";
        if (slot === "video" && inputRefs.poster.current) inputRefs.poster.current.value = "";
    };

    const discardDraft = () => {
        if (!setting || saving || restoring || canvasUploading) return;
        setCanvas(setting.canvas || DEFAULT_CANVAS_APPEARANCE);
        setUpdates(normalizeUpdateAnnouncement(setting.updates));
        setBrandName(setting.brandName);
        setBrandSlug(setting.brandSlug);
        setAuthHeroTitle(setting.authHeroTitle);
        setAuthHeroDescription(setting.authHeroDescription);
        setAuthVideoAutoplay(setting.authVideoAutoplay);
        setLogoFrameEnabled(setting.logoFrameEnabled);
        setSkinId(setting.skinId);
        setSkinThemes(setting.skinThemes.map((theme) => cloneSkinDefinition(theme)));
        setSeoTitle(setting.seoTitle);
        setSeoDescription(setting.seoDescription);
        setSeoKeywords(setting.seoKeywords);
        setFooterCopyright(setting.footerCopyright);
        setIcpFilingEnabled(setting.icpFilingEnabled);
        setIcpFilingNumber(setting.icpFilingNumber);
        setRedeemPurchaseUrl(setting.redeemPurchaseUrl);
        setFiles(EMPTY_FILES);
        setResets(EMPTY_RESETS);
        Object.values(inputRefs).forEach((ref) => {
            if (ref.current) ref.current.value = "";
        });
        message.info(tr("已撤销未保存的外观调整"));
    };

    const requestRefresh = () => {
        if (canvasUploading) return;
        if (!dirty) {
            void load(false);
            return;
        }
        modal.confirm({
            title: tr("放弃调整并重新读取？"),
            content: tr("重新读取会丢弃当前品牌、画布 Agent、更新公告、SEO、备案、皮肤和待上传文件。"),
            okText: tr("放弃并刷新"),
            cancelText: tr("继续编辑"),
            okButtonProps: { danger: true },
            onOk: () => load(false),
        });
    };

    const restoreBuiltInAppearance = () => {
        if (!setting?.configured || saving || refreshing || restoring || canvasUploading) return;
        modal.confirm({
            title: tr("恢复默认品牌标识？"),
            content: tr("品牌名称、英文标识、Logo、画布 Agent 名称/文案/形象、更新公告、登录页文案、视频、封面、SEO、备案和皮肤主题会立即恢复为项目内置值；自定义公告会清空并关闭，展示原有更新日志。已上传文件仍保留在存储资源中，不会被删除。"),
            okText: tr("恢复默认"),
            cancelText: tr("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                setRestoring(true);
                requestVersionRef.current += 1;
                try {
                    const restored = await resetAdminAppearance();
                    applySetting(restored);
                    commitPublicAppearance(restored.public);
                    Object.values(inputRefs).forEach((ref) => {
                        if (ref.current) ref.current.value = "";
                    });
                    message.success(tr("已恢复默认品牌标识"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : tr("恢复默认外观失败"));
                    throw error;
                } finally {
                    setRestoring(false);
                }
            },
        });
    };

    const save = async () => {
        if (!setting || saving || restoring || canvasUploading) return;
        const updatesError = validateUpdateAnnouncement(updates);
        if (updatesError) {
            setActiveTab("updates");
            message.error(updatesError);
            return;
        }
        if (![canvas.agentName, canvas.panelTitle, canvas.welcomeTitle, canvas.inputPlaceholder].every((text) => text.trim())) {
            setActiveTab("canvas");
            message.error(tr("请填写助手名称、面板标题、欢迎标题和输入框提示"));
            return;
        }
        const nextBrandName = brandName.trim();
        const nextBrandSlug = brandSlug.trim().toLocaleLowerCase();
        const nextAuthHeroTitle = normalizeDraftCopy(authHeroTitle);
        const nextAuthHeroDescription = normalizeDraftCopy(authHeroDescription);
        const nextSeoTitle = normalizeSingleLine(seoTitle);
        const nextSeoDescription = normalizeDraftCopy(seoDescription);
        const nextSeoKeywords = normalizeSingleLine(seoKeywords);
        const nextFooterCopyright = normalizeSingleLine(footerCopyright);
        const nextIcpFilingNumber = normalizeSingleLine(icpFilingNumber);
        const nextRedeemPurchaseUrl = normalizeSingleLine(redeemPurchaseUrl);
        if (!nextBrandName || Array.from(nextBrandName).length > 40) {
            setActiveTab("brand");
            message.error(tr("品牌名称必须为 1 到 40 个字符"));
            return;
        }
        if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(nextBrandSlug)) {
            setActiveTab("brand");
            message.error(tr("英文品牌标识须为 1 到 48 位小写字母、数字或连字符"));
            return;
        }
        for (const [value, label, max, tab] of [
            [nextSeoTitle, tr("SEO 标题"), 70, "seo"],
            [nextSeoDescription, tr("SEO 描述"), 200, "seo"],
            [nextSeoKeywords, tr("SEO 关键词"), 300, "seo"],
        ] as const) {
            if (Array.from(value).length > max || hasUnsupportedControlCharacter(value)) {
                setActiveTab(tab);
                message.error(tr("{0}不能超过 {1} 个字符，且不能包含控制字符", label, max));
                return;
            }
        }
        const skinError = validateSkinDrafts(skinThemes, skinId);
        if (skinError) {
            setActiveTab("skins");
            message.error(skinError);
            return;
        }
        setSaving(true);
        const uploadedIDs: string[] = [];
        try {
            const ids: Record<AppearanceAssetSlot, string> = {
                logo: resets.logo ? "" : setting.logoResourceId,
                "logo-dark": resets["logo-dark"] ? "" : setting.darkLogoResourceId,
                video: resets.video ? "" : setting.authVideoResourceId,
                poster: resets.poster ? "" : setting.authVideoPosterResourceId,
            };
            for (const slot of ["logo", "logo-dark", "video", "poster"] as AppearanceAssetSlot[]) {
                const file = files[slot];
                if (!file) continue;
                const resource = await uploadAppearanceAsset(slot, file);
                uploadedIDs.push(resource.id);
                ids[slot] = resource.id;
            }
            const updated = await updateAdminAppearance({
                canvas,
                updates,
                brandName: nextBrandName,
                brandSlug: nextBrandSlug,
                authHeroTitle: nextAuthHeroTitle,
                authHeroDescription: nextAuthHeroDescription,
                logoResourceId: ids.logo,
                darkLogoResourceId: ids["logo-dark"],
                logoFrameEnabled,
                authVideoResourceId: ids.video,
                authVideoPosterResourceId: ids.poster,
                authVideoAutoplay,
                skinId,
                skinThemes,
                seoTitle: nextSeoTitle,
                seoDescription: nextSeoDescription,
                seoKeywords: nextSeoKeywords,
                footerCopyright: nextFooterCopyright,
                icpFilingEnabled,
                icpFilingNumber: nextIcpFilingNumber,
                redeemPurchaseUrl: nextRedeemPurchaseUrl,
            });
            applySetting(updated);
            commitPublicAppearance(updated.public);
            Object.values(inputRefs).forEach((ref) => {
                if (ref.current) ref.current.value = "";
            });
            message.success(tr("站点及外观配置已保存并立即生效"));
        } catch (error) {
            const detail = error instanceof Error ? error.message : tr("保存外观配置失败");
            if (uploadedIDs.length) {
                try {
                    await deleteAdminResources(uploadedIDs);
                } catch {
                    message.warning(tr("保存失败，且临时上传文件未能自动清理；可在存储资源中检查"));
                }
            }
            message.error(detail);
        } finally {
            setSaving(false);
        }
    };

    const previews = useAppearancePreviews(setting, files, resets);
    const lightLogoSelected = Boolean(files.logo || (!resets.logo && setting?.logoResourceId));
    const darkLogoSelected = Boolean(files["logo-dark"] || (!resets["logo-dark"] && setting?.darkLogoResourceId));
    const status = setting?.configured ? <AdminStatusBadge label={tr("已自定义")} tone="success" /> : <AdminStatusBadge label={tr("使用原始外观")} tone="neutral" />;
    const copyCustomized = normalizeDraftCopy(authHeroTitle) !== DEFAULT_PUBLIC_APPEARANCE.authHeroTitle || normalizeDraftCopy(authHeroDescription) !== DEFAULT_PUBLIC_APPEARANCE.authHeroDescription;
    const draftBrandName = brandName.trim() || tr("站点名称");
    const selectedSkin = skinThemes.find((skin) => skin.id === skinId) || skinThemes[0] || DEFAULT_CLASSIC_SKIN;

    const changeSkin = (next: SkinDefinition) => {
        if (next.locked) return;
        setSkinThemes((current) => current.map((theme) => (theme.id === next.id ? next : theme)));
    };

    const duplicateSkin = (sourceID: string) => {
        if (skinThemes.length >= 16) return;
        const source = skinThemes.find((theme) => theme.id === sourceID) || DEFAULT_CLASSIC_SKIN;
        const copy = duplicateSkinDefinition(
            source,
            skinThemes.map((theme) => theme.id),
        );
        setSkinThemes((current) => [...current, copy]);
        setSkinId(copy.id);
    };

    const deleteSkin = (targetID: string) => {
        const target = skinThemes.find((theme) => theme.id === targetID);
        if (!target || target.locked) return;
        modal.confirm({
            title: tr("删除主题“{0}”？", target.name),
            content: tr("删除会随本页其他调整一起保存；保存前仍可点击“撤销调整”恢复。若它当前启用，将自动切回经典黑白。"),
            okText: tr("删除主题"),
            cancelText: tr("取消"),
            okButtonProps: { danger: true },
            onOk: () => {
                setSkinThemes((current) => current.filter((theme) => theme.id !== targetID));
                if (skinId === targetID) setSkinId("classic");
            },
        });
    };

    return (
        <AdminPageFrame title={tr("外观与品牌")} description={tr("统一管理品牌名称、Logo、欢迎页、搜索信息、界面皮肤与画布外观")} scroll>
            {loading ? (
                <AppearanceSkeleton />
            ) : loadError || !setting ? (
                <div className="admin-settings-stack admin-appearance-settings">
                    <div className="admin-appearance-load-error" role="alert">
                        <span className="admin-appearance-load-error-icon">
                            <Palette className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>{tr("无法读取外观配置")}</h2>
                            <p>{loadError || tr("当前没有可显示的配置，请稍后重试。")}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load(true)}>
                            {tr("重新读取")}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="admin-settings-stack admin-appearance-settings">
                    <div className={cn("admin-appearance-command-bar", dirty && "is-dirty")}>
                        <div className="admin-appearance-command-copy" aria-live="polite">
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong>{dirty ? tr("站点配置有调整待保存") : tr("站点及外观已与服务端同步")}</strong>
                                    <AdminStatusBadge label={dirty ? tr("尚未生效") : tr("服务端当前值")} tone={dirty ? "warning" : "neutral"} />
                                </div>
                                <p>{dirty ? tr("切换分类保留草稿；保存修改会一次应用品牌、登录页、更新公告、SEO、备案和皮肤调整。") : tr("按分类管理站点配置；欢迎页开关独立即时保存，其余修改统一保存。")}</p>
                            </div>
                        </div>
                        <div className="admin-appearance-command-actions">
                            {dirty ? (
                                <Button icon={<Undo2 className="size-4" />} disabled={saving || restoring || canvasUploading} onClick={discardDraft}>
                                    {tr("撤销调整")}
                                </Button>
                            ) : null}
                            <Button icon={<RotateCcw className="size-4" />} loading={restoring} disabled={!setting.configured || saving || refreshing || canvasUploading} onClick={restoreBuiltInAppearance}>
                                {tr("恢复默认品牌")}
                            </Button>
                            <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving || restoring || canvasUploading} onClick={requestRefresh}>
                                {tr("刷新状态")}
                            </Button>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || refreshing || restoring || canvasUploading} onClick={() => void save()}>
                                {tr("保存修改")}
                            </Button>
                        </div>
                    </div>

                    <Tabs
                        className="admin-appearance-tabs"
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        items={[
                            {
                                key: "brand",
                                label: tr("品牌识别"),
                                children: (
                                    <SettingsSectionCard
                                        className="admin-appearance-section admin-appearance-brand-section"
                                        icon={<Palette className="size-4" aria-hidden="true" />}
                                        title={tr("品牌识别")}
                                        description={tr("中文品牌名用于主要界面，英文品牌标识用于英文角标和可安全品牌化的路径建议；不会改动代码包、数据库或部署标识。")}
                                        status={status}
                                    >
                                        <div className="admin-appearance-brand-layout">
                                            <Form className="admin-appearance-form" layout="vertical" requiredMark={false} disabled={saving || refreshing || restoring}>
                                                <Form.Item label={tr("品牌名称")} extra={tr("1–40 个字符。保存后同步到登录页、工作台、管理后台与浏览器标题。")}>
                                                    <Input value={brandName} maxLength={40} showCount placeholder={tr("输入品牌名称")} onChange={(event) => setBrandName(event.target.value)} />
                                                </Form.Item>
                                                <Form.Item label={tr("英文品牌标识")} extra={tr("1–48 位小写字母、数字或连字符，例如 hima-studio。对象存储可一键采用该值作为路径前缀。")}>
                                                    <Input
                                                        value={brandSlug}
                                                        maxLength={48}
                                                        showCount
                                                        autoCapitalize="none"
                                                        autoCorrect="off"
                                                        spellCheck={false}
                                                        placeholder={tr("例如：hima-studio")}
                                                        onChange={(event) => setBrandSlug(event.target.value.toLocaleLowerCase().replace(/[^a-z0-9-]/g, ""))}
                                                    />
                                                </Form.Item>
                                            </Form>
                                            <div className="admin-appearance-brand-logo admin-appearance-logo-stack">
                                                <AssetPicker
                                                    slot="logo"
                                                    title={tr("浅色模式 Logo")}
                                                    description={tr("用于浅色界面；建议透明背景 PNG 或 WebP。")}
                                                    configured={Boolean(setting.logoResourceId) && !resets.logo}
                                                    file={files.logo}
                                                    inputRef={inputRefs.logo}
                                                    onSelect={selectFile}
                                                    onReset={resetAsset}
                                                    disabled={saving || refreshing || restoring}
                                                    emptyLabel={darkLogoSelected ? tr("将自动复用深色模式 Logo") : tr("未上传时使用项目原始 Logo")}
                                                />
                                                <AssetPicker
                                                    slot="logo-dark"
                                                    title={tr("深色模式 Logo（可选）")}
                                                    description={tr("用于深色界面；不上传时自动复用浅色模式 Logo。")}
                                                    configured={Boolean(setting.darkLogoResourceId) && !resets["logo-dark"]}
                                                    file={files["logo-dark"]}
                                                    inputRef={inputRefs["logo-dark"]}
                                                    onSelect={selectFile}
                                                    onReset={resetAsset}
                                                    disabled={saving || refreshing || restoring}
                                                    emptyLabel={lightLogoSelected ? tr("将自动复用浅色模式 Logo") : tr("未上传时使用项目原始 Logo")}
                                                />
                                                <div className="admin-appearance-logo-frame-option">
                                                    <div className="admin-appearance-logo-frame-copy">
                                                        <strong>{tr("禁用 Logo 后面的圆角矩形外框")}</strong>
                                                        <p id="appearance-logo-frame-help">{tr("开启后，工作台和管理后台导航只显示 Logo 本身；Logo 会等比放大到原外框的可用区域，导航占位保持不变。")}</p>
                                                    </div>
                                                    <div className="admin-appearance-logo-frame-control">
                                                        <span>{logoFrameEnabled ? tr("保留外框") : tr("已禁用外框")}</span>
                                                        <Switch
                                                            checked={!logoFrameEnabled}
                                                            disabled={saving || refreshing || restoring}
                                                            aria-label={tr("禁用 Logo 后面的圆角矩形外框")}
                                                            aria-describedby="appearance-logo-frame-help"
                                                            onChange={(checked) => setLogoFrameEnabled(!checked)}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="admin-appearance-logo-preview-grid" aria-label={tr("深浅模式 Logo 预览")}>
                                                    <LogoThemePreview label={tr("浅色界面")} icon={<Sun />} src={previews.logoLight} dark={false} frameEnabled={logoFrameEnabled} />
                                                    <LogoThemePreview label={tr("深色界面")} icon={<Moon />} src={previews.logoDark} dark frameEnabled={logoFrameEnabled} />
                                                </div>
                                            </div>
                                        </div>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "welcome",
                                label: tr("欢迎页"),
                                children: (
                                    <SettingsSectionCard className="admin-appearance-section" icon={<Globe2 className="size-4" aria-hidden="true" />} title={tr("欢迎页")} description={tr("控制访客是否可以访问欢迎页，开关修改后立即保存。")}>
                                        <div className="admin-appearance-section-form">
                                            <WelcomeSetting />
                                        </div>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "seo",
                                label: tr("SEO 信息"),
                                children: (
                                    <SettingsSectionCard
                                        className="admin-appearance-section"
                                        icon={<Search className="size-4" aria-hidden="true" />}
                                        title={tr("SEO 信息")}
                                        description={tr("配置浏览器标题、搜索摘要和关键词；留空时标题与描述会自动跟随当前站点名称。")}
                                        status={<AdminStatusBadge label={seoTitle || seoDescription || seoKeywords ? tr("已自定义") : tr("自动跟随品牌")} tone={seoTitle || seoDescription || seoKeywords ? "success" : "neutral"} />}
                                    >
                                        <Form className="admin-appearance-form admin-appearance-section-form" layout="vertical" requiredMark={false} disabled={saving || refreshing || restoring}>
                                            <div className="admin-appearance-form-grid">
                                                <Form.Item label={tr("SEO 标题")} extra={tr("建议简洁描述站点用途；留空时使用站点名称。")}>
                                                    <Input value={seoTitle} maxLength={70} showCount placeholder={draftBrandName} onChange={(event) => setSeoTitle(event.target.value)} />
                                                </Form.Item>
                                                <Form.Item label={tr("SEO 关键词")} extra={tr("以逗号分隔；Google 不使用该标签排名，仍可供其他工具读取。")}>
                                                    <Input value={seoKeywords} maxLength={300} showCount placeholder={tr("AI 影视, AI 短剧, 创作工作台")} onChange={(event) => setSeoKeywords(event.target.value)} />
                                                </Form.Item>
                                            </div>
                                            <Form.Item label={tr("SEO 描述")} extra={tr("建议用一到两句话准确概括站点，避免重复堆砌关键词；留空时自动生成品牌描述。")}>
                                                <Input.TextArea
                                                    value={seoDescription}
                                                    maxLength={200}
                                                    showCount
                                                    autoSize={{ minRows: 3, maxRows: 5 }}
                                                    placeholder={tr("{0}，面向 AI 影视与短剧创作的工作台。", draftBrandName)}
                                                    onChange={(event) => setSeoDescription(event.target.value)}
                                                />
                                            </Form.Item>
                                        </Form>
                                    </SettingsSectionCard>
                                ),
                            },
                            {
                                key: "skins",
                                label: tr("皮肤主题"),
                                children: (
                                    <SettingsSectionCard
                                        className="admin-appearance-section"
                                        icon={<Type className="size-4" aria-hidden="true" />}
                                        title={tr("皮肤主题")}
                                        description={tr("经典黑白采用黑白底色与紫蓝渐变主按钮；复制后可调整浅色、深色、按钮填充及控件参数，所有修改统一保存。")}
                                        status={<AdminStatusBadge label={selectedSkin.name} tone="info" />}
                                    >
                                        <SkinThemeEditor
                                            themes={skinThemes}
                                            selectedID={skinId}
                                            disabled={saving || refreshing || restoring}
                                            onSelect={setSkinId}
                                            onCreate={() => duplicateSkin("classic")}
                                            onDuplicate={duplicateSkin}
                                            onDelete={deleteSkin}
                                            onChange={changeSkin}
                                        />
                                    </SettingsSectionCard>
                                ),
                            },
                            { key: "canvas", label: tr("画布配置"), children: <CanvasAppearanceEditor value={canvas} onChange={setCanvas} disabled={saving || refreshing || restoring || canvasUploading} onUploading={setCanvasUploading} /> },
                        ]}
                    />
                </div>
            )}
        </AdminPageFrame>
    );
}
