import { tr } from "@/i18n";
import { audioModelForConnection, audioReferenceCapacity, doubaoAudioInputError, isDoubaoAudioModel, maxModelInputCapacity, resolveCompatibleModel, type ModelInputSummary } from "@/lib/model-selection";
import { getNodeAcceptedInputKinds, getNodeGenerationMode, getNodeInputKind, getNodeMaxInputCount } from "@/lib/canvas/node-registry";
import { readNodeGenerationSpec, resolveGenerationSelection } from "@/lib/canvas/generation-contract";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type ConnectionCandidate = Pick<CanvasConnection, "fromNodeId" | "toNodeId">;
type CanvasConnectionPolicyOptions = {
    // 仅跳过参考素材数量上限，媒体类型不兼容仍然拒绝。
    ignoreCapacity?: boolean;
};

export function canvasConnectionError(config: AiConfig, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate: ConnectionCandidate, options: CanvasConnectionPolicyOptions = {}) {
    const target = nodes.find((node) => node.id === candidate.toNodeId);
    if (!target) return tr("找不到连线目标节点");
    if (target.type === CanvasNodeType.BatchTable && target.metadata?.locked) return tr("批量创作表已锁定");
    const acceptedInputKinds = getNodeAcceptedInputKinds(target.type);
    if (acceptedInputKinds.length) {
        const source = nodes.find((node) => node.id === candidate.fromNodeId);
        const sourceKind = source ? getNodeInputKind(source.type) : undefined;
        const isMediaConversion = target.type === CanvasNodeType.MediaConversion;
        const hasAcceptedSource = isMediaConversion
            ? source?.type === CanvasNodeType.Image || source?.type === CanvasNodeType.Video
            : Boolean(sourceKind && acceptedInputKinds.includes(sourceKind));
        if (!sourceKind || !hasAcceptedSource) {
            const labels = acceptedInputKinds.map(acceptedInputKindLabel).join(tr("或"));
            const targetLabel = isMediaConversion ? tr("转换") : target.type === CanvasNodeType.BatchTable ? tr("批量创作表") : labels;
            return tr("{0}节点只接受{1}输入", targetLabel, labels);
        }
        const maxInputCount = getNodeMaxInputCount(target.type);
        if (maxInputCount) {
            const inputCount = new Set(
                [...connections, { id: "candidate", ...candidate }]
                    .filter((connection) => connection.toNodeId === target.id)
                    .map((connection) => connection.fromNodeId),
            ).size;
            if (inputCount > maxInputCount) return tr("{0}节点最多连接 {1} 个输入", isMediaConversion ? tr("转换") : tr("当前"), maxInputCount);
        }
    }
    const mode = getNodeGenerationMode(target);
    if (!mode) return "";
    const input = connectionInputSummary(target.id, nodes, connections, candidate);
    const visualInputCount = input.imageCount + input.characterCount;

    if (mode === "image") {
        if (input.videoCount > 0) return tr("图片生成节点不能连接参考视频");
        if (input.audioCount > 0) return tr("图片生成节点不能连接参考音频");
        return options.ignoreCapacity ? "" : capacityError(config, mode, "image", visualInputCount, tr("参考图"));
    }
    if (mode === "video") {
        return options.ignoreCapacity ? "" : capacityError(config, mode, "image", visualInputCount, tr("参考图")) || capacityError(config, mode, "video", input.videoCount, tr("参考视频")) || capacityError(config, mode, "audio", input.audioCount, tr("参考音频"));
    }
    if (mode === "text" && input.audioCount > 0) return tr("文本生成节点不能连接参考音频");
    if (mode === "audio") {
        const model = routedAudioModel(config, target, input);
        if (isDoubaoAudioModel(config, model)) return doubaoAudioInputError(input);
        if (input.imageCount > 0 || input.videoCount > 0) return tr("音频生成节点不能连接参考图片或参考视频");
        if (input.characterCount > 1) return tr("角色配音一次只能连接一个角色卡");
        const maxAudios = audioReferenceCapacity(config, model);
        if (input.audioCount > maxAudios) {
            return maxAudios > 0 ? tr("音频生成节点最多连接 {0} 个参考音频", maxAudios) : tr("当前音频模型不支持参考音频");
        }
    }
    return "";
}

function routedAudioModel(config: AiConfig, target: CanvasNodeData, input: ModelInputSummary) {
    const generationSpec = readNodeGenerationSpec(target);
    const selectedModel = generationSpec?.mode === "audio" ? resolveGenerationSelection(config, generationSpec.modelSelection) : "";
    const explicit = audioModelForConnection(config, selectedModel || target.metadata?.model || "");
    // 同名模型组会在生成时改选到能接受当前参考的成员。连线必须按这个结果判断，
    // 不能拿组里一个不支持图片的模型把豆包音频挡掉。
    return resolveCompatibleModel(config, explicit, { capability: "audio", input }) || explicit;
}

function acceptedInputKindLabel(kind: "image" | "video" | "audio" | "text" | "table_data") {
    if (kind === "image") return tr("图片");
    if (kind === "video") return tr("视频");
    if (kind === "audio") return tr("音频");
    if (kind === "table_data") return tr("多维表格");
    return tr("文本");
}

export function connectionInputSummary(targetNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate?: ConnectionCandidate): ModelInputSummary {
    const sourceIds = new Set([...connections, ...(candidate ? [{ id: "candidate", ...candidate }] : [])].filter((connection) => connection.toNodeId === targetNodeId).map((connection) => connection.fromNodeId));
    const input: ModelInputSummary = { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 };
    sourceIds.forEach((sourceId) => {
        const source = nodes.find((node) => node.id === sourceId);
        if (!source) return;
        // 生成配置与背板不是参考素材，不参与容量计数——这一步必须早于角色卡判定，
        // 否则一个带角色元数据的配置/背板节点会被多算成角色。
        const inputKind = getNodeInputKind(source.type);
        if (!inputKind) return;
        // 角色卡是跨类型覆盖：落在可计数类型上时改记为角色。
        if (source.metadata?.workflowKind === "character") input.characterCount += 1;
        else if (inputKind !== "table_data") input[`${inputKind}Count`] += 1;
    });
    return input;
}

function capacityError(config: AiConfig, capability: "image" | "video", kind: "image" | "video" | "audio", count: number, label: string) {
    const maximum = maxModelInputCapacity(config, capability, kind);
    if (maximum === null || count <= maximum) return "";
    const unit = kind === "image" ? tr("张") : tr("个");
    return maximum > 0 ? tr("已配置模型最多支持 {0} {1}{2}", maximum, unit, label) : tr("已配置模型均不支持{0}", label);
}
