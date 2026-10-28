import { tr } from "@/i18n";
import { App, Button } from "antd";
import { Check, History, ListChecks, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/ui/base/badges";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { decideAgentMemoryProposal, listAgentMemoryProposals, listAgentMemoryRevisions, restoreAgentMemoryRevision, type AgentMemory, type AgentMemoryProposal, type AgentMemoryRevision } from "@/services/api/agent-memories";

const PROPOSAL_LABELS: Record<AgentMemoryProposal["status"], string> = {
    generating: tr("生成中"),
    pending: tr("待批准"),
    approved: tr("已应用"),
    rejected: tr("已拒绝"),
    no_changes: tr("无需修改"),
    failed: tr("生成失败"),
};

function MemorySnapshot({ memory }: { memory: AgentMemory }) {
    return (
        <article className="rounded-xl bg-surface-secondary p-3 text-caption leading-5">
            <h4 className="font-medium text-foreground">{memory.topic}</h4>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{memory.situation}</p>
            {memory.lesson ? <p className="mt-1 whitespace-pre-wrap text-foreground">{memory.lesson}</p> : null}
            {memory.steps?.length ? (
                <ol className="mt-1 ml-4 list-decimal text-muted-foreground">
                    {memory.steps.map((step, index) => (
                        <li key={`${memory.id}-${index}`}>
                            {step.action}
                            {step.note ? `（${step.note}）` : ""}
                        </li>
                    ))}
                </ol>
            ) : null}
            {memory.source ? (
                <p className="mt-2 text-muted-foreground">
                    {tr("来源：")}
                    {memory.source}
                </p>
            ) : null}
        </article>
    );
}

export function AgentMemoryProposalChanges({ proposal }: { proposal: AgentMemoryProposal }) {
    return (
        <div className="space-y-4">
            <Callout tone="info" title={proposal.status === "pending" ? tr("批准前不会改变记忆") : PROPOSAL_LABELS[proposal.status]}>
                {tr("原始来源和验证时间保持不变。批准时会重新检查记忆版本，已有新编辑则整批拒绝。")}
            </Callout>
            {proposal.changes.map((change, index) => (
                <section key={`${change.after.id}-${index}`} className="space-y-2">
                    <h3 className="text-sm font-medium text-foreground">{change.kind === "merge" ? tr("合并 {0} 条记忆", change.before.length) : tr("改写记忆")}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <p className="text-caption text-muted-foreground">{tr("修改前")}</p>
                            {change.before.map((memory) => (
                                <MemorySnapshot key={memory.id} memory={memory} />
                            ))}
                        </div>
                        <div className="space-y-2">
                            <p className="text-caption text-muted-foreground">{tr("修改后")}</p>
                            <MemorySnapshot memory={change.after} />
                        </div>
                    </div>
                </section>
            ))}
            {proposal.changes.length === 0 ? <p className="text-caption text-muted-foreground">{tr("此提案没有可应用的记忆变更。")}</p> : null}
        </div>
    );
}

export function AgentMemoryRevisionChanges({ revision }: { revision: AgentMemoryRevision }) {
    return (
        <div className="space-y-4">
            <Callout tone="info" title={revision.restoredAt ? tr("此版本已恢复") : tr("恢复压缩前的记忆")}>
                {tr("恢复会同时还原该批次的改写与合并。若记忆已被后续编辑、删除或重新创建，操作会被拒绝，保留新修改。")}
            </Callout>
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                    <p className="text-caption text-muted-foreground">{tr("压缩后的版本")}</p>
                    {revision.after.map((memory) => (
                        <MemorySnapshot key={memory.id} memory={memory} />
                    ))}
                </div>
                <div className="space-y-2">
                    <p className="text-caption text-muted-foreground">{tr("将恢复为")}</p>
                    {revision.before.map((memory) => (
                        <MemorySnapshot key={memory.id} memory={memory} />
                    ))}
                </div>
            </div>
        </div>
    );
}

export function AgentMemoryProposalPanel({ refreshKey, onApplied }: { refreshKey: string; onApplied: () => Promise<void> }) {
    const { message } = App.useApp();
    const [proposals, setProposals] = useState<AgentMemoryProposal[]>([]);
    const [revisions, setRevisions] = useState<AgentMemoryRevision[]>([]);
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<{ kind: "proposal" | "revision"; id: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const sequence = useRef(0);

    const load = useCallback(async (signal?: AbortSignal) => {
        const seq = ++sequence.current;
        setLoading(true);
        try {
            const [proposalData, revisionData] = await Promise.all([listAgentMemoryProposals(signal), listAgentMemoryRevisions(signal)]);
            if (seq !== sequence.current || signal?.aborted) return;
            setProposals(proposalData.proposals);
            setRevisions(revisionData.revisions);
            setError("");
        } catch (cause) {
            if (seq === sequence.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : tr("读取压缩提案失败"));
        } finally {
            if (seq === sequence.current && !signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load, refreshKey]);

    const proposal = selected?.kind === "proposal" ? proposals.find((item) => item.id === selected.id) : undefined;
    const revision = selected?.kind === "revision" ? revisions.find((item) => item.id === selected.id) : undefined;
    const pending = proposals.filter((item) => item.status === "pending").length;

    const decide = async (decision: "approve" | "reject") => {
        if (!proposal || busy) return;
        setBusy(true);
        setError("");
        try {
            await decideAgentMemoryProposal(proposal.id, decision, proposal.version);
            message.success(decision === "approve" ? tr("提案已应用，已保存恢复版本") : tr("已拒绝提案，原记忆未改变"));
            await Promise.all([load(), onApplied()]);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : tr("处理提案失败"));
        } finally {
            setBusy(false);
        }
    };

    const restore = async () => {
        if (!revision || busy) return;
        setBusy(true);
        setError("");
        try {
            await restoreAgentMemoryRevision(revision.id, revision.version);
            message.success(tr("已恢复该批次压缩前的记忆"));
            await Promise.all([load(), onApplied()]);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : tr("恢复失败"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-2">
            <Button
                size="small"
                icon={<ListChecks className="size-3.5" />}
                onClick={() => {
                    setOpen(true);
                    setSelected(null);
                    void load();
                }}
                loading={loading}
            >
                {pending ? tr("查看 {0} 个待审提案", pending) : tr("压缩提案与历史")}
            </Button>
            {error && !open ? (
                <p role="alert" className="text-caption text-status-error">
                    {error}
                </p>
            ) : null}
            <AppModal
                open={open}
                title={proposal ? tr("查看压缩提案") : revision ? tr("恢复记忆版本") : tr("压缩提案与历史")}
                width={800}
                footer={null}
                onCancel={() => {
                    if (!busy) setOpen(false);
                }}
            >
                <div className="space-y-4 pt-2">
                    {error ? (
                        <div role="alert">
                            <Callout tone="warning" title={tr("操作未完成")}>
                                {error}
                            </Callout>
                        </div>
                    ) : null}
                    {selected ? (
                        <Button size="small" disabled={busy} onClick={() => setSelected(null)}>
                            {tr("返回列表")}
                        </Button>
                    ) : null}
                    {proposal ? <AgentMemoryProposalChanges proposal={proposal} /> : null}
                    {proposal?.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                            <Button icon={<X className="size-3.5" />} disabled={busy} onClick={() => void decide("reject")}>
                                {tr("拒绝提案")}
                            </Button>
                            <Button type="primary" icon={<Check className="size-3.5" />} loading={busy} onClick={() => void decide("approve")}>
                                {tr("批准并应用")}
                            </Button>
                        </div>
                    ) : null}
                    {revision ? <AgentMemoryRevisionChanges revision={revision} /> : null}
                    {revision && !revision.restoredAt ? (
                        <div className="flex justify-end">
                            <Button type="primary" icon={<RotateCcw className="size-3.5" />} loading={busy} onClick={() => void restore()}>
                                {tr("恢复压缩前版本")}
                            </Button>
                        </div>
                    ) : null}
                    {!selected ? (
                        <>
                            <section className="space-y-2">
                                <h3 className="text-sm font-medium text-foreground">{tr("压缩提案")}</h3>
                                {proposals.length === 0 ? <p className="text-caption text-muted-foreground">{tr("生成压缩提案后，可在这里检查并批准。")}</p> : null}
                                {proposals.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-2"
                                        onClick={() => setSelected({ kind: "proposal", id: item.id })}
                                    >
                                        <span className="text-caption text-foreground">
                                            {new Date(item.createdAt).toLocaleString()} · {tr("{0} 项变更", item.changes.length)}
                                        </span>
                                        <StatusBadge size="sm" tone={item.status === "pending" ? "warning" : item.status === "approved" ? "success" : "neutral"} label={PROPOSAL_LABELS[item.status]} />
                                    </button>
                                ))}
                            </section>
                            <section className="space-y-2">
                                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                                    <History className="size-4" />
                                    {tr("可恢复版本")}
                                </h3>
                                {revisions.length === 0 ? <p className="text-caption text-muted-foreground">{tr("批准应用压缩后，会自动保留修改前的版本。")}</p> : null}
                                {revisions.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-secondary p-3 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-2"
                                        onClick={() => setSelected({ kind: "revision", id: item.id })}
                                    >
                                        <span className="text-caption text-foreground">
                                            {new Date(item.createdAt).toLocaleString()} · {tr("{0} 条原始记忆", item.before.length)}
                                        </span>
                                        <span className="text-caption text-muted-foreground">{item.restoredAt ? tr("已恢复") : tr("查看与恢复")}</span>
                                    </button>
                                ))}
                            </section>
                        </>
                    ) : null}
                </div>
            </AppModal>
        </div>
    );
}
