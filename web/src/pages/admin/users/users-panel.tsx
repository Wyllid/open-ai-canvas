import { tr } from "@/i18n";
import { App, Button, Dropdown, Input } from "antd";
import { Checkbox } from "@/pages/admin/ui/controls";
import { Ban, Search, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { bulkDisableAdminUsers, deleteAdminUser, listAdminUsers, updateAdminUser, type AdminUser, type LocalUser } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { AdminBatchBar, AdminDataTable, AdminTableEmpty } from "../components/admin-ui";
import { useTableUrlState } from "../lib/use-table-url-state";
import { AdminUserDetailDrawer } from "../components/admin-user-detail-drawer";
import { createUserColumns, userColumnOptions, type UserColumnKey } from "./users-columns";
import { AdminUserEditDrawer } from "./users-drawer";
import { Select } from "@/components/ui/base/select";
import { AdminSearchInput } from "../components/admin-search-input";

const columnStorageKey = "admin-users-visible-columns";
const allColumnKeys = userColumnOptions.map((item) => item.key);

export default function UsersPanel({ onUserChanged }: { onUserChanged?: (user: LocalUser) => void }) {
    const actor = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const { state, update } = useTableUrlState();
    const debouncedFilter = useDebouncedValue(state.filter);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [retry, setRetry] = useState(0);
    const [detailUserId, setDetailUserId] = useState<string | null>(null);
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkDisabling, setBulkDisabling] = useState(false);
    const [visibleColumns, setVisibleColumns] = useState<Set<UserColumnKey>>(() => {
        if (typeof window === "undefined") return new Set(allColumnKeys);
        try {
            const saved = JSON.parse(window.localStorage.getItem(columnStorageKey) || "[]") as UserColumnKey[];
            const valid = saved.filter((key) => allColumnKeys.includes(key));
            return new Set(valid.length ? [...valid, "user", "actions"] : allColumnKeys);
        } catch {
            return new Set(allColumnKeys);
        }
    });
    const requestSequence = useRef(0);
    const hasFilters = Boolean(state.filter || state.role !== "all" || state.status !== "all");
    const detailIndex = detailUserId ? users.findIndex((user) => user.id === detailUserId) : -1;
    const previousUserId = detailIndex > 0 ? users[detailIndex - 1]?.id : undefined;
    const nextUserId = detailIndex >= 0 && detailIndex < users.length - 1 ? users[detailIndex + 1]?.id : undefined;

    useEffect(() => {
        window.localStorage.setItem(columnStorageKey, JSON.stringify([...visibleColumns]));
    }, [visibleColumns]);

    useEffect(() => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setLoadError("");
        setUsers([]);
        setTotal(0);
        void listAdminUsers({
            keyword: debouncedFilter || undefined,
            role: state.role === "all" ? undefined : state.role,
            status: state.status === "all" ? undefined : state.status,
            page: state.page,
            pageSize: state.pageSize,
        })
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setUsers(result.users);
                setTotal(result.total);
                setSelectedUserIds([]);
                if (result.total > 0 && result.users.length === 0 && state.page > 1) update({ page: 1 }, true);
            })
            .catch((error) => {
                if (sequence !== requestSequence.current) return;
                const text = error instanceof Error ? error.message : tr("读取用户失败");
                setLoadError(text);
                message.error(text);
            })
            .finally(() => {
                if (sequence === requestSequence.current) setLoading(false);
            });
    }, [debouncedFilter, message, retry, state.page, state.pageSize, state.role, state.status, update]);

    const replaceUser = useCallback((nextUser: LocalUser) => {
        setUsers((items) => items.map((item) => item.id === nextUser.id ? { ...item, ...nextUser } : item));
        onUserChanged?.(nextUser);
    }, [onUserChanged]);

    const toggleStatus = useCallback(async (user: AdminUser) => {
        try {
            if (user.status === "active") {
                await deleteAdminUser(user.id);
                replaceUser({ ...user, status: "disabled" });
                message.success(tr("用户已停用并清除登录状态"));
                return;
            }
            const result = await updateAdminUser(user.id, { status: "active" });
            replaceUser(result.user);
            message.success(tr("用户已重新启用"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("更新用户状态失败"));
        }
    }, [message, replaceUser]);

    const columns = useMemo(() => createUserColumns({
        actorId: actor?.id,
        visibleColumns,
        onView: (user) => setDetailUserId(user.id),
        onEdit: (user) => setEditingUser(user),
        onToggleStatus: toggleStatus,
    }), [actor?.id, toggleStatus, visibleColumns]);

    const resetFilters = () => update({ filter: "", role: "all", status: "all", page: 1 });

    const bulkDisable = () => {
        modal.confirm({
            title: tr("停用选中的 {0} 个用户？", selectedUserIds.length),
            content: tr("这些用户的全部登录态会被清除，身份、任务和积分流水继续保留。操作会整体成功或整体回滚。"),
            okText: tr("确认批量停用"),
            cancelText: tr("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                setBulkDisabling(true);
                try {
                    const result = await bulkDisableAdminUsers(selectedUserIds);
                    result.users.forEach(replaceUser);
                    setSelectedUserIds([]);
                    message.success(tr("已停用 {0} 个用户", result.disabledCount));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : tr("批量停用用户失败"));
                } finally {
                    setBulkDisabling(false);
                }
            },
        });
    };

    return (
        <>
            <AdminDataTable
                toolbar={
                    <>
                        <AdminSearchInput
                            allowClear
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={state.filter}
                            aria-label={tr("搜索用户")}
                            placeholder={tr("搜索用户名、名称或邮箱")}
                            onValueChange={(value) => update({ filter: value, page: 1 }, true)}
                        />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={resetFilters}
                toolbarFilters={
                    <>
                        <Select
                            aria-label={tr("筛选用户角色")}
                            className="w-32"
                            value={state.role}
                            options={[{ value: "all", label: tr("全部角色") }, { value: "admin", label: tr("管理员") }, { value: "user", label: tr("普通用户") }]}
                            onChange={(role) => update({ role, page: 1 })}
                        />
                        <Select
                            aria-label={tr("筛选用户状态")}
                            className="w-32"
                            value={state.status}
                            options={[{ value: "all", label: tr("全部状态") }, { value: "active", label: tr("已启用") }, { value: "disabled", label: tr("已停用") }]}
                            onChange={(status) => update({ status, page: 1 })}
                        />
                    </>
                }
                trailing={
                    <div className="flex items-center gap-2">
                        <Dropdown
                            trigger={["click"]}
                            popupRender={() => (
                                <div className="w-48 rounded-md border border-border bg-popover p-2 shadow-lg">
                                    <div className="px-2 pb-2 text-xs font-medium text-foreground/55">{tr("显示列")}</div>
                                    <div className="space-y-0.5">
                                        {userColumnOptions.map((option) => (
                                            <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted/60">
                                                <Checkbox
                                                    bare
                                                    checked={visibleColumns.has(option.key)}
                                                    disabled={option.locked}
                                                    onChange={(event) => setVisibleColumns((current) => {
                                                        const next = new Set(current);
                                                        if (event.target.checked) next.add(option.key);
                                                        else next.delete(option.key);
                                                        return next;
                                                    })}
                                                />
                                                {option.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        >
                            <Button icon={<Settings2 className="size-4" />}>{tr("列设置")}</Button>
                        </Dropdown>
                    </div>
                }
                batchActions={<AdminBatchBar count={selectedUserIds.length} onClear={() => setSelectedUserIds([])}><Button danger size="small" icon={<Ban className="size-3.5" />} loading={bulkDisabling} onClick={bulkDisable}>{tr("批量停用")}</Button></AdminBatchBar>}
                skeletonColumns={Math.max(4, columns.length)}
                table={{
                    className: "app-data-table admin-users-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    rowSelection: {
                        selectedRowKeys: selectedUserIds,
                        preserveSelectedRowKeys: false,
                        onChange: (keys) => setSelectedUserIds(keys.map(String)),
                        getCheckboxProps: (user) => ({ disabled: user.id === actor?.id || user.status === "disabled", name: user.displayName || user.username }),
                    },
                    columns,
                    dataSource: users,
                    pagination: false,
                    scroll: { x: 860 },
                }}
                empty={loadError ? <div className="admin-inline-load-error" role="status"><span>{tr("用户数据暂不可用：")}{loadError}</span><Button size="small" onClick={() => setRetry((value) => value + 1)}>{tr("重试")}</Button></div> : <AdminTableEmpty filtered={hasFilters} />}
                footer={<PaginationBar alwaysShow current={state.page} pageSize={state.pageSize} total={total} onChange={(page, pageSize) => update({ page: pageSize !== state.pageSize ? 1 : page, pageSize })} />}
            />

            <AdminUserDetailDrawer userId={detailUserId} previousUserId={previousUserId} nextUserId={nextUserId} onNavigate={setDetailUserId} onClose={() => setDetailUserId(null)} />
            <AdminUserEditDrawer user={editingUser} actorId={actor?.id} onClose={() => setEditingUser(null)} onSaved={replaceUser} />
        </>
    );
}
