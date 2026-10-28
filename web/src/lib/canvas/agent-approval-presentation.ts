import { tr, trMessage } from "@/i18n";
import type { AgentApprovalPreview, AgentApprovalPreviewItem, AgentApprovalPreviewOperation } from "@/services/api/agent";

type RecordValue = Record<string, unknown>;

export type AgentApprovalPresentation = AgentApprovalPreview & { source: "server" | "fallback" };

function record(value: unknown): RecordValue | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function text(value: unknown, max = 240): string {
    if (typeof value !== "string") return "";
    const compact = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
    return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function approvalArguments(value: unknown): RecordValue | null {
    if (typeof value !== "string") return record(value);
    try {
        return record(JSON.parse(value));
    } catch {
        return null;
    }
}

function shortReference(value: unknown): string {
    const id = text(value, 80);
    if (!id) return tr("未知目标");
    return id.length <= 16 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function nodeTypeLabel(value: unknown): string {
    const type = text(value, 32).toLowerCase();
    return ({ text: tr("文本"), markdown: "Markdown", image: tr("图片"), video: tr("视频"), audio: tr("音频"), frame: tr("画框"), script: tr("脚本"), character: tr("角色卡") } as Record<string, string>)[type] || (type ? tr("节点") : "");
}

function fieldLabel(key: string, nodeType: string): string {
    if (key === "title") return tr("节点名称");
    if (key === "content") return ["image", "video", "audio"].includes(nodeType.toLowerCase()) ? tr("下一版提示词") : tr("正文");
    return key === "composerContent" ? tr("下一版提示词") : tr("已配置字段");
}

function operation(value: unknown): AgentApprovalPreviewOperation | null {
    return value === "add_node" || value === "update_node" || value === "connect_nodes" || value === "arrange_nodes" || value === "generate_media" || value === "create_storyboard" || value === "edit_storyboard" || value === "create_character" || value === "plan_step" ? value : null;
}

function normalizeServerPreview(value: unknown): AgentApprovalPresentation | null {
    const source = record(value);
    if (!source || !Array.isArray(source.items)) return null;
    const rawItems = source.items;
    const items: AgentApprovalPreviewItem[] = [];
    for (const raw of rawItems) {
        const item = record(raw);
        const op = operation(item?.operation);
        const summary = text(item?.summary);
        if (!item || !op || !summary) continue;
        items.push({
            operation: op,
            nodeId: text(item.nodeId, 120) || undefined,
            nodeTitle: text(item.nodeTitle, 120) || undefined,
            resultTitle: text(item.resultTitle, 120) || undefined,
            nodeType: text(item.nodeType, 32) || undefined,
            nodeTypeLabel: text(item.nodeTypeLabel, 48) || undefined,
            targetNodeId: text(item.targetNodeId, 120) || undefined,
            targetNodeTitle: text(item.targetNodeTitle, 120) || undefined,
            targetNodeType: text(item.targetNodeType, 32) || undefined,
            fields: Array.isArray(item.fields) ? item.fields.map((field) => text(field, 64)).filter(Boolean).slice(0, 12) : undefined,
            details: Array.isArray(item.details) ? item.details.map((detail) => text(detail, 180)).filter(Boolean).slice(0, 12) : undefined,
            summary,
        });
    }
    const title = text(source.title, 120);
    const description = text(source.description, 500);
    if (!title || !description || !items.length) return null;
    return localizeServerPreview({ kind: text(source.kind, 64) || "agent_approval", title, description, items, source: "server" });
}

function countParts(items: AgentApprovalPreviewItem[]) {
    const counts = items.reduce<Record<string, number>>((out, item) => {
        out[item.operation] = (out[item.operation] || 0) + 1;
        return out;
    }, {});
    return [counts.add_node ? tr("新增 {0} 个节点", counts.add_node) : "", counts.update_node ? tr("修改 {0} 个节点", counts.update_node) : "", counts.connect_nodes ? tr("建立 {0} 条引用连线", counts.connect_nodes) : ""].filter(Boolean);
}

/**
 * The server writes previews in English. Canvas edits and media requests are rebuilt from their structured
 * items in the interface language; other texts are translated when they match a catalog entry and otherwise kept.
 */
function localizeServerPreview(preview: AgentApprovalPresentation): AgentApprovalPresentation {
    const items = preview.items.map((item) => {
        const label = item.nodeType ? nodeTypeLabel(item.nodeType) : item.nodeTypeLabel ? trMessage(item.nodeTypeLabel) : "";
        const node = label || tr("节点");
        let summary = trMessage(item.summary);
        if (item.operation === "add_node" && item.nodeTitle) summary = tr("新增{0}《{1}》", node, item.nodeTitle);
        else if (item.operation === "update_node" && item.nodeTitle) summary = tr("修改{0}《{1}》", node, item.nodeTitle) + (item.resultTitle ? tr("，名称改为《{0}》", item.resultTitle) : "");
        else if (item.operation === "connect_nodes" && item.nodeTitle && item.targetNodeTitle) summary = tr("建立《{0}》→《{1}》的引用连线", item.nodeTitle, item.targetNodeTitle);
        return { ...item, nodeTypeLabel: label || item.nodeTypeLabel, fields: item.fields?.map(trMessage), details: item.details?.map(trMessage), summary };
    });
    const parts = countParts(items);
    if (preview.kind === "canvas_mutation" && parts.length && preview.title === "Confirm canvas changes") {
        return { ...preview, items, title: tr("确认画布修改"), description: tr("Agent 准备{0}。请确认目标节点和修改字段；批准后才会写入画布。", parts.join(tr("，"))) };
    }
    if (preview.kind === "canvas_mutation" && parts.length && preview.title === "Canvas changes written") {
        return { ...preview, items, title: tr("画布修改已写入"), description: tr("画布修改已写入：{0}。", parts.join(tr("，"))) };
    }
    const media = items.length === 1 && items[0].operation === "generate_media" && items[0].nodeType ? nodeTypeLabel(items[0].nodeType) : "";
    if (preview.kind === "media_generation" && media && preview.title.startsWith("Confirm ")) {
        const title = items[0].nodeTitle || tr("未命名{0}", media);
        return { ...preview, items: [{ ...items[0], summary: tr("生成{0}《{1}》", media, title) }], title: tr("确认生成{0}", media), description: tr("{0}草稿节点和引用连线已创建，尚未提交生成。确认规格后批准才会提交收费任务；拒绝则保留草稿，结果自动回写画布。", media) };
    }
    return { ...preview, items, title: trMessage(preview.title), description: trMessage(preview.description) };
}

function canvasFallback(args: RecordValue | null): AgentApprovalPresentation {
    const rawOps = Array.isArray(args?.ops) ? args.ops : [];
    const items: AgentApprovalPreviewItem[] = [];
    for (const raw of rawOps) {
        const op = record(raw);
        const kind = operation(op?.type);
        if (!op || !kind || kind === "generate_media") continue;
        const type = text(op.nodeType, 32).toLowerCase();
        const label = nodeTypeLabel(type);
        if (kind === "add_node") {
            const title = text(op.title, 120) || tr("未命名{0}", label || tr("节点"));
            items.push({ operation: kind, nodeTitle: title, nodeType: type || undefined, nodeTypeLabel: label || undefined, fields: [tr("节点名称"), label === "文本" || label === "Markdown" ? tr("正文") : tr("初始内容")], summary: tr("新增{0}《{1}》", label || tr("节点"), title) });
            continue;
        }
        if (kind === "update_node") {
            const patch = record(op.patch);
            const id = shortReference(op.id);
            const fields = patch ? Object.keys(patch).map((key) => fieldLabel(key, type)).filter(Boolean) : [];
            const resultTitle = text(patch?.title, 120);
            const target = tr("目标节点（引用 {0}）", id);
            items.push({ operation: kind, nodeTitle: target, nodeType: type || undefined, nodeTypeLabel: label || undefined, resultTitle: resultTitle || undefined, fields: fields.length ? [...new Set(fields)] : [tr("已配置字段")], summary: tr("修改{0}《{1}》的{2}{3}", label || tr("节点"), target, fields.length ? [...new Set(fields)].join("、") : tr("已配置字段"), resultTitle ? tr("，名称改为《{0}》", resultTitle) : "") });
            continue;
        }
        const from = shortReference(op.fromNodeId);
        const to = shortReference(op.toNodeId);
        items.push({ operation: kind, nodeTitle: tr("来源（引用 {0}）", from), targetNodeTitle: tr("目标（引用 {0}）", to), summary: tr("建立来源（引用 {0}）→目标（引用 {1}）的引用连线", from, to) });
    }
    const counts = items.reduce<Record<string, number>>((out, item) => { out[item.operation] = (out[item.operation] || 0) + 1; return out; }, {});
    const parts = [counts.add_node ? tr("新增 {0} 个节点", counts.add_node) : "", counts.update_node ? tr("修改 {0} 个节点", counts.update_node) : "", counts.connect_nodes ? tr("建立 {0} 条引用连线", counts.connect_nodes) : ""].filter(Boolean);
    return { source: "fallback", kind: "canvas_mutation", title: tr("确认画布修改"), description: parts.length ? tr("Agent 准备{0}。历史审批缺少画布快照，以下目标使用安全引用标识；无法确认具体目标时不会代替当前画布。", parts.join("，")) : tr("审批参数不完整，无法确认具体修改目标，请重新读取画布后再申请审批。"), items, };
}

function mediaFallback(args: RecordValue | null, payload: RecordValue | null): AgentApprovalPresentation {
    const mode = text(args?.mode, 32).toLowerCase();
    const type = mode === "video" ? tr("视频") : mode === "image" ? tr("图片") : mode === "audio" ? tr("音频") : tr("媒体");
    const references = Array.isArray(args?.referenceNodeIds) ? args.referenceNodeIds.filter((id) => typeof id === "string") : [];
    const title = text(args?.title, 120) || tr("未命名{0}", type);
    const details = [text(payload?.modelName) ? tr("模型：{0}", text(payload?.modelName)) : text(args?.channelModelKey) || text(args?.logicalModelId) ? tr("模型：{0}", text(args?.channelModelKey) || text(args?.logicalModelId)) : "", references.length ? tr("引用 {0} 个画布资产，并建立连线", references.length) : tr("不引用画布媒体资产"), typeof args?.durationSeconds === "number" && args.durationSeconds > 0 ? tr("时长：{0} 秒", args.durationSeconds) : "", text(args?.size) ? tr("画幅：{0}", text(args?.size, 40)) : "", text(args?.quality) ? tr("质量：{0}", text(args?.quality, 40)) : "", typeof args?.videoGenerateAudio === "boolean" ? tr("音频：{0}", args.videoGenerateAudio ? tr("开启") : tr("关闭")) : ""].filter(Boolean);
    return { source: "fallback", kind: "media_generation", title: tr("确认生成{0}", type), description: tr("{0}草稿节点和引用连线已创建，尚未提交生成。确认规格后批准才会提交收费任务；拒绝则保留草稿，结果自动回写画布。", type), items: [{ operation: "generate_media", nodeTitle: title, nodeType: mode || undefined, nodeTypeLabel: type, details, summary: tr("生成{0}《{1}》", type, title) }] };
}

export function agentApprovalPresentation(detail: unknown): AgentApprovalPresentation {
    const payload = record(detail);
    const serverPreview = normalizeServerPreview(payload?.preview);
    if (serverPreview) return serverPreview;
    const call = record(payload?.call);
    const fn = record(call?.function);
    const name = text(fn?.name) || text(payload?.toolName);
    const args = approvalArguments(fn?.arguments ?? payload?.arguments);
    if (name === "canvas_apply_ops") return canvasFallback(args);
    if (name === "generate_media") return mediaFallback(args, payload);
    return { source: "fallback", kind: "agent_approval", title: tr("确认执行操作"), description: tr("Agent 请求执行一项操作，但审批参数无法识别；请重新读取画布后再申请审批。"), items: [] };
}
