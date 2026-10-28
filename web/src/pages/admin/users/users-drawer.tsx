import { tr, trIn } from "@/i18n";
import { App, Button, Drawer, Form, Input } from "antd";
import { Select } from "@/pages/admin/ui/controls";
import { useEffect, useState } from "react";

import { updateAdminUser, type AdminUser, type LocalUser } from "@/services/api/auth";

type UserFormValues = Pick<LocalUser, "displayName" | "email" | "role" | "status"> & { password?: string };

export function AdminUserEditDrawer({ user, actorId, onClose, onSaved }: { user: AdminUser | null; actorId?: string; onClose: () => void; onSaved: (user: LocalUser) => void }) {
    const { message, modal } = App.useApp();
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<UserFormValues>();
    const editingSelf = user?.id === actorId;

    useEffect(() => {
        if (!user) return;
        form.resetFields();
        form.setFieldsValue({
            displayName: user.displayName,
            email: user.email || "",
            role: user.role,
            status: user.status,
        });
    }, [form, user]);

    const close = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) {
            onClose();
            return;
        }
        modal.confirm({
            title: tr("放弃用户修改？"),
            content: tr("尚未保存的账号、角色或状态修改将丢失。"),
            okText: tr("放弃修改"),
            cancelText: tr("继续编辑"),
            okButtonProps: { danger: true },
            onOk: onClose,
        });
    };

    const save = async () => {
        if (!user) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            const result = await updateAdminUser(user.id, {
                displayName: values.displayName.trim(),
                email: values.email?.trim() || "",
                role: values.role,
                status: values.status,
                ...(values.password?.trim() ? { password: values.password } : {}),
            });
            onSaved(result.user);
            form.resetFields();
            onClose();
            message.success(tr("用户信息已保存"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("保存用户失败"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            title={user ? tr("编辑用户 · {0}", user.displayName || user.username) : tr("编辑用户")}
            open={Boolean(user)}
            size="min(520px, 100vw)"
            onClose={close}
            mask={{ closable: !saving }}
            destroyOnHidden
            extra={
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    {tr("保存")}
                </Button>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item label={tr("用户名")}>
                    <Input value={user ? `@${user.username}` : ""} disabled />
                </Form.Item>
                <Form.Item name="displayName" label={tr("显示名称")} rules={[{ required: true, whitespace: true, message: tr("请填写显示名称") }]}>
                    <Input placeholder={tr("用户在产品内显示的名称")} />
                </Form.Item>
                <Form.Item name="email" label={tr("邮箱")} rules={[{ type: "email", message: tr("请输入有效邮箱") }]}>
                    <Input placeholder="name@example.com" />
                </Form.Item>
                <Form.Item name="password" label={tr("重置密码")} extra={tr("留空表示不修改；保存后该用户已有登录会话会失效。")} rules={[{ min: 8, message: tr("密码至少 8 位") }]}>
                    <Input.Password placeholder={tr("输入新密码以手动重置")} autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="role" label={trIn("user", "角色")} extra={editingSelf ? tr("不能在此修改当前管理员自己的角色。") : tr("角色变更会立即影响后台访问权限。")}>
                    <Select
                        disabled={editingSelf}
                        options={[
                            { label: tr("管理员"), value: "admin" },
                            { label: tr("普通用户"), value: "user" },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="status" label={tr("账号状态")} extra={editingSelf ? tr("不能停用当前登录账号。") : tr("停用后会清除登录态，但保留身份、任务和积分流水。")}>
                    <Select
                        disabled={editingSelf}
                        options={[
                            { label: tr("已启用"), value: "active" },
                            { label: tr("已停用"), value: "disabled" },
                        ]}
                    />
                </Form.Item>
            </Form>
        </Drawer>
    );
}
