import type { LocalUser } from "./auth";
import { http } from "./request";

export type UserProfile = {
    user: LocalUser;
    hasPassword: boolean;
    emailEnabled: boolean;
    linuxdoEnabled: boolean;
    reauthenticatedUntil?: string;
};

export const getUserProfile = (signal?: AbortSignal) => http.get<UserProfile>("/auth/profile", { signal });

export function uploadProfileAvatar(file: File) {
    const data = new FormData();
    data.append("file", file);
    return http.put<{ user: LocalUser }>("/auth/profile/avatar", data);
}

export const resetProfileAvatar = () => http.delete<{ user: LocalUser }>("/auth/profile/avatar");
export const selectDefaultProfileAvatar = (preset: string) => http.post<{ user: LocalUser }>("/auth/profile/avatar/default", { preset });
/** Renames the account and/or sets a new password; the server then signs out every session. */
export const changeLocalAccount = (input: { currentPassword: string; username: string; newPassword: string }) => http.post<{ changed: true }>("/auth/profile/account", input);
