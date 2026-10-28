import { tr } from "@/i18n";
import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { getAuthSession, login } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

/** Single local admin sign-in (credentials come from the server .env). The backend keeps the session in an HttpOnly cookie for 30 days. */
export default function LoginPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const next = safeNext(params.get("next"));
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        if (hydrated && user) {
            navigate(next, { replace: true });
        }
    }, [hydrated, user, next, navigate]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            await login({ username, password });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success(tr("Signed in"));
            navigate(next, { replace: true });
        } catch (error) {
            message.error(signInErrorMessage(error));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-5">
            <AuthField label={tr("Username")} htmlFor="login-account">
                <Input
                    id="login-account"
                    size="large"
                    prefix={<UserRound className="auth-scene-icon size-4" />}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={tr("Username")}
                    autoComplete="username"
                    autoFocus
                    required
                />
            </AuthField>
            <AuthField label={tr("Password")} htmlFor="login-password">
                <Input.Password
                    id="login-password"
                    size="large"
                    prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={tr("Password")}
                    autoComplete="current-password"
                    required
                />
            </AuthField>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {tr("Sign in")}
            </Button>
            <p className="auth-scene-muted pt-1 text-center text-xs leading-5">{tr("Access is managed by the server administrator.")}</p>
        </form>
    );
}

function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <label htmlFor={htmlFor} className="auth-scene-label text-xs font-medium">
                {label}
            </label>
            {children}
        </div>
    );
}

/** The server answers in Chinese; translate the sign-in failures this page can receive. */
function signInErrorMessage(error: unknown) {
    const text = error instanceof Error ? error.message : "";
    const retryAfter = /^请求次数已达上限，请在 (\d+) 秒后重试$/.exec(text);
    if (retryAfter) return tr("请求次数已达上限，请在 {0} 秒后重试", retryAfter[1]);
    switch (text) {
        case "用户名、邮箱或密码不正确":
            return tr("用户名、邮箱或密码不正确");
        case "该账号已被禁用":
            return tr("该账号已被禁用");
        case "管理员密码过于简单，只能从本机或内网登录。请从本机登录后在“账号”中设置至少 12 位的密码，或修改服务器 .env 中的 CANVAS_ADMIN_PASSWORD 并重启服务。":
            return tr("管理员密码过于简单，只能从本机或内网登录。请从本机登录后在“账号”中设置至少 12 位的密码，或修改服务器 .env 中的 CANVAS_ADMIN_PASSWORD 并重启服务。");
        default:
            return text || tr("Sign-in failed");
    }
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
