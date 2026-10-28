import type { ApiCallLog } from "@/services/api/auth";

export type LogView = "troubleshoot" | "usage" | "all";

export function normalizeLogView(value: string | null): LogView {
    return value === "usage" || value === "all" ? value : "troubleshoot";
}

export function logStatus(log: Pick<ApiCallLog, "status" | "providerStatus">) {
    const providerStatus = log.providerStatus?.toLowerCase();
    if (log.status === "failed" || ["failed", "cancelled", "canceled", "expired"].includes(providerStatus || "")) return { label: "失败", tone: "error" as const };
    if (["queued", "pending", "processing", "running", "in_progress"].includes(providerStatus || "")) return { label: "处理中", tone: "warning" as const };
    return { label: "成功", tone: "success" as const };
}
