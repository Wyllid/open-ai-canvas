import { tr } from "@/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Avatar, Button, Form, Input, Skeleton } from "antd";
import { Crop, ImagePlus, KeyRound } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";

import { UserAvatar } from "@/components/layout/user-avatar";
import { ImageCropDialog, type ImageCropRect } from "@/components/image-crop-dialog";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { DEFAULT_USER_AVATARS } from "@/lib/default-user-avatars";
import { cropProfileAvatar } from "@/services/profile-avatar";
import { loadProfileSession } from "@/services/profile-session";
import { applyUserSession } from "@/lib/user-session";
import { invalidateAuthSessionCache, type LocalUser } from "@/services/api/auth";
import { changeLocalAccount, selectDefaultProfileAvatar, uploadProfileAvatar, type UserProfile } from "@/services/api/profile";
import { useUserStore } from "@/stores/use-user-store";
import { profileAvatarError, profilePasswordError } from "./profile-validation";
import "./profile-pane.css";

type AccountFields = { username: string; newPassword?: string; confirmPassword?: string; currentPassword: string };
type PendingAction = "crop-avatar" | "avatar" | "reset-avatar" | "account";
type AvatarTab = "upload" | "preset";

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** The signed-in account: avatar, plus the username and password of the local administrator. */
export function ProfilePane() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const queryKey = ["user-profile", userId];
    const profileQuery = useQuery({ queryKey, queryFn: ({ signal }) => loadProfileSession(userId, signal), enabled: !!userId, retry: false, refetchOnWindowFocus: false, staleTime: 0 });
    const profile = profileQuery.data;
    const [accountForm] = Form.useForm<AccountFields>();
    const [pending, setPending] = useState<PendingAction | null>(null);
    const pendingRef = useRef(false);
    const [errors, setErrors] = useState({ avatar: "", account: "" });
    const [draftAvatar, setDraftAvatar] = useState<{ file: File; url: string; sourceFile: File } | null>(null);
    const [cropSource, setCropSource] = useState<{ file: File; url: string } | null>(null);
    const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
    const [avatarTab, setAvatarTab] = useState<AvatarTab>("upload");
    const [defaultAvatarDraft, setDefaultAvatarDraft] = useState("person");
    const cropGeneration = useRef(0);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(
        () => () => {
            if (draftAvatar) URL.revokeObjectURL(draftAvatar.url);
        },
        [draftAvatar],
    );

    useEffect(
        () => () => {
            if (cropSource) URL.revokeObjectURL(cropSource.url);
        },
        [cropSource],
    );

    useEffect(
        () => () => {
            cropGeneration.current += 1;
        },
        [],
    );

    const setError = (section: keyof typeof errors, value: string) => setErrors((current) => ({ ...current, [section]: value }));
    const begin = (action: PendingAction) => {
        if (pendingRef.current) return false;
        pendingRef.current = true;
        setPending(action);
        return true;
    };
    const end = () => {
        pendingRef.current = false;
        setPending(null);
    };

    const updateAvatarUser = (user: LocalUser) => {
        if (useUserStore.getState().user?.id !== userId || user.id !== userId) return;
        invalidateAuthSessionCache();
        useUserStore.getState().setUser(user);
        queryClient.setQueryData<UserProfile>(queryKey, (current) => (current ? { ...current, user } : current));
        setDraftAvatar(null);
        setCropSource(null);
        setAvatarDialogOpen(false);
    };

    const openAvatarDialog = () => {
        if (!profile) return;
        setAvatarTab(profile.user.avatarMode === "default" ? "preset" : "upload");
        setDefaultAvatarDraft(profile.user.avatarPreset || "person");
        setError("avatar", "");
        setAvatarDialogOpen(true);
    };

    const closeAvatarDialog = () => {
        if (pendingRef.current) return;
        cropGeneration.current += 1;
        setCropSource(null);
        setDraftAvatar(null);
        setAvatarDialogOpen(false);
        setError("avatar", "");
    };

    const selectAvatar = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const error = profileAvatarError(file);
        setError("avatar", error || "");
        if (error) return;
        setCropSource({ file, url: URL.createObjectURL(file) });
    };

    const confirmAvatarCrop = async (crop: ImageCropRect) => {
        if (!cropSource || !begin("crop-avatar")) return;
        const source = cropSource;
        const generation = cropGeneration.current;
        setError("avatar", "");
        try {
            const file = await cropProfileAvatar(source.url, crop, source.file.name);
            if (cropGeneration.current !== generation || useUserStore.getState().user?.id !== userId) return;
            setDraftAvatar({ file, url: URL.createObjectURL(file), sourceFile: source.file });
            setCropSource(null);
        } catch (error) {
            if (cropGeneration.current !== generation) return;
            const msg = errorMessage(error, tr("裁剪头像失败，请重试"));
            setError("avatar", msg);
            message.error(msg);
        } finally {
            end();
        }
    };

    const saveAvatar = async () => {
        if (!draftAvatar || !begin("avatar")) return;
        setError("avatar", "");
        try {
            // 取消仍在加载的旧资料，避免写入成功后被旧头像响应覆盖。
            await queryClient.cancelQueries({ queryKey });
            const { user } = await uploadProfileAvatar(draftAvatar.file);
            await queryClient.cancelQueries({ queryKey });
            updateAvatarUser(user);
            message.success(tr("头像已保存"));
        } catch (error) {
            setError("avatar", errorMessage(error, tr("保存头像失败，请重试")));
        } finally {
            end();
        }
    };

    const saveDefaultAvatar = async () => {
        if (!begin("reset-avatar")) return;
        setError("avatar", "");
        try {
            await queryClient.cancelQueries({ queryKey });
            const { user } = await selectDefaultProfileAvatar(defaultAvatarDraft);
            await queryClient.cancelQueries({ queryKey });
            updateAvatarUser(user);
            message.success(tr("已使用选择的系统头像"));
        } catch (error) {
            setError("avatar", errorMessage(error, tr("保存头像失败，请重试")));
        } finally {
            end();
        }
    };

    const finishAccountChange = async (notice: string) => {
        if (useUserStore.getState().user?.id !== userId) return;
        invalidateAuthSessionCache();
        accountForm.resetFields();
        try {
            await applyUserSession({ user: null });
            message.success({ content: notice, duration: 6 });
        } catch (error) {
            useUserStore.getState().clearSession();
            useUserStore.getState().setHydrated(true);
            message.error({ content: tr("{0} 清理本地会话失败：{1}", notice, errorMessage(error, tr("请重新登录"))), duration: 8 });
        } finally {
            navigate("/login", { replace: true });
        }
    };

    const saveAccount = async (values: AccountFields) => {
        if (!begin("account")) return;
        setError("account", "");
        try {
            await changeLocalAccount({ currentPassword: values.currentPassword, username: values.username.trim(), newPassword: values.newPassword || "" });
            await finishAccountChange(tr("账号已更新，所有登录会话已退出，请使用新的用户名和密码登录"));
        } catch (error) {
            setError("account", errorMessage(error, tr("保存账号失败，请重试")));
        } finally {
            end();
        }
    };

    return (
        <div className="profile-pane">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>{tr("账号")}</h2>
                    <p>{tr("管理头像、用户名和登录密码。")}</p>
                </div>
            </div>
            {profileQuery.isPending ? (
                <Skeleton active paragraph={{ rows: 7 }} />
            ) : profileQuery.isError ? (
                <Callout
                    tone="error"
                    title={tr("个人信息加载失败")}
                    role="alert"
                    action={
                        <Button size="small" onClick={() => void profileQuery.refetch()}>
                            {tr("重试")}
                        </Button>
                    }
                >
                    {errorMessage(profileQuery.error, tr("请稍后重试"))}
                </Callout>
            ) : profile ? (
                <div className="profile-sections">
                    <section className="profile-overview" aria-labelledby="profile-avatar-title">
                        <div className="profile-overview-heading">
                            <h3 id="profile-avatar-title">{tr("头像")}</h3>
                            <p>{tr("头像会同步显示在工作区和创作消息中。")}</p>
                        </div>
                        <div className="profile-overview-main">
                            <UserAvatar user={profile.user} className="profile-avatar-preview" />
                            <div className="profile-overview-identity">
                                <strong>{profile.user.displayName || profile.user.username}</strong>
                                <span>
                                    {tr("账号 ·")} {profile.user.username}
                                </span>
                            </div>
                            <Button type="primary" icon={<ImagePlus className="size-4" />} disabled={!!pending} onClick={openAvatarDialog}>
                                {tr("更换头像")}
                            </Button>
                        </div>
                    </section>

                    <section className="profile-security-card" aria-labelledby="profile-account-title">
                        <div className="profile-card-heading">
                            <span className="profile-card-icon">
                                <KeyRound className="size-5" />
                            </span>
                            <div>
                                <h4 id="profile-account-title">{tr("用户名与密码")}</h4>
                                <p>{tr("保存后所有设备上的登录会话都会退出。")}</p>
                            </div>
                        </div>
                        <Callout tone="info" className="profile-feedback">
                            {tr("首次登录使用服务器 .env 中的 CANVAS_ADMIN_USERNAME 和 CANVAS_ADMIN_PASSWORD。在这里修改后，重启服务也会保留；忘记密码时，修改 .env 中这两个值并重启即可恢复访问。")}
                        </Callout>
                        <Form
                            form={accountForm}
                            name="profile-account"
                            layout="vertical"
                            requiredMark={false}
                            className="profile-form"
                            disabled={!!pending}
                            initialValues={{ username: profile.user.username }}
                            onFinish={(values) => void saveAccount(values)}
                            onValuesChange={() => setError("account", "")}
                        >
                            <Form.Item
                                name="username"
                                label={tr("用户名")}
                                rules={[
                                    { required: true, whitespace: true, message: tr("请输入用户名") },
                                    { pattern: /^[A-Za-z0-9_-]{3,32}$/, message: tr("3-32 位字母、数字、下划线或连字符") },
                                ]}
                            >
                                <Input autoComplete="username" />
                            </Form.Item>
                            <Form.Item
                                name="newPassword"
                                label={tr("新密码（不修改请留空）")}
                                rules={[
                                    {
                                        validator: async (_, value: string = "") => {
                                            const error = value ? profilePasswordError(value) : undefined;
                                            if (error) throw new Error(error);
                                        },
                                    },
                                ]}
                            >
                                <Input.Password autoComplete="new-password" placeholder={tr("至少 12 个字符")} />
                            </Form.Item>
                            <Form.Item
                                name="confirmPassword"
                                label={tr("确认新密码")}
                                dependencies={["newPassword"]}
                                rules={[
                                    {
                                        validator: async (_, value) => {
                                            if ((value || "") !== (accountForm.getFieldValue("newPassword") || "")) throw new Error(tr("两次输入的密码不一致"));
                                        },
                                    },
                                ]}
                            >
                                <Input.Password autoComplete="new-password" />
                            </Form.Item>
                            <Form.Item name="currentPassword" label={tr("当前密码")} rules={[{ required: true, message: tr("请输入当前密码") }]}>
                                <Input.Password autoComplete="current-password" />
                            </Form.Item>
                            {errors.account ? (
                                <Callout tone="error" role="alert" className="profile-feedback">
                                    {errors.account}
                                </Callout>
                            ) : null}
                            <Button type="primary" htmlType="submit" loading={pending === "account"} disabled={!!pending}>
                                {tr("保存账号")}
                            </Button>
                        </Form>
                    </section>
                </div>
            ) : null}
            {profile ? (
                <AppModal
                    open={avatarDialogOpen}
                    centered
                    width={560}
                    title={tr("更换头像")}
                    okText={tr("保存头像")}
                    confirmLoading={pending === "avatar" || pending === "reset-avatar"}
                    okButtonProps={{ disabled: !!pending || (avatarTab === "upload" ? !draftAvatar : profile.user.avatarMode === "default" && (profile.user.avatarPreset || "person") === defaultAvatarDraft) }}
                    cancelButtonProps={{ disabled: !!pending }}
                    closable={!pending}
                    keyboard={!pending}
                    mask={{ closable: !pending }}
                    onCancel={closeAvatarDialog}
                    onOk={() => void (avatarTab === "upload" ? saveAvatar() : saveDefaultAvatar())}
                >
                    <div className="profile-avatar-dialog-body">
                        <SegmentedControl<AvatarTab>
                            block
                            ariaLabel={tr("头像来源")}
                            value={avatarTab}
                            disabled={!!pending}
                            options={[
                                { value: "upload", label: tr("上传图片") },
                                { value: "preset", label: tr("系统头像") },
                            ]}
                            onChange={(tab) => {
                                setAvatarTab(tab);
                                setError("avatar", "");
                            }}
                        />
                        {avatarTab === "upload" ? (
                            <div className="profile-avatar-upload">
                                {draftAvatar ? (
                                    <img
                                        className="profile-avatar-dialog-preview"
                                        src={draftAvatar.url}
                                        alt={tr("待保存的头像预览")}
                                        onError={() => {
                                            setDraftAvatar(null);
                                            setError("avatar", tr("无法读取图片，请选择有效的 PNG 或 JPEG 图片"));
                                        }}
                                    />
                                ) : (
                                    <UserAvatar user={profile.user} className="profile-avatar-dialog-preview" />
                                )}
                                <div className="profile-avatar-upload-controls">
                                    <p className="profile-avatar-upload-title">{draftAvatar ? tr("裁剪后的头像") : tr("当前头像")}</p>
                                    <p className="profile-hint">{tr("选择 PNG 或 JPEG 图片，可裁剪为正方形；文件最大 5 MiB。")}</p>
                                    <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden aria-label={tr("选择头像图片")} onChange={selectAvatar} disabled={!!pending} />
                                    <div className="profile-actions">
                                        <Button icon={<ImagePlus className="size-4" />} disabled={!!pending} onClick={() => fileInput.current?.click()}>
                                            {draftAvatar ? tr("重新选择") : tr("选择图片")}
                                        </Button>
                                        {draftAvatar ? (
                                            <Button icon={<Crop className="size-4" />} disabled={!!pending} onClick={() => setCropSource({ file: draftAvatar.sourceFile, url: URL.createObjectURL(draftAvatar.sourceFile) })}>
                                                {tr("调整裁剪")}
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="profile-hint">{tr("选择一款系统头像，保存后会同步到工作区。")}</p>
                                <div className="profile-default-avatar-grid" role="group" aria-label={tr("系统头像")}>
                                    {DEFAULT_USER_AVATARS.map((preset) => (
                                        <button key={preset.id} type="button" className="profile-default-avatar-choice" aria-pressed={defaultAvatarDraft === preset.id} disabled={!!pending} onClick={() => setDefaultAvatarDraft(preset.id)}>
                                            <Avatar size={56} className="profile-default-avatar-icon" icon={<UserAvatar user={{ ...profile.user, avatarUrl: undefined, avatarMode: "default", avatarPreset: preset.id }} className="size-8" />} />
                                            <span>{preset.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        {errors.avatar ? (
                            <Callout tone="error" role="alert" className="profile-feedback">
                                {errors.avatar}
                            </Callout>
                        ) : null}
                    </div>
                </AppModal>
            ) : null}
            {cropSource ? (
                <ImageCropDialog
                    dataUrl={cropSource.url}
                    open
                    title={tr("裁剪头像")}
                    fixedAspect={1}
                    confirmLoading={pending === "crop-avatar"}
                    onClose={() => {
                        if (!pendingRef.current) setCropSource(null);
                    }}
                    onConfirm={(crop) => void confirmAvatarCrop(crop)}
                />
            ) : null}
        </div>
    );
}
