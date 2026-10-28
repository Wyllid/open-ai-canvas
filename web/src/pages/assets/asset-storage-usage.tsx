import { tr } from "@/i18n";
import { HardDrive } from "lucide-react";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter, accountStorageStateMessage, formatStorageBytes } from "@/lib/account-storage-usage";
import { progressFillStyle } from "@/lib/progress-fill";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

export function AssetStorageUsage() {
    const query = useAccountFileStorageUsage();
    const usage = query.data;
    const meter = accountStorageMeter(usage);
    const stateMessage = accountStorageStateMessage(meter);

    return (
        <section
            className={`assets-storage-usage${meter.full || meter.state !== "ok" ? " is-full" : ""}${usage?.usedBytes ? " has-usage" : ""}`}
            aria-label={tr("账号文件容量")}
            aria-busy={query.isPending}
            title={tr("包含素材文件和 Agent 会话附件{0}", stateMessage ? `。${stateMessage}` : "")}
        >
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">{meter.state === "read_only" ? tr("账号只读") : meter.state === "grace" ? tr("容量已超额") : tr("账号容量")}</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.totalBytes)}
                    </span>
                    <span
                        className="assets-storage-usage-track"
                        role="progressbar"
                        aria-label={tr("账号文件容量使用进度")}
                        aria-valuemin={0}
                        aria-valuemax={usage.totalBytes}
                        aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}
                        aria-valuetext={tr("已使用 {0}，总容量 {1}", formatStorageBytes(usage.usedBytes), formatStorageBytes(usage.totalBytes))}
                    >
                        <span style={progressFillStyle(meter.percent)} />
                    </span>
                    <span className="assets-storage-usage-percent">{meter.percentLabel}</span>
                </>
            ) : query.isError ? (
                <span className="assets-storage-usage-status">
                    {tr("容量统计暂时不可用。")}
                    <button type="button" onClick={() => void query.refetch()}>
                        {tr("重试")}
                    </button>
                </span>
            ) : (
                <span className="assets-storage-usage-status">{tr("正在统计已用容量…")}</span>
            )}
        </section>
    );
}
