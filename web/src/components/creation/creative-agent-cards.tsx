import { tr } from "@/i18n";
import { useId, useRef, useState } from "react";
import { Alert, Button, Checkbox, Dropdown, Input, Popover, Radio, Tag } from "antd";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { validateCreativeAnswers, type CreativeAnswers, type CreativeAssetOption, type CreativePlan, type CreativeProposal, type CreativeQuestionRequest, type CreativeQuote } from "@/lib/creation/creative-agent-contract";
import "./creative-agent-cards.css";

export type CreativeQuestionCardProps = {
    request: CreativeQuestionRequest; answers: CreativeAnswers; onAnswersChange: (answers: CreativeAnswers) => void;
    onSubmit: (answers: CreativeAnswers) => void | Promise<void>; onModify?: () => void; assets: CreativeAssetOption[]; busy?: boolean; disabled?: boolean; error?: string;
};
export function CreativeQuestionCard({ request, answers, onAnswersChange, onSubmit, onModify, assets, busy, disabled, error }: CreativeQuestionCardProps) {
    const [page, setPage] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const detailId = useId();
    const [localError, setLocalError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const currentPage = Math.min(page, Math.max(request.questions.length - 1, 0));
    const question = request.questions[currentPage];
    if (!question) return null;
    const answer = answers[question.id] ?? { selected: [], custom: "" };
    const locked = request.status !== "pending" || busy || disabled || submitting;
    const options = question.type === "asset" ? assets : question.options;
    const archived = request.status !== "pending";
    const summary = request.questions.map((item) => {
        const value = answers[item.id];
        const choices = item.type === "asset" ? assets : item.options;
        return value ? [...value.selected.map((id) => choices.find((option) => option.id === id)?.label ?? tr("素材已不可用")), value.custom].filter(Boolean).join("、") : "";
    }).filter(Boolean).join(" · ") || tr("{0} 项创作信息", request.questions.length);
    const change = (patch: Partial<typeof answer>) => { setLocalError(""); onAnswersChange({ ...answers, [question.id]: { ...answer, ...patch } }); };
    const move = (index: number) => { setPage(index); requestAnimationFrame(() => headingRef.current?.focus()); };
    const submit = async () => {
        const invalid = validateCreativeAnswers(request, answers, assets);
        if (invalid) { setLocalError(invalid.message); move(request.questions.findIndex((item) => item.id === invalid.questionId)); return; }
        setSubmitting(true); setLocalError("");
        try { await onSubmit(answers); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : tr("提交失败，请重试")); } finally { setSubmitting(false); }
    };
    return <section className="creative-agent-card creative-agent-question-card" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={tr("需求问答")}>
        {archived && <div className="creative-agent-archive-row"><span className="creative-agent-archive-summary" title={summary}>{request.status === "submitted" ? tr("已回答") : tr("已更新")} · {summary}</span><Button type="text" size="small" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? tr("收起") : tr("查看")}</Button>{onModify && <Button type="text" size="small" disabled={busy} onClick={onModify}>{tr("修改")}</Button>}</div>}
        {(!archived || expanded) && <div id={detailId} className="creative-agent-card-content">
        <div className="creative-agent-card-row creative-agent-overline"><span>{tr("补充创作信息 ·")} {currentPage + 1}/{request.questions.length}</span><span className="creative-agent-step-dots" aria-hidden="true">{request.questions.map((item, index) => <i key={item.id} data-current={index === currentPage} />)}</span></div>
        {request.status === "submitted" ? <Tag>{tr("已提交")}</Tag> : request.status === "superseded" ? <Tag>{tr("已更新，请使用新问题")}</Tag> : null}
        <h3 ref={headingRef} tabIndex={-1}>{question.title}</h3>
        {question.description && <p className="creative-agent-muted">{question.description}</p>}
        <div className="creative-agent-options">
            {options.map((option) => <label className="creative-agent-option" key={option.id} data-selected={answer.selected.includes(option.id)} data-disabled={Boolean(locked)}>
                {question.type === "single" ? <Radio checked={answer.selected.includes(option.id)} disabled={locked} onChange={() => change({ selected: [option.id], custom: "" })} /> : <Checkbox checked={answer.selected.includes(option.id)} disabled={locked} onChange={(event) => change({ selected: event.target.checked ? [...answer.selected, option.id] : answer.selected.filter((id) => id !== option.id) })} />}
                <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
            </label>)}
        </div>
        {question.type === "asset" && !assets.length && <p className="creative-agent-muted">{tr("暂无可用素材，请先添加素材或补充说明。")}</p>}
        {question.allowCustom && <label className="creative-agent-custom-answer"><span>{question.type === "text" ? tr("你的想法") : tr("也可以自定义或补充")}</span><Input.TextArea aria-label={question.type === "text" ? question.title : tr("自定义回答")} value={answer.custom} disabled={locked} autoSize={{ minRows: 2, maxRows: 6 }} onChange={(event) => change({ custom: event.target.value, ...(question.type === "single" ? { selected: [] } : {}) })} placeholder={tr("补充你的想法")} /></label>}
        {(error || localError) && <Alert type="error" title={error || localError} showIcon />}
        <div className="creative-agent-actions">
            <Button disabled={currentPage === 0} onClick={() => move(currentPage - 1)}>{tr("上一题")}</Button>
            {currentPage < request.questions.length - 1 ? <Button type={archived ? "default" : "primary"} onClick={() => move(currentPage + 1)}>{tr("下一题")}</Button> : !archived && <Button type="primary" disabled={locked} loading={busy || submitting} onClick={() => void submit()}>{tr("提交回答")}</Button>}
            {!question.required && !locked && <Button type="text" onClick={() => { change({ selected: [], custom: "" }); if (currentPage < request.questions.length - 1) move(currentPage + 1); }}>{tr("跳过")}</Button>}
        </div>
        {request.status === "submitted" && <p className="creative-agent-muted">{[...answer.selected.map((id) => options.find((option) => option.id === id)?.label ?? tr("素材已不可用")), answer.custom].filter(Boolean).join("、") || tr("已跳过")}</p>}
        </div>}
    </section>;
}

export type CreativeProposalCardProps = { proposal: CreativeProposal; onApprove: () => void; onModify: () => void; onRedirect: () => void; busy?: boolean; disabled?: boolean; archived?: boolean; modifiable?: boolean };
export function CreativeProposalCard({ proposal, onApprove, onModify, onRedirect, busy, disabled, archived, modifiable }: CreativeProposalCardProps) {
    const [detailExpanded, setDetailExpanded] = useState(false);
    const [archivedExpanded, setArchivedExpanded] = useState(false);
    const expanded = archived ? archivedExpanded : detailExpanded;
    const setExpanded = archived ? setArchivedExpanded : setDetailExpanded;
    const detailId = useId();
    return <section className="creative-agent-card creative-agent-proposal-card" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={tr("创意方案")}>
        {archived ? <div className="creative-agent-archive-row"><strong className="creative-agent-archive-summary" title={proposal.title}>{proposal.title} · v{proposal.version}</strong><Button type="text" size="small" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? tr("收起方案") : tr("查看方案")}</Button>{modifiable && <Button type="text" size="small" disabled={disabled || busy} onClick={onModify}>{tr("修改")}</Button>}</div> : <div className="creative-agent-card-row creative-agent-overline"><span>{tr("创意方案")}</span><span>{tr("版本")} {proposal.version}</span></div>}
        {(!archived || expanded) && <>
        <h3>{proposal.title}</h3>
        <p className="creative-agent-proposal-summary">{proposal.summary}</p>
        {proposal.deliverables.length > 0 && <ul className="creative-agent-deliverables">{proposal.deliverables.map((item, index) => <li key={index}><span>{tr("产物")} {index + 1}</span><strong>{item}</strong></li>)}</ul>}
        {!archived && <Button className="creative-agent-detail-toggle" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>{expanded ? tr("收起完整方案") : tr("查看完整方案")}</Button>}
        {expanded && <div id={detailId} className="creative-agent-detail"><AIMessageMarkdown>{proposal.markdown}</AIMessageMarkdown></div>}
        {!archived && <><div className="creative-agent-scope-note">{tr("确认后创建本阶段节点并准备参数；图片、视频等生成任务另行确认。")}</div>
        <div className="creative-agent-actions creative-agent-primary-actions"><Button type="primary" loading={busy} disabled={disabled || busy} onClick={onApprove}>{tr("确认方案")}</Button><Button disabled={disabled || busy} onClick={onModify}>{tr("修改")}</Button><Dropdown menu={{ items: [{ key: "redirect", label: tr("换个方向") }], onClick: onRedirect }} trigger={["click"]} disabled={disabled || busy}><Button disabled={disabled || busy}>{tr("更多")}</Button></Dropdown></div></>}
        </>}
    </section>;
}

const stepLabels = { pending: tr("待开始"), running: tr("处理中"), waiting: tr("等待你确认"), completed: tr("已完成"), failed: tr("失败"), cancelled: tr("已取消") };
export function CreativePlanBar({ plan, onLocateNode }: { plan?: CreativePlan | null; onLocateNode?: (nodeId: string) => void }) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const panelId = useId();
    if (!plan?.steps.length) return null;
    const completed = plan.steps.filter((step) => step.status === "completed").length;
    const running = plan.steps.filter((step) => step.status === "running").length;
    const current = plan.steps.find((step) => step.status === "running" || step.status === "waiting" || step.status === "failed");
    const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
    return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) trigger.current?.focus(); }} afterOpenChange={(next) => { if (next) panel.current?.focus(); }} placement="top" trigger="click" content={<div id={panelId} ref={panel} tabIndex={-1} className="creative-agent-plan" data-canvas-no-zoom data-canvas-wheel-scroll onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <div className="creative-agent-card-row"><strong>{tr("制作计划")}</strong><Button size="small" onClick={close}>{tr("收起")}</Button></div>
        <ol>{plan.steps.map((step) => <li key={step.id} data-status={step.status}><div className="creative-agent-card-row"><strong>{step.title}</strong><Tag>{stepLabels[step.status]}</Tag></div>{step.detail && <p>{step.detail}</p>}{onLocateNode && step.nodeIds?.map((id, index) => <Button key={id} type="link" onClick={() => onLocateNode(id)}>{tr("定位节点")} {index + 1}</Button>)}</li>)}</ol>
    </div>}><Button ref={trigger} className="creative-agent-plan-trigger" aria-label={tr("查看制作计划")} aria-expanded={open} aria-controls={panelId} onKeyDown={(event) => { if (event.key === "Escape") close(); }}><span className="creative-agent-plan-count">{completed}/{plan.steps.length}</span><span className="creative-agent-plan-current">{running > 1 ? tr("运行中 {0} 项", running) : current ? current.title : completed === plan.steps.length ? tr("计划已完成") : tr("查看制作计划")}</span><span className="creative-agent-plan-chevron" aria-hidden="true">{open ? "⌄" : "⌃"}</span></Button></Popover>;
}

export function CreativeQuoteCard({ quote, onApprove, onRefresh, busy, disabled }: { quote: CreativeQuote; onApprove: () => void; onRefresh?: () => void; busy?: boolean; disabled?: boolean }) {
    const quantity = quote.items.reduce((total, item) => total + item.quantity, 0);
    return <section className="creative-agent-card creative-agent-quote-card" aria-label={tr("生成确认")} data-canvas-no-zoom data-canvas-wheel-scroll>
        <div className="creative-agent-overline">{tr("本批生成 · 确认")}</div>
        <h3>{quote.title}</h3><div className="creative-agent-quote-total"><span>{tr("本批 {0} 项生成", quantity)}</span></div>
        <details className="creative-agent-quote-details"><summary>{tr("查看明细")}</summary><div className="creative-agent-card-content"><ul className="creative-agent-quote-items">{quote.items.map((item) => <li key={item.id}><div><strong>{item.label}</strong><span>{item.model} · {item.specification}</span></div><b>× {item.quantity}</b></li>)}</ul><p className="creative-agent-muted">{quote.basis}</p>
        {quote.expiresAt && <p>{tr("有效期至")} {quote.expiresAt}</p>}{quote.approvedQuantity !== undefined && <p>{tr("已批准 {0} 项", quote.approvedQuantity)}</p>}
        {onRefresh && <Button className="creative-agent-detail-toggle" type="text" disabled={disabled || busy} onClick={onRefresh}>{tr("刷新")}</Button>}</div></details>
        {quote.externalChannel && <p>{tr("包含个人渠道调用，将使用你在该渠道配置的密钥。")}</p>}
        <div className="creative-agent-actions creative-agent-primary-actions"><Button type="primary" loading={busy} disabled={disabled || busy} onClick={onApprove}>{tr("确认生成")}</Button></div>
    </section>;
}
