import { tr } from "@/i18n";
export const DEFAULT_USER_AVATARS = [
    { id: "person", label: tr("默认人像") },
    { id: "director", label: tr("导演") },
    { id: "camera", label: tr("摄影师") },
    { id: "cat", label: tr("小猫") },
    { id: "rabbit", label: tr("小兔") },
    { id: "robot", label: tr("机器人") },
    { id: "rocket", label: tr("探索者") },
    { id: "sparkles", label: tr("灵感") },
] as const;

export type DefaultUserAvatarID = (typeof DEFAULT_USER_AVATARS)[number]["id"];

export function isDefaultUserAvatarID(value: unknown): value is DefaultUserAvatarID {
    return DEFAULT_USER_AVATARS.some((avatar) => avatar.id === value);
}
