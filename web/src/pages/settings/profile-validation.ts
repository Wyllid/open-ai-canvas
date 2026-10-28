import { tr } from "@/i18n";
export const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function profileAvatarError(file: Pick<File, "type" | "size">): string | undefined {
    if (file.type !== "image/png" && file.type !== "image/jpeg") return tr("请选择 PNG 或 JPEG 图片");
    if (!file.size) return tr("图片文件不能为空");
    if (file.size > PROFILE_AVATAR_MAX_BYTES) return tr("图片大小不能超过 5 MB");
}

export function profilePasswordError(password: string): string | undefined {
    if ([...password].length < 12) return tr("密码至少需要 12 个字符");
    if (new TextEncoder().encode(password).length > 72) return tr("密码不能超过 72 字节，请缩短密码");
}
