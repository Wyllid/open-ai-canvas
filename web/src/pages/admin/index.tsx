import { tr } from "@/i18n";
import { useUserStore } from "@/stores/use-user-store";
import { AdminProvider } from "./admin-context";
import { AdminShell } from "./components/admin-shell";
import "./theme/admin-tokens.css";
import "./theme/admin-chrome.css";

export default function AdminPage() {
    const actor = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    if (!hydrated) return null;
    if (actor?.role !== "admin") {
        return (
            <main data-admin-root className="admin-unauthorized">
                <div className="admin-unauthorized-card">
                    <h1>{tr("无权限")}</h1>
                    <p>{tr("当前账号不是管理员，无法访问后台。")}</p>
                </div>
            </main>
        );
    }

    return (
        <AdminProvider>
            <AdminShell />
        </AdminProvider>
    );
}
