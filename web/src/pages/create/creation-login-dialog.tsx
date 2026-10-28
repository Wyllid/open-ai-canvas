import { useEffect, useState, type FormEvent } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { getAuthSession, login } from "@/services/api/auth";

export function CreationLoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) {
            setUsername("");
            setPassword("");
            setSubmitting(false);
        }
    }, [open]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            await login({ username: username.trim(), password });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success("Signed in. You can keep creating.");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Sign-in failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AppModal open={open} onCancel={onClose} title="Sign in to start creating" footer={null} centered width="min(440px, calc(100vw - 32px))">
            <div className="space-y-4">
                <p className="text-sm text-foreground/60">Your work is kept. After you sign in you can continue or create a canvas.</p>
                <form className="space-y-3" onSubmit={(event) => void submit(event)}>
                    <Input
                        size="large"
                        aria-label="Username"
                        prefix={<UserRound className="size-4 text-foreground/40" />}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="Username"
                        autoComplete="username"
                        required
                    />
                    <Input.Password
                        size="large"
                        aria-label="Password"
                        prefix={<LockKeyhole className="size-4 text-foreground/40" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Password"
                        autoComplete="current-password"
                        required
                    />
                    <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                        Sign in and continue
                    </Button>
                </form>
            </div>
        </AppModal>
    );
}
