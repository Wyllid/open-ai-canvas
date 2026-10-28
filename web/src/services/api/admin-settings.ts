import { http } from "@/services/api/request";

export type LinuxDOSetting = {
    enabled: boolean;
    clientId: string;
    clientSecret?: string;
    hasClientSecret: boolean;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    redirectUrl: string;
    scopes: string[];
    clientAuthMethod: "client_secret_post" | "client_secret_basic";
    subjectField: string;
    usernameField: string;
    displayNameField: string;
    emailField: string;
    avatarField: string;
    updatedAt?: string;
};

export type RegistrationSetting = {
    enabled: boolean;
    agreementTitle?: string;
    agreementContent?: string;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type EmailSetting = {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password?: string;
    encryption: "starttls" | "tls" | "none";
    fromEmail: string;
    fromName: string;
    fromNameInherited: boolean;
    hasPassword: boolean;
    registrationAllowedDomains: string[];
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export function getAdminLinuxDOSetting() {
    return http.get<{ setting: LinuxDOSetting }>("/admin/settings/linuxdo");
}

export function updateAdminLinuxDOSetting(input: Partial<LinuxDOSetting>) {
    return http.patch<{ setting: LinuxDOSetting }>("/admin/settings/linuxdo", input);
}

export function getAdminRegistrationSetting() {
    return http.get<{ setting: RegistrationSetting }>("/admin/settings/registration");
}

export function updateAdminRegistrationSetting(input: { enabled: boolean; agreementTitle?: string; agreementContent?: string } | boolean) {
    const payload = typeof input === "boolean" ? { enabled: input } : input;
    return http.patch<{ setting: RegistrationSetting }>("/admin/settings/registration", payload);
}

export function getAdminEmailSetting() {
    return http.get<{ setting: EmailSetting }>("/admin/settings/email");
}

export function updateAdminEmailSetting(input: Partial<EmailSetting>) {
    return http.patch<{ setting: EmailSetting }>("/admin/settings/email", input);
}

