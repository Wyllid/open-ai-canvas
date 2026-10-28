import { tr } from "@/i18n";
import type { ProjectDetail, ProjectSummary, ProjectUnit } from "@/services/api/projects";

export type ProjectActionTone = "default" | "attention" | "danger";

export type ProjectWorkbenchAction = {
    id: string;
    title: string;
    description: string;
    href: string;
    actionLabel: string;
    tone: ProjectActionTone;
};

export type ProjectContinueTarget = {
    href: string;
    title: string;
    context: string;
    updatedAt: string;
};

export type ProjectStageCell = {
    label: string;
    state: "idle" | "active" | "attention" | "completed";
};

export type ProjectUnitStage = {
    unit: ProjectUnit;
    content: ProjectStageCell;
    assets: ProjectStageCell;
    storyboard: ProjectStageCell;
    canvas: ProjectStageCell;
};

export function projectSummaryCompletion(summary: ProjectSummary) {
    return summary.unitCount ? Math.round((summary.completedUnitCount / summary.unitCount) * 100) : 0;
}

export function projectSummaryStage(summary: ProjectSummary) {
    if (summary.project.status === "archived") return { label: tr("已归档"), detail: tr("可在项目设置中恢复") };
    if (!summary.unitCount) return { label: tr("准备故事"), detail: tr("还没有剧情章节") };
    if (summary.completedUnitCount === summary.unitCount) return { label: tr("章节已完成"), detail: tr("可继续检查镜头与交付结果") };
    if (!summary.canvasCount) return { label: tr("组织章节"), detail: tr("下一步可建立项目画布") };
    if (!summary.assetCount) return { label: tr("准备资产"), detail: tr("补充角色、场景或画风") };
    return { label: tr("制作中"), detail: tr("{0}/{1} 章已完成", summary.completedUnitCount, summary.unitCount) };
}

export function projectDetailStage(detail: ProjectDetail) {
    if (detail.project.status === "archived") return { label: tr("已归档"), detail: tr("恢复项目后可继续制作") };
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    if (failedSteps) return { label: tr("需要处理"), detail: tr("{0} 个流程步骤失败", failedSteps) };
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    if (pendingCandidates) return { label: tr("资产确认"), detail: tr("{0} 个候选待确认", pendingCandidates) };
    if (!detail.units.length) return { label: tr("准备故事"), detail: tr("添加或导入剧情章节") };
    if (!detail.shots.length) return { label: tr("分镜准备"), detail: tr("选择章节生成镜头") };
    const runningSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "running" || step.status === "review").length;
    if (runningSteps) return { label: tr("制作中"), detail: tr("{0} 个流程步骤正在推进", runningSteps) };
    const completedUnits = detail.units.filter((unit) => unit.status === "completed").length;
    if (completedUnits === detail.units.length) return { label: tr("检查交付"), detail: tr("章节已完成，可检查镜头与结果") };
    return { label: tr("镜头制作"), detail: tr("{0} 个镜头已建立", detail.shots.length) };
}

export function projectAttentionCount(detail: ProjectDetail) {
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    return pendingCandidates + failedSteps;
}

export function projectContinueTarget(detail: ProjectDetail): ProjectContinueTarget {
    const latestCanvas = [...detail.canvases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const latestUnit = [...detail.units].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (latestCanvas && (!latestUnit || latestCanvas.updatedAt >= latestUnit.updatedAt)) {
        return {
            href: `/canvas/${latestCanvas.id}`,
            title: latestCanvas.title,
            context: tr("继续编辑项目画布"),
            updatedAt: latestCanvas.updatedAt,
        };
    }
    if (latestUnit) {
        return {
            href: `/projects/${detail.project.id}/chapters/${latestUnit.id}`,
            title: latestUnit.title,
            context: tr("继续处理剧情章节"),
            updatedAt: latestUnit.updatedAt,
        };
    }
    return {
        href: `/projects/${detail.project.id}/chapters`,
        title: detail.project.name,
        context: tr("从剧情章节开始"),
        updatedAt: detail.project.updatedAt,
    };
}

// 项目概览必须把真实阻塞转成动作；没有事实依据时只提示通用的制作下一步。
export function projectNextActions(detail: ProjectDetail, limit = 4): ProjectWorkbenchAction[] {
    const actions: ProjectWorkbenchAction[] = [];
    const projectRoot = `/projects/${detail.project.id}`;
    if (detail.project.status === "archived") {
        return [{
            id: "restore-project",
            title: tr("项目已归档"),
            description: tr("恢复后才能创建画布和提交生成任务。"),
            href: `${projectRoot}/settings`,
            actionLabel: tr("前往恢复"),
            tone: "attention",
        }];
    }

    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed");
    if (failedSteps.length) {
        actions.push({
            id: "failed-steps",
            title: tr("处理 {0} 个失败步骤", failedSteps.length),
            description: failedSteps[0].error?.trim() || tr("查看失败原因和输入后，仅重试受影响的任务。"),
            href: "/tasks?status=failed",
            actionLabel: tr("查看失败任务"),
            tone: "danger",
        });
    }

    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation");
    if (pendingCandidates.length) {
        const categories = new Set(pendingCandidates.map((candidate) => candidate.category));
        actions.push({
            id: "pending-assets",
            title: tr("确认 {0} 个资产候选", pendingCandidates.length),
            description: tr("{0} 类角色、场景或制作资产需要确认后才能稳定复用。", categories.size),
            href: `${projectRoot}/assets`,
            actionLabel: tr("去确认"),
            tone: "attention",
        });
    }

    if (!detail.units.length) {
        actions.push({
            id: "add-story",
            title: tr("添加第一个剧情章节"),
            description: tr("导入小说、粘贴文本，或从空白章节开始。"),
            href: `${projectRoot}/chapters`,
            actionLabel: tr("添加章节"),
            tone: "default",
        });
    } else {
        const firstDraft = [...detail.units].sort(byPosition).find((unit) => unit.status === "draft");
        if (firstDraft) {
            actions.push({
                id: `review-unit-${firstDraft.id}`,
                title: tr("确认第 {0} 章内容", firstDraft.position + 1),
                description: firstDraft.title,
                href: `${projectRoot}/chapters/${firstDraft.id}`,
                actionLabel: tr("继续处理"),
                tone: "default",
            });
        }

        const unitsWithShots = new Set(detail.shots.map((shot) => shot.unitId).filter(Boolean));
        const firstUnitWithoutShots = [...detail.units].sort(byPosition).find((unit) => unit.status !== "draft" && !unitsWithShots.has(unit.id));
        if (firstUnitWithoutShots) {
            actions.push({
                id: `storyboard-unit-${firstUnitWithoutShots.id}`,
                title: tr("为第 {0} 章建立分镜", firstUnitWithoutShots.position + 1),
                description: tr("{0}还没有镜头，可先生成分镜草稿再逐项调整。", firstUnitWithoutShots.title),
                href: `${projectRoot}/chapters/${firstUnitWithoutShots.id}`,
                actionLabel: tr("建立分镜"),
                tone: "default",
            });
        }
    }

    if (!detail.canvases.length && detail.units.length) {
        actions.push({
            id: "create-canvas",
            title: tr("建立第一张项目画布"),
            description: tr("把章节、分镜和参考资产放进同一个制作空间。"),
            href: `${projectRoot}/canvases`,
            actionLabel: tr("查看项目画布"),
            tone: "default",
        });
    }

    if (!actions.length) {
        const target = projectContinueTarget(detail);
        actions.push({
            id: "continue-project",
            title: tr("继续最近的制作内容"),
            description: `${target.context}：${target.title}`,
            href: target.href,
            actionLabel: tr("继续创作"),
            tone: "default",
        });
    }
    return actions.slice(0, limit);
}

export function projectUnitStages(detail: ProjectDetail, limit = 8): ProjectUnitStage[] {
    const sortedUnits = [...detail.units].sort(byPosition).slice(0, limit);
    return sortedUnits.map((unit) => {
        const candidates = detail.assetCandidates.filter((candidate) => candidate.unitId === unit.id);
        const pendingCandidates = candidates.filter((candidate) => candidate.status === "pending_confirmation").length;
        const confirmedCandidates = candidates.filter((candidate) => candidate.status === "confirmed").length;
        const shots = detail.shots.filter((shot) => shot.unitId === unit.id);
        const canvasCount = new Set(detail.canvasUnitLinks.filter((link) => link.unitId === unit.id).map((link) => link.canvasId)).size;
        return {
            unit,
            content: contentStage(unit),
            assets: pendingCandidates
                ? { label: tr("{0} 待确认", pendingCandidates), state: "attention" }
                : confirmedCandidates
                  ? { label: tr("{0} 已确认", confirmedCandidates), state: "completed" }
                  : { label: tr("未识别"), state: "idle" },
            storyboard: shots.length
                ? { label: tr("{0} 镜头", shots.length), state: shots.every((shot) => shot.status === "completed") ? "completed" : "active" }
                : { label: tr("未开始"), state: "idle" },
            canvas: canvasCount
                ? { label: tr("{0} 张", canvasCount), state: "active" }
                : { label: tr("未关联"), state: "idle" },
        };
    });
}

function contentStage(unit: ProjectUnit): ProjectStageCell {
    if (unit.status === "completed") return { label: tr("已完成"), state: "completed" };
    if (unit.status === "ready") return { label: tr("待制作"), state: "active" };
    return { label: tr("草稿"), state: "attention" };
}

function byPosition(left: ProjectUnit, right: ProjectUnit) {
    return left.position - right.position;
}
