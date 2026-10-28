import { currentLocale, tr } from "@/i18n";
import { App, Button, Checkbox, Input, Spin } from "antd";
import { ArrowLeft, Check, ExternalLink, Gift, RefreshCw, Search, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import {
    getProviderCatalog,
    installProviderCatalog,
    refreshProviderCatalog,
    verifyProviderCatalogKey,
    type ProviderCatalogModel,
    type ProviderCatalogProvider,
    type ProviderCatalogVerifyResult,
    type ProviderCatalogView,
} from "@/services/api/provider-catalog";
import type { ModelChannel } from "@/stores/use-config-store";
import { formatWindow, promotionExpiry, matchesProvider, tierSpecLabel } from "./provider-catalog-helpers";
import "./provider-catalog-wizard.css";

type Step = "pick" | "connect" | "pricing";

const capabilityLabels: Record<ProviderCatalogModel["capability"], string> = { text: tr("文本"), image: tr("图片"), video: tr("视频"), audio: tr("音频") };
const stepLabels: Array<{ key: Step; label: string }> = [
    { key: "pick", label: tr("选择服务商") },
    { key: "connect", label: tr("填写 Key") },
    { key: "pricing", label: tr("选择模型") },
];

type Props = {
    open: boolean;
    onClose: () => void;
    onCustom: () => void;
    onInstalled: (channel: ModelChannel) => void | Promise<void>;
};

export function ProviderCatalogWizard({ open, onClose, onCustom, onInstalled }: Props) {
    const { message } = App.useApp();
    const [step, setStep] = useState<Step>("pick");
    const [catalog, setCatalog] = useState<ProviderCatalogView | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [keyword, setKeyword] = useState("");
    const [tag, setTag] = useState("");
    const [provider, setProvider] = useState<ProviderCatalogProvider | null>(null);
    const [name, setName] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState("");
    const [verified, setVerified] = useState<ProviderCatalogVerifyResult | null>(null);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [installing, setInstalling] = useState(false);

    const load = async (refresh = false) => {
        setLoading(true);
        setLoadError("");
        try {
            setCatalog(await (refresh ? refreshProviderCatalog() : getProviderCatalog()));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : tr("读取服务商目录失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setStep("pick");
        setProvider(null);
        setKeyword("");
        setTag("");
        void load();
    }, [open]);

    const visibleProviders = useMemo(() => (catalog?.providers || []).filter((item) => (!tag || item.tags.includes(tag)) && matchesProvider(item, keyword)), [catalog, tag, keyword]);
    const tagLookup = useMemo(() => new Map((catalog?.tags || []).map((item) => [item.id, item])), [catalog]);
    const usedTags = useMemo(() => (catalog?.tags || []).filter((item) => catalog?.providers.some((p) => p.tags.includes(item.id))), [catalog]);

    const choose = (next: ProviderCatalogProvider) => {
        setProvider(next);
        setName(next.name);
        setApiKey("");
        setVerified(null);
        setVerifyError("");
        setSelected(Object.fromEntries(next.models.map((item) => [item.modelKey, item.supported])));
        setStep("connect");
    };

    const keyHint = useMemo(() => {
        if (!provider?.keyGuide.keyPattern || !apiKey.trim()) return null;
        try {
            return new RegExp(provider.keyGuide.keyPattern).test(apiKey.trim());
        } catch {
            return null;
        }
    }, [provider, apiKey]);

    const verify = async (skip: boolean) => {
        if (!provider) return;
        if (!apiKey.trim()) {
            setVerifyError(tr("请填写 API Key"));
            return;
        }
        if (skip) {
            setVerified(null);
            setStep("pricing");
            return;
        }
        setVerifying(true);
        setVerifyError("");
        try {
            const result = await verifyProviderCatalogKey(provider.id, apiKey.trim());
            setVerified(result);
            setSelected((current) => Object.fromEntries(provider.models.map((item) => [item.modelKey, Boolean(current[item.modelKey]) && item.supported && !result.missingModels.includes(item.modelKey)])));
            setStep("pricing");
        } catch (error) {
            setVerifyError(error instanceof Error ? error.message : tr("验证失败，请检查 Key"));
        } finally {
            setVerifying(false);
        }
    };

    const chosenModels = provider ? provider.models.filter((item) => selected[item.modelKey]) : [];
    const canInstall = Boolean(provider && chosenModels.length && name.trim() && apiKey.trim());

    const install = async () => {
        if (!provider || !canInstall) return;
        setInstalling(true);
        try {
            const { channel } = await installProviderCatalog(provider.id, {
                name: name.trim(),
                apiKey: apiKey.trim(),
                models: chosenModels.map((item) => ({ modelKey: item.modelKey })),
                // 跳过验证时先停用，避免未确认可用的渠道进入线上路由。
                enabled: verified !== null,
            });
            message.success(tr("已接入 {0}，{1} 个模型{2}", provider.name, chosenModels.length, verified ? tr("已上线") : tr("已创建（渠道默认停用）")));
            await onInstalled(channel);
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("一键接入失败"));
        } finally {
            setInstalling(false);
        }
    };

    const stepIndex = stepLabels.findIndex((item) => item.key === step);

    return (
        <AppModal flush open={open} width={1080} onCancel={() => !installing && onClose()} footer={null} title={null} rootClassName="admin-modal-root pcw-root" mask={{ closable: !installing }}>
            <div className="pcw">
                <header className="pcw-header">
                    <div className="pcw-title-row">
                        {step !== "pick" ? <Button type="text" size="small" aria-label={tr("上一步")} icon={<ArrowLeft className="size-4" />} disabled={installing || verifying} onClick={() => setStep(step === "pricing" ? "connect" : "pick")} /> : null}
                        <h2 className="pcw-title">{tr("新增系统渠道")}</h2>
                    </div>
                    <ol className="pcw-steps" aria-label={tr("接入步骤")}>
                        {stepLabels.map((item, index) => (
                            <li key={item.key} className="pcw-step" data-state={index < stepIndex ? "done" : index === stepIndex ? "current" : "todo"} aria-current={index === stepIndex ? "step" : undefined}>
                                <span className="pcw-step-dot">{index < stepIndex ? <Check className="size-3" /> : index + 1}</span>
                                {item.label}
                            </li>
                        ))}
                    </ol>
                </header>
                {step === "pick" ? renderPick() : null}
                {step === "connect" && provider ? renderConnect(provider) : null}
                {step === "pricing" && provider ? renderPricing(provider) : null}
            </div>
        </AppModal>
    );

    function renderPick() {
        const sourceText = catalog?.source === "cache" ? tr("离线目录") : catalog?.source === "unavailable" ? tr("目录暂不可用") : catalog?.source === "disabled" ? tr("目录已关闭") : tr("目录");
        return (
            <div className="pcw-body">
                <div className="pcw-toolbar">
                    <Input
                        size="large"
                        allowClear
                        autoFocus
                        prefix={<Search className="size-4 text-foreground/40" />}
                        placeholder={tr("搜索服务商、模型或网址，例如 seedance、sora、kimi")}
                        aria-label={tr("搜索服务商")}
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                    />
                    <span className="pcw-source" title={catalog?.fetchedAt ? tr("同步于 {0}", new Date(catalog.fetchedAt).toLocaleString(currentLocale())) : undefined}>
                        {sourceText}
                        {catalog?.updatedAt ? tr(" · 更新于 {0}", catalog.updatedAt.slice(5, 10)) : ""}
                        <Button type="text" size="small" aria-label={tr("刷新目录")} icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={() => void load(true)} />
                    </span>
                </div>
                {usedTags.length ? (
                    <div className="pcw-tags" role="group" aria-label={tr("按标签筛选")}>
                        <button type="button" className="pcw-tag-filter" aria-pressed={!tag} onClick={() => setTag("")}>
                            {tr("全部")} <span>{catalog?.providers.length || 0}</span>
                        </button>
                        {usedTags.map((item) => (
                            <button type="button" key={item.id} className="pcw-tag-filter" aria-pressed={tag === item.id} onClick={() => setTag(tag === item.id ? "" : item.id)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="pcw-scroll">
                    {loadError ? (
                        <p className="pcw-notice" role="alert">
                            <TriangleAlert className="size-4" /> {loadError}
                        </p>
                    ) : null}
                    {catalog && (catalog.source === "unavailable" || catalog.source === "disabled") ? <p className="pcw-notice">{catalog.notice || tr("暂时无法获取推荐服务商，可以先用自定义配置手动添加。")}</p> : null}
                    <div className="pcw-grid">
                        <button type="button" className="pcw-card pcw-card-custom" onClick={onCustom}>
                            <span className="pcw-logo pcw-logo-custom">
                                <SlidersHorizontal className="size-5" />
                            </span>
                            <span className="pcw-card-main">
                                <span className="pcw-card-name">{tr("自定义配置")}</span>
                                <span className="pcw-card-summary">{tr("手动填写 Base URL 和 API Key")}</span>
                            </span>
                        </button>
                        {visibleProviders.map((item) => (
                            <button type="button" key={item.id} className="pcw-card" onClick={() => choose(item)}>
                                <span className="pcw-card-top">
                                    <ProviderLogo provider={item} />
                                    <span className="pcw-card-main">
                                        <span className="pcw-card-name">{item.name}</span>
                                        <span className="pcw-card-summary">{item.summary || hostOf(item.baseUrl)}</span>
                                    </span>
                                </span>
                                <span className="pcw-card-tags">
                                    {item.tags.map((id) => (
                                        <span key={id} className="pcw-chip" data-tone={tagLookup.get(id)?.tone || "neutral"}>
                                            {tagLookup.get(id)?.label || id}
                                        </span>
                                    ))}
                                </span>
                                <span className="pcw-card-meta">
                                    <span>{tr("{0} 个推荐模型", item.models.length)}</span>
                                    {item.installedCount ? (
                                        <span className="pcw-installed">
                                            <Check className="size-3" /> {tr("已接入")} {item.installedCount}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="pcw-card-summary" title={item.models.map((model) => model.providerModelKey).join("、")}>
                                    {tr("推荐：")}
                                    {item.models.map((model) => (model.displayName === model.providerModelKey ? model.displayName : `${model.displayName} / ${model.providerModelKey}`)).join("、")}
                                </span>
                                <span className="pcw-card-window">
                                    <span>{item.permanent ? formatWindow(item) : tr("推广期 · {0}", formatWindow(item))}</span>
                                    <span className="block mt-1">{promotionExpiry(item)}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                    {loading && !catalog ? (
                        <div className="pcw-loading" role="status" aria-label={tr("正在加载服务商目录")}>
                            <Spin />
                        </div>
                    ) : null}
                    {catalog && catalog.providers.length > 0 && !visibleProviders.length ? <p className="pcw-notice">{tr("没有匹配的服务商，换个关键词试试。")}</p> : null}
                </div>
            </div>
        );
    }

    function renderConnect(current: ProviderCatalogProvider) {
        const guide = current.keyGuide;
        return (
            <div className="pcw-body pcw-split">
                <section className="pcw-form" aria-label={tr("连接 {0}", current.name)}>
                    <div className="pcw-provider-head">
                        <ProviderLogo provider={current} />
                        <div className="min-w-0">
                            <div className="pcw-card-name">{current.name}</div>
                            <div className="pcw-card-window">{current.permanent ? formatWindow(current) : tr("推广期 · {0}", formatWindow(current))}</div>
                        </div>
                    </div>
                    <label className="pcw-field">
                        <span>{tr("渠道名称")}</span>
                        <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <label className="pcw-field">
                        <span>API Key</span>
                        <Input.Password
                            autoFocus
                            autoComplete="new-password"
                            value={apiKey}
                            placeholder={tr("粘贴从服务商控制台复制的密钥")}
                            onChange={(event) => {
                                setApiKey(event.target.value);
                                setVerifyError("");
                            }}
                            onPressEnter={() => void verify(false)}
                        />
                        {keyHint === true ? (
                            <em className="pcw-hint" data-tone="success">
                                {tr("格式正确")}
                            </em>
                        ) : null}
                        {keyHint === false ? (
                            <em className="pcw-hint" data-tone="warning">
                                {tr("格式与该服务商常见密钥不同，请确认是否复制完整")}
                            </em>
                        ) : null}
                    </label>
                    <div className="pcw-readonly">
                        <span>Base URL</span>
                        <code>{current.baseUrl}</code>
                    </div>
                    {verifyError ? (
                        <div className="pcw-notice pcw-notice-error" role="alert">
                            <TriangleAlert className="size-4" />
                            <span>{verifyError}</span>
                        </div>
                    ) : null}
                    <div className="pcw-actions">
                        {verifyError ? (
                            <Button disabled={verifying || !apiKey.trim()} onClick={() => void verify(true)}>
                                {tr("跳过验证继续")}
                            </Button>
                        ) : null}
                        <Button type="primary" loading={verifying} disabled={!apiKey.trim() || !name.trim()} onClick={() => void verify(false)}>
                            {tr("验证并继续")}
                        </Button>
                    </div>
                    {verifyError ? <p className="pcw-footnote">{tr("跳过验证创建的渠道默认停用，确认可用后再手动启用。")}</p> : null}
                </section>
                <aside className="pcw-guide" aria-label={tr("获取 API Key")}>
                    <h3>{tr("获取 API Key")}</h3>
                    {guide.steps.length ? (
                        <ol>
                            {guide.steps.map((stepText, index) => (
                                <li key={index}>
                                    <span>{index + 1}</span>
                                    {stepText}
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className="pcw-footnote">{tr("在服务商控制台创建 API Key 后粘贴到左侧。")}</p>
                    )}
                    {guide.promo ? (
                        <p className="pcw-promo">
                            <Gift className="size-4" /> {guide.promo}
                        </p>
                    ) : null}
                    {guide.url || current.website ? (
                        <Button block href={guide.url || current.website} target="_blank" rel="noopener noreferrer" icon={<ExternalLink className="size-4" />}>
                            {tr("前往 {0} 获取 Key", current.name)}
                        </Button>
                    ) : null}
                </aside>
            </div>
        );
    }

    function renderPricing(current: ProviderCatalogProvider) {
        const totalTiers = chosenModels.reduce((sum, item) => sum + item.priceTiers.length, 0);
        return (
            <div className="pcw-body">
                <div className="pcw-pricing-bar">
                    {verified ? (
                        <span className="pcw-verified">
                            <Check className="size-3.5" /> {tr("连接成功 · 上游可用")} {verified.availableModels.length}/{tr("{0} 个推荐模型", current.models.length)}
                        </span>
                    ) : (
                        <span className="pcw-unverified">{tr("未验证 · 渠道将默认停用")}</span>
                    )}
                </div>
                <div className="pcw-scroll">
                    <ul className="pcw-models">
                        {current.models.map((item) => {
                            const missing = verified?.missingModels.includes(item.modelKey);
                            const disabledReason = !item.supported ? item.unsupportedReason || tr("当前版本不支持") : missing ? tr("上游未返回该模型") : "";
                            const checked = Boolean(selected[item.modelKey]);
                            return (
                                <li key={item.modelKey} className="pcw-model" data-disabled={Boolean(disabledReason) || undefined} data-checked={checked || undefined}>
                                    <div className="pcw-model-head">
                                        <Checkbox checked={checked} disabled={Boolean(disabledReason) && !checked} onChange={(event) => setSelected((state) => ({ ...state, [item.modelKey]: event.target.checked }))}>
                                            <span className="pcw-model-name">{item.displayName}</span>
                                        </Checkbox>
                                        <span className="pcw-chip" data-tone="neutral">
                                            {capabilityLabels[item.capability]}
                                        </span>
                                        <code className="pcw-model-key">{item.providerModelKey}</code>
                                        <span className="flex-1" />
                                        {disabledReason ? <span className="pcw-model-reason">{disabledReason}</span> : null}
                                    </div>
                                    {item.description ? <p className="pcw-model-desc">{item.description}</p> : null}
                                    <table className="pcw-tiers">
                                        <thead>
                                            <tr>
                                                <th scope="col">{tr("规格")}</th>
                                                <th scope="col">{tr("上游模型 ID")}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {item.priceTiers.map((tier, tierIndex) => (
                                                <tr key={tierIndex}>
                                                    <td>{tierSpecLabel(tier)}</td>
                                                    <td>{tier.providerModelKey || item.providerModelKey}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </li>
                            );
                        })}
                    </ul>
                </div>
                <footer className="pcw-footer">
                    <span>{tr("将创建：1 个渠道 · {0} 个模型 · {1} 个规格档", chosenModels.length, totalTiers)}</span>
                    <div className="pcw-actions">
                        <Button disabled={installing} onClick={() => setStep("connect")}>
                            {tr("上一步")}
                        </Button>
                        <Button type="primary" loading={installing} disabled={!canInstall} onClick={() => void install()}>
                            {tr("一键接入")}
                        </Button>
                    </div>
                </footer>
            </div>
        );
    }
}

function hostOf(url: string) {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

function ProviderLogo({ provider }: { provider: Pick<ProviderCatalogProvider, "logo" | "name"> }) {
    const [failed, setFailed] = useState(false);
    if (!provider.logo || failed) {
        return (
            <span className="pcw-logo" aria-hidden="true">
                {provider.name.slice(0, 1).toUpperCase()}
            </span>
        );
    }
    return (
        <span className="pcw-logo" aria-hidden="true">
            <img src={provider.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        </span>
    );
}
