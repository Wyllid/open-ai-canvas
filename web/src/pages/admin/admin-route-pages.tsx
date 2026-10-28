import { tr } from "@/i18n";
import { lazy } from "react";

import { useAdminContext } from "./admin-context";
import { AdminPageFrame } from "./components/admin-shell";

const AnalyticsPanel = lazy(() => import("./components/analytics-panel"));
const FeatureAvailabilityPanel = lazy(() => import("./components/feature-availability-panel"));
const StorageResourcesPanel = lazy(() => import("./components/storage-resources-panel"));

export function AnalyticsPage() {
    const { references } = useAdminContext();
    return (
        <AdminPageFrame title={tr("运行总览")} description={tr("请求质量与任务队列 · 趋势按自然日统计")} scroll>
            <AnalyticsPanel users={references.users} channels={references.channels} />
        </AdminPageFrame>
    );
}

export function FeatureAvailabilityPage() {
    return (
        <AdminPageFrame title={tr("功能模块")} description={tr("启用或隐藏工作台中的模块；关闭不会删除已有数据")} scroll>
            <FeatureAvailabilityPanel />
        </AdminPageFrame>
    );
}

export function StorageResourcesPage() {
    return (
        <AdminPageFrame title={tr("存储资源")} description={tr("只读查看资源记录、容量分布与文件预览")} scroll>
            <StorageResourcesPanel />
        </AdminPageFrame>
    );
}
