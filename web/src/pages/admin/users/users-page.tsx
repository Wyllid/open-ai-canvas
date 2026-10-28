import { tr } from "@/i18n";
import { AdminPageFrame } from "../components/admin-shell";
import { useAdminContext } from "../admin-context";
import UsersPanel from "./users-panel";

export default function UsersPage() {
    const { updateUserReference } = useAdminContext();
    return (
        <AdminPageFrame title={tr("用户管理")} description={tr("账号、角色与状态")}>
            <UsersPanel onUserChanged={updateUserReference} />
        </AdminPageFrame>
    );
}
