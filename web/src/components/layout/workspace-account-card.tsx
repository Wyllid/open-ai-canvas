import { tr } from "@/i18n";
import { Button } from "antd";
import { ArrowUpRight, LogOut, Settings } from "lucide-react";
import { useOpenSettings } from "@/components/settings/settings-modal-host";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import "./workspace-account-card.css";

/** 同一账户卡片用于顶部和侧栏；退出复用真实服务。 */
export function WorkspaceAccountCard({ onNavigate }: { onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const openSettings = useOpenSettings();
    if (!user) return null;
    return <section className="workspace-account-card" aria-label={tr("我的账户")}>
        <header className="workspace-account-card-identity">
            <UserAvatar user={user} className="workspace-account-card-avatar" />
            <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
            <em>{user.role === "admin" ? tr("管理员") : tr("创作者")}</em>
        </header>
        <nav className="workspace-account-card-actions" aria-label={tr("账户操作")}>
            <button type="button" className="workspace-account-card-link" onClick={() => { onNavigate(); openSettings("account"); }}><Settings /><span>{tr("设置")}</span><ArrowUpRight /></button>
            <Button danger type="text" icon={<LogOut />} loading={loggingOut} onClick={() => void handleLogout()}>{tr("退出登录")}</Button>
        </nav>
    </section>;
}
