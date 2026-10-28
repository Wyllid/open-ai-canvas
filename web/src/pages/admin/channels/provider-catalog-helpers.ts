import { tr } from "@/i18n";
import type { ProviderCatalogPriceTier, ProviderCatalogProvider } from "@/services/api/provider-catalog";

const selectorLabels: Record<string, (value: string) => string> = {
    operation: (value) => ({ text_to_video: tr("文生"), image_to_video: tr("图生"), text_to_image: tr("文生图"), image_to_image: tr("图生图") })[value] || value,
    vquality: (value) => value,
    videoSeconds: (value) => `${value}s`,
    quality: (value) => value.toUpperCase(),
    resolution: (value) => value.toUpperCase(),
    size: (value) => value,
    videoGenerateAudio: (value) => (value === "true" ? tr("含音频") : tr("无音频")),
};

export function tierSpecLabel(tier: ProviderCatalogPriceTier) {
    const parts = Object.entries(tier.selector || {})
        .filter(([, value]) => value && value !== "*")
        .map(([key, value]) => (selectorLabels[key] ? selectorLabels[key](value) : `${key}=${value}`));
    return parts.length ? parts.join(" · ") : tr("默认规格");
}

export function formatWindow(provider: Pick<ProviderCatalogProvider, "startsAt" | "endsAt" | "permanent">) {
    if (provider.permanent) return tr("长期推广 · 无到期日");
    const format = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
    return tr("{0} 至 {1}", format(provider.startsAt), format(provider.endsAt));
}

export function promotionExpiry(provider: Pick<ProviderCatalogProvider, "endsAt" | "permanent">, now = Date.now()) {
    if (provider.permanent) return tr("持续展示");
    const end = new Date(provider.endsAt);
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(end);
    const days = Math.ceil((end.getTime() - now) / 86_400_000);
    return tr("{0} 到期 · {1}（北京时间）", date, days > 0 ? tr("剩余 {0} 天", days) : tr("已到期"));
}

export function matchesProvider(provider: ProviderCatalogProvider, keyword: string) {
    const query = keyword.trim().toLowerCase();
    if (!query) return true;
    const haystack = [provider.name, provider.summary, provider.baseUrl, provider.website, ...provider.models.flatMap((item) => [item.displayName, item.modelKey])].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
}
