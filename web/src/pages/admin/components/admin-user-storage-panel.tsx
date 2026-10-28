import { tr } from "@/i18n";
import { App, Button, Form, Input, InputNumber, Progress, Skeleton } from "antd";
import { useEffect, useState } from "react";

import { accountStorageMeter, accountStorageStateMessage, formatStorageCapacity, formatStorageDate, formatStorageDuration } from "@/lib/account-storage-usage";
import { getAdminUserStorage, grantAdminUserStorage, revokeAdminStorageGrant, storageGrantActive, type AdminUserStorage, type UserStorageGrant } from "@/services/api/storage-grants";

import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

type GrantFormValues = { storageGB: number; durationDays: number; note?: string };

/** 管理端查看用户有效文件容量、赠送与撤销扩容。撤销后已用超额同样进入 7 天宽限期。 */
export function AdminUserStoragePanel({ userId }: { userId: string }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<GrantFormValues>();
    const [data, setData] = useState<AdminUserStorage | null>(null);
    const [loading, setLoading] = useState(false);
    const [granting, setGranting] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            setData(await getAdminUserStorage(userId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("读取存储空间失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setData(null);
        form.setFieldsValue({ storageGB: 10, durationDays: 30, note: "" });
        void load();
    }, [userId]);

    const grant = async () => {
        const values = await form.validateFields();
        setGranting(true);
        try {
            await grantAdminUserStorage(userId, { bytes: values.storageGB * 1024 ** 3, durationDays: values.durationDays || 0, note: values.note?.trim() });
            message.success(tr("已赠送存储空间"));
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : tr("赠送存储空间失败"));
        } finally {
            setGranting(false);
        }
    };

    const revoke = (item: UserStorageGrant) => {
        let reason = "";
        modal.confirm({
            title: tr("撤销 {0} 扩容？", formatStorageCapacity(item.bytes)),
            content: (
                <div className="space-y-2">
                    <p className="text-sm text-foreground/60">{tr("撤销后立即减少该用户的有效容量；如已用超出新容量，将进入 7 天宽限期后只读。")}</p>
                    <Input.TextArea rows={3} maxLength={500} placeholder={tr("撤销原因（必填），例如：线下退款")} onChange={(event) => (reason = event.target.value)} />
                </div>
            ),
            okText: tr("撤销"),
            okButtonProps: { danger: true },
            onOk: async () => {
                if (!reason.trim()) {
                    message.error(tr("请填写撤销原因"));
                    throw new Error("missing reason");
                }
                await revokeAdminStorageGrant(item.id, reason.trim());
                message.success(tr("已撤销扩容"));
                await load();
            },
        });
    };

    if (loading && !data) return <Skeleton active paragraph={{ rows: 6 }} />;
    const meter = accountStorageMeter(data?.usage);
    const stateMessage = accountStorageStateMessage(meter);

    return (
        <div className="space-y-5">
            {data ? (
                <div className="rounded-md border border-border p-4">
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="text-foreground/60">
                            {tr("基础")} {meter.baseLabel}
                            {meter.purchasedLabel ? tr(" + 扩容 {0}", meter.purchasedLabel) : ""}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground/75">
                            {meter.usedLabel} / {meter.totalLabel}
                        </span>
                    </div>
                    <Progress percent={Math.round(meter.percent)} size="small" showInfo={false} status={meter.state !== "ok" || meter.full ? "exception" : "normal"} />
                    {stateMessage ? <div className="mt-2 text-xs text-status-error">{stateMessage}</div> : null}
                </div>
            ) : null}

            <Form form={form} layout="inline" className="flex flex-wrap gap-y-2">
                <Form.Item name="storageGB" label={tr("容量（GB）")} rules={[{ required: true }, { type: "integer", min: 1, max: 100_000, message: "1-100000 GB" }]}>
                    <InputNumber min={1} max={100_000} precision={0} />
                </Form.Item>
                <Form.Item name="durationDays" label={tr("有效天数")} tooltip={tr("0 表示永久有效")} rules={[{ required: true }, { type: "integer", min: 0, max: 3650, message: tr("0-3650 天") }]}>
                    <InputNumber min={0} max={3650} precision={0} />
                </Form.Item>
                <Form.Item name="note" rules={[{ max: 500 }]}>
                    <Input placeholder={tr("备注（可选）")} />
                </Form.Item>
                <Button type="primary" loading={granting} onClick={() => void grant()}>
                    {tr("赠送空间")}
                </Button>
            </Form>

            <AdminDataTable
                table={{
                    rowKey: "id",
                    size: "small",
                    dataSource: data?.grants || [],
                    pagination: false,
                    columns: [
                        { title: tr("生效时间"), dataIndex: "startsAt", width: 150, render: (value) => formatStorageDate(value) },
                        { title: tr("来源"), key: "source", width: 160, ellipsis: true, render: (_, item) => item.productName || (item.source === "admin" ? tr("管理员赠送") : item.source) },
                        { title: tr("容量"), dataIndex: "bytes", width: 100, align: "right", render: (value) => `+${formatStorageCapacity(value)}` },
                        { title: tr("有效期"), key: "duration", width: 170, render: (_, item) => (item.expiresAt ? tr("{0} · {1} 到期", formatStorageDuration(item.durationDays), formatStorageDate(item.expiresAt)) : tr("永久有效")) },
                        {
                            title: tr("状态"),
                            key: "status",
                            width: 90,
                            render: (_, item) =>
                                item.revokedAt ? <AdminStatusBadge label={tr("已撤销")} tone="neutral" /> : storageGrantActive(item) ? <AdminStatusBadge label={tr("生效中")} tone="success" /> : <AdminStatusBadge label={tr("已到期")} tone="neutral" />,
                        },
                        { title: tr("备注"), key: "note", ellipsis: true, render: (_, item) => (item.revokeReason ? tr("撤销：{0}", item.revokeReason) : item.note || "--") },
                        {
                            title: tr("操作"),
                            key: "actions",
                            width: 80,
                            align: "center",
                            render: (_, item) =>
                                !item.revokedAt && storageGrantActive(item) ? (
                                    <Button size="small" danger onClick={() => revoke(item)}>
                                        {tr("撤销")}
                                    </Button>
                                ) : null,
                        },
                    ],
                    scroll: { x: 860 },
                }}
                empty={<AdminTableEmpty />}
            />
        </div>
    );
}
