import { tr } from "@/i18n";
import { useEffect, useState } from "react";
import { App, Button } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { getAdminFeatureAvailability, updateAdminFeatureAvailability } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export function WelcomeSetting() {
    const { message } = App.useApp();
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const setFeatures = useUserStore((state) => state.setFeatures);

    useEffect(() => {
        let active = true;
        setError("");
        getAdminFeatureAvailability()
            .then(({ features }) => {
                if (typeof features.welcomeEnabled !== "boolean") throw new Error(tr("欢迎页配置无效"));
                if (active) setEnabled(features.welcomeEnabled);
            })
            .catch(() => {
                if (active) setError(tr("读取欢迎页状态失败，请重试。"));
            });
        return () => {
            active = false;
        };
    }, [revision]);

    async function changeWelcome(value: boolean) {
        if (saving) return;
        setSaving(true);
        try {
            const { features } = await updateAdminFeatureAvailability({ welcomeEnabled: value });
            if (features.welcomeEnabled !== value) throw new Error(tr("欢迎页状态未保存，请重试"));
            setEnabled(features.welcomeEnabled);
            setFeatures(features);
            message.success(value ? tr("欢迎页已启用") : tr("欢迎页已关闭"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("保存欢迎页状态失败"));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="admin-appearance-logo-frame-option">
            <div className="admin-appearance-logo-frame-copy">
                <strong>{tr("启用欢迎页")}</strong>
                <p>{tr("切换后立即保存。关闭后访问 /welcome 将进入创作工作台；游客可浏览，生成时需登录。")}</p>
                {error ? (
                    <div role="alert">
                        {error}
                        <Button onClick={() => setRevision((value) => value + 1)}>{tr("重试")}</Button>
                    </div>
                ) : null}
            </div>
            <div className="admin-appearance-logo-frame-control">
                <span>{enabled === null ? tr("读取中") : saving ? tr("保存中") : enabled ? tr("已启用") : tr("已关闭")}</span>
                <Switch aria-label={tr("启用欢迎页")} checked={enabled === true} disabled={enabled === null || saving || Boolean(error)} onChange={(value) => void changeWelcome(value)} />
            </div>
        </div>
    );
}
