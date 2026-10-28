import { tr } from "@/i18n";
import { ChoiceBrowser } from "./choice-browser";
import type { ModelProtocolDefinition, ProtocolCapability } from "@/lib/model-protocols";

export function ModelProtocolBrowser({
    capability,
    protocols,
    ...props
}: {
    capability?: ProtocolCapability;
    protocols: ModelProtocolDefinition[];
    value?: string;
    onChange?: (value: string) => void;
    loading?: boolean;
    error?: string;
    disabled?: boolean;
    id?: string;
}) {
    const options = protocols
        .filter((protocol) => (!capability || protocol.capability === capability) && protocol.enabled !== false)
        .map((protocol) => ({
            value: protocol.value,
            label: protocol.label,
            subtitle: protocol.create,
            vendor: protocol.vendor,
            searchText: protocol.value,
            details: [
                { label: tr("请求"), value: <code>{protocol.create}</code> },
                { label: tr("请求体"), value: protocol.contentType },
                { label: tr("响应"), value: protocol.poll ? tr("异步轮询") : tr("同步响应") },
                { label: tr("来源"), value: protocol.media },
                ...(protocol.imageParameters ? [{ label: tr("图片参数"), value: protocol.imageParameters.map((p) => p.label).join("、") }] : []),
            ],
        }));

    return <ChoiceBrowser key={capability || "all"} {...props} label={tr("调用协议")} placeholder={tr("搜索协议名称、厂商或请求路径")} options={options} />;
}
