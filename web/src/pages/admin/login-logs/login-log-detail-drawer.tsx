import { tr } from "@/i18n";
import { Alert, Button, Skeleton } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { AppDrawer } from "@/components/ui/product/app-drawer/app-drawer";
import { getAdminLoginLog, type LoginLog } from "@/services/api/login-logs";
import { loginEventLabels, loginLogDevice, loginMethodLabels, loginSourceLabels } from "./login-log-display";

export function LoginLogDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
    const [detail, setDetail] = useState<LoginLog | null>(null);
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        setDetail(null);
        setError("");
        if (!id) return;
        const controller = new AbortController();
        void getAdminLoginLog(id, controller.signal)
            .then(({ log }) => {
                if (!controller.signal.aborted) setDetail(log);
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : tr("读取日志详情失败"));
            });
        return () => controller.abort();
    }, [id, retry]);
    const device = detail ? loginLogDevice(detail.userAgent) : null;
    const entries = detail
        ? [
              [tr("时间"), dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm:ss.SSS Z")],
              [tr("用户昵称"), detail.displayName || tr("未关联用户")],
              [tr("账号"), detail.username || detail.account || tr("未识别")],
              [tr("用户 ID"), detail.userId || tr("未关联用户")],
              [tr("事件"), loginEventLabels[detail.event]],
              [tr("来源"), loginSourceLabels[detail.source]],
              [tr("登录方式"), loginMethodLabels[detail.method]],
              [tr("结果"), detail.result === "success" ? tr("成功") : tr("失败")],
              ["IP", detail.ip || tr("未记录")],
              [tr("浏览器"), device?.browser || tr("未记录")],
              [tr("操作系统"), device?.os || tr("未记录")],
              [tr("客户端自报信息"), detail.userAgent || tr("未记录")],
              [tr("失败原因"), detail.message || tr("无")],
              [tr("原因码"), detail.reason || tr("无")],
              [tr("关联会话标识"), detail.sessionRef || tr("未关联会话")],
              [tr("日志 ID"), detail.id],
          ]
        : [];
    return (
        <AppDrawer title={tr("登录日志详情")} open={Boolean(id)} onClose={onClose} size={560}>
            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title={tr("详情读取失败")}
                    description={error}
                    action={
                        <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                            {tr("重试")}
                        </Button>
                    }
                />
            ) : !detail ? (
                <Skeleton active />
            ) : (
                <dl className="space-y-5">
                    {entries.map(([label, value]) => (
                        <div key={label}>
                            <dt className="mb-1 text-xs text-foreground/50">{label}</dt>
                            <dd className="break-words text-sm text-foreground">{value}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </AppDrawer>
    );
}
