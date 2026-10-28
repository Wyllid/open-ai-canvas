import { tr } from "@/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";

type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled" | "imageWorkbenchEnabled" | "videoWorkbenchEnabled";

const featureNames: Record<FeatureKey, string> = {
    shortDramaEnabled: tr("短剧创作"),
    taskCenterEnabled: tr("任务中心"),
    frontendModelsEnabled: tr("前台模型"),
    pluginCenterEnabled: tr("插件中心"),
    imageWorkbenchEnabled: tr("生图"),
    videoWorkbenchEnabled: tr("视频"),
};

export function RequireFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const [checking, setChecking] = useState(() => !useUserStore.getState().features[feature]);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        setError("");
        refreshFeatureAvailability()
            .catch((reason) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : tr("读取功能开放状态失败"));
            })
            .finally(() => {
                if (!cancelled) setChecking(false);
            });
        return () => {
            cancelled = true;
        };
    }, [feature, user?.id]);

    if (checking)
        return (
            <WorkspacePage>
                <WorkspaceLoadingState label={tr("正在确认功能状态")} detail={featureNames[feature]} rows={3} />
            </WorkspacePage>
        );
    if (error)
        return (
            <WorkspacePage>
                <WorkspaceErrorState title={tr("无法确认功能状态")} description={error} actionLabel={tr("返回创作台")} onRetry={() => navigate("/", { replace: true })} />
            </WorkspacePage>
        );
    if (!features[feature]) {
        // 管理员页面返回到管理后台首页，用户页面返回到创作台
        const isAdminFeature = feature === "frontendModelsEnabled";
        const backPath = isAdminFeature ? "/admin" : "/";
        const backLabel = isAdminFeature ? tr("返回管理后台") : tr("返回创作台");

        return (
            <WorkspacePage>
                <WorkspaceState
                    kind="forbidden"
                    icon="settings"
                    title={tr("{0}暂未开放", featureNames[feature])}
                    description={tr("当前功能已由平台管理员关闭。")}
                    action={
                        <Button type="primary" onClick={() => navigate(backPath, { replace: true })}>
                            {backLabel}
                        </Button>
                    }
                />
            </WorkspacePage>
        );
    }
    return children;
}
