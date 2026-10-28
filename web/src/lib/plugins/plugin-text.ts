import { tr, trMessage } from "@/i18n";

const PROTOCOL_PLUGIN = /^(.+?) 独立请求协议插件。$/;

/** Plugin manifests are written in Chinese; the common protocol-plugin sentence is shown in the interface language. */
export function pluginDescriptionText(description: string | undefined): string {
    const text = (description || "").trim();
    const protocol = PROTOCOL_PLUGIN.exec(text);
    return protocol ? tr("{0} 独立请求协议插件。", protocol[1]) : trMessage(text);
}
