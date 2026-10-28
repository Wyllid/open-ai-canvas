import { tr } from "@/i18n";
import { useRef, useState } from "react";
import { App, Button } from "antd";
import { ArrowUpRight, FolderOpen, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import { createCanvasProjectWithRemoteSync, hasRemoteUserDataSyncSession, saveRemoteUserDataNow } from "@/services/user-data-sync";

/** Agent 依赖真实画布 ID，先完成服务端保存，再进入同一个画布 Agent。 */
export function CreationAgentEntry() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);
    const created = useRef<{ id: string; userId: string } | null>(null);
    const start = async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        const userId = useUserStore.getState().user?.id;
        try {
            if (!userId || !hasRemoteUserDataSyncSession()) throw new Error(tr("登录或同步会话尚未就绪，请稍后重试。"));
            if (!hydrated) throw new Error(tr("画布还在恢复中，请稍后重试。"));
            if (created.current?.userId !== userId) created.current = null;
            if (!created.current) {
                const result = await createCanvasProjectWithRemoteSync(tr("Agent 创作"));
                if (!result.id) throw new Error(tr("画布创建未返回有效 ID，请重试。"));
                created.current = { id: result.id, userId };
                if (result.syncError) throw new Error(tr("画布已缓存在本机，但云端尚未保存。请重试同步后再启动 Agent。"));
            } else {
                await saveRemoteUserDataNow(created.current.id);
            }
            if (useUserStore.getState().user?.id !== userId) return;
            navigate(`/canvas/${encodeURIComponent(created.current.id)}?agent=1`);
        } catch (cause) {
            if (useUserStore.getState().user?.id === userId) {
                const detail = cause instanceof Error ? cause.message : tr("启动失败，请重试。");
                setError(detail);
                message.error(detail);
            }
        } finally { lock.current = false; setBusy(false); }
    };
    return <section className="creation-agent-entry" aria-label={tr("画布 Agent 模式")}>
        <div className="creation-agent-orb" aria-hidden><FluidOrb size={88} /></div>
        <div className="creation-agent-copy"><span className="creation-agent-eyebrow">CANVAS AGENT</span><h2>{tr("不止回答，把想法落到画布上")}</h2><p>{tr("使用画布里的同一个 Agent，结合素材、技能与创作上下文协作。生成与修改仍需经过你的审批。")}</p></div>
        <div className="creation-agent-actions"><Button type="primary" icon={<Sparkles />} loading={busy} disabled={!hydrated} onClick={() => void start()}>{created.current ? tr("重试同步并进入") : tr("新建画布，与 Agent 创作")}<ArrowUpRight /></Button><Button icon={<FolderOpen />} disabled={busy} onClick={() => navigate("/canvas?agent=1")}>{tr("在已有画布中继续")}</Button></div>
        {error ? <p className="creation-agent-error" role="alert">{error}</p> : null}
    </section>;
}
