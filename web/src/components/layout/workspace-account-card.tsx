import { tr } from "@/i18n";
import { Button } from "antd";
import { ArrowUpRight, LogOut, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import "./workspace-account-card.css";

/** 同一账户卡片用于顶部和侧栏；退出复用真实服务。 */
export function WorkspaceAccountCard({ onNavigate }: { onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    if (!user) return null;
    return <section className="workspace-account-card" aria-label={tr("我的账户")}>
        <header className="workspace-account-card-identity">
            <UserAvatar user={user} className="workspace-account-card-avatar" />
            <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
            <em>{user.role === "admin" ? tr("管理员") : tr("创作者")}</em>
        </header>
        <nav className="workspace-account-card-actions" aria-label={tr("账户操作")}>
            <Link to="/settings?section=profile" onClick={onNavigate}><Settings /><span>{tr("账户与设置")}</span><ArrowUpRight /></Link>
            {user.role === "admin" ? <Link to="/admin" onClick={onNavigate}><ShieldCheck /><span>{tr("管理员后台")}</span><ArrowUpRight /></Link> : null}
            <Button danger type="text" icon={<LogOut />} loading={loggingOut} onClick={() => void handleLogout()}>{tr("退出登录")}</Button>
        </nav>
    </section>;
}
