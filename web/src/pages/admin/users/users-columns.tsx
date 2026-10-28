import { currentLocale, tr, trIn } from "@/i18n";
import type { ColumnsType } from "antd/es/table";
import { Eye, Pencil, Power } from "lucide-react";

import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { AdminRowActions, AdminStatusBadge } from "../components/admin-ui";
import type { AdminUser } from "@/services/api/auth";

export type UserColumnKey = "user" | "email" | "credits" | "role" | "status" | "createdAt" | "actions";

export const userColumnOptions: Array<{ key: UserColumnKey; label: string; locked?: boolean }> = [
    { key: "user", label: tr("用户"), locked: true },
    { key: "email", label: tr("邮箱") },
    { key: "credits", label: tr("当前积分") },
    { key: "role", label: trIn("user", "角色") },
    { key: "status", label: tr("状态") },
    { key: "createdAt", label: tr("创建时间") },
    { key: "actions", label: tr("操作"), locked: true },
];

export function createUserColumns({
    actorId,
    visibleColumns,
    onView,
    onEdit,
    onToggleStatus,
}: {
    actorId?: string;
    visibleColumns: Set<UserColumnKey>;
    onView: (user: AdminUser) => void;
    onEdit: (user: AdminUser) => void;
    onToggleStatus: (user: AdminUser) => Promise<void>;
}): ColumnsType<AdminUser> {
    const columns: Array<ColumnsType<AdminUser>[number] & { key: UserColumnKey }> = [
        {
            key: "user",
            title: tr("用户"),
            dataIndex: "username",
            render: (_, user) => (
                <div>
                    <div className="flex items-center gap-2"><button type="button" className="admin-table-primary-link font-medium" onClick={() => onView(user)}>{user.displayName || user.username}</button><IdentityProviderBadge user={user} /></div>
                    <div className="text-xs text-foreground/45">@{user.username}</div>
                </div>
            ),
        },
        { key: "email", title: tr("邮箱"), dataIndex: "email", align: "center", render: (email) => email || <span className="text-foreground/40">{tr("未填写")}</span> },
        {
            key: "role",
            title: trIn("user", "角色"),
            dataIndex: "role",
            width: 150,
            align: "center",
            render: (role, user) => (
                <span className="inline-flex flex-wrap items-center justify-center gap-1">
                    <AdminStatusBadge label={role === "admin" ? tr("管理员") : tr("普通用户")} tone={role === "admin" ? "info" : "neutral"} />
                </span>
            ),
        },
        { key: "status", title: tr("状态"), dataIndex: "status", width: 110, align: "center", render: (status) => <AdminStatusBadge label={status === "active" ? tr("已启用") : tr("已停用")} tone={status === "active" ? "success" : "neutral"} /> },
        { key: "createdAt", title: tr("创建时间"), dataIndex: "createdAt", width: 112, align: "center", render: (value) => <span className="tabular-nums" title={formatTime(value)}>{formatCompactTime(value)}</span> },
        {
            key: "actions",
            title: tr("操作"),
            width: 184,
            align: "center",
            render: (_, user) => (
                <AdminRowActions
                    primary={{ label: tr("详情"), icon: <Eye className="size-3.5" />, onClick: () => onView(user) }}
                    visibleActionCount={1}
                    actions={[
                        {
                            key: "toggle-status",
                            label: user.status === "active" ? tr("停用用户") : tr("重新启用"),
                            icon: <Power className="size-3.5" />,
                            danger: user.status === "active",
                            disabled: user.id === actorId,
                            confirm: {
                                title: user.status === "active" ? tr("停用这个用户？") : tr("重新启用这个用户？"),
                                description: user.status === "active" ? tr("停用后会清除该用户登录态，但保留身份、任务和积分流水。") : tr("启用后，该用户可以重新登录并继续使用原有数据。"),
                                okText: user.status === "active" ? tr("确认停用") : tr("确认启用"),
                            },
                            onClick: () => onToggleStatus(user),
                        },
                        { key: "edit", label: tr("编辑用户"), icon: <Pencil className="size-3.5" />, onClick: () => onEdit(user) },
                    ]}
                />
            ),
        },
    ];
    return columns.filter((column) => visibleColumns.has(column.key));
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString(currentLocale(), { hour12: false }) : "--";
}

function formatCompactTime(value?: string) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
