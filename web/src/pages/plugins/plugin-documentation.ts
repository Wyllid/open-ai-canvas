import { tr } from "@/i18n";
import type { PluginManifest, PluginManifestV2 } from "@/lib/plugins/plugin-types";

const permissionLabels: Record<string, string> = {
    "canvas.read": tr("读取画布"),
    "canvas.write": tr("修改画布"),
    "asset.read": tr("读取素材"),
    "asset.search": tr("搜索素材"),
    "asset.import": tr("导入素材"),
    "asset.upload": tr("上传素材"),
    "generation.run": tr("调用生成"),
    "ai.text": tr("调用已配置的文本/视觉理解模型"),
    "external.open": tr("打开外部详情"),
};

export function getPluginDocumentation(manifest: PluginManifest | PluginManifestV2) {
    if (manifest.documentation?.trim()) return manifest.documentation.trim();

    const capabilities = manifest.permissions.map((permission) => permissionLabels[permission] || permission);
    return [
        `# ${manifest.name}`,
        "",
        manifest.description || tr("该插件没有提供简介。"),
        "",
        tr("## 插件信息"),
        "",
        tr("- 作者：{0}", manifest.author || tr("未声明")),
        tr("- 版本：{0}", manifest.version),
        tr("- 能力：{0}", capabilities.join("、") || tr("未声明")),
        "",
        manifest.contributes.providers?.length
            ? tr("> 此插件没有提供接入文档。请联系插件作者补充 `documentation`，不要仅凭清单字段推测上游接口。")
            : tr("> 该插件当前没有单独的使用文档。"),
    ].join("\n");
}
