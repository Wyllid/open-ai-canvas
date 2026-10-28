import { tr } from "@/i18n";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Checkbox } from "antd";
import { Loader2, ListChecks } from "lucide-react";

import { resolveDramaReviewFinding, runDramaReview, type DramaReviewFinding, type DramaReviewPass, type DramaReviewState } from "@/services/api/drama";

import { useDramaInvalidate } from "./use-studio";

const PASS_LABEL: Record<DramaReviewPass, string> = {
    script: tr("Script"),
    direction: tr("Direction"),
    camera: tr("Camera"),
    continuity: tr("Continuity"),
    sound: tr("Sound"),
};

const PASSES = Object.keys(PASS_LABEL) as DramaReviewPass[];

const SEVERITY_LABEL: Record<DramaReviewFinding["severity"], string> = { high: tr("high"), medium: tr("medium"), low: tr("low") };

const FIELD_LABEL: Record<string, string> = {
    speaker: tr("speaker"),
    dialogue: tr("line"),
    action: tr("action"),
    shotSize: tr("shot size"),
    camera: tr("camera"),
    imagePrompt: tr("frame"),
    videoPrompt: tr("motion"),
    transition: tr("transition"),
    durationSeconds: tr("duration (s)"),
};

type Props = {
    projectId: string;
    episodeId: string;
    review?: DramaReviewState;
    busy: boolean;
    onJump: (shotId: string) => void;
};

/**
 * Review roles read the shot list with their own checklist in one text call. Findings only change
 * a shot when accepted, and an accepted change makes that segment's prompt and video stale.
 */
export function ReviewPanel({ projectId, episodeId, review, busy, onJump }: Props) {
    const { message, modal } = App.useApp();
    const invalidate = useDramaInvalidate(projectId);
    const [passes, setPasses] = useState<DramaReviewPass[]>(review?.passes?.length ? review.passes : PASSES);
    const pending = review?.status === "queued" || review?.status === "running";
    const run = useMutation({
        mutationFn: () => runDramaReview(projectId, episodeId, passes),
        onSuccess: () => {
            invalidate(episodeId);
            message.success(tr("Review started: one text generation, nothing is changed until you accept a finding"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("Could not start the review")),
    });
    const resolve = useMutation({
        mutationFn: ({ finding, accept }: { finding: DramaReviewFinding; accept: boolean }) => resolveDramaReviewFinding(projectId, episodeId, finding.id, accept),
        onSuccess: (_, { finding, accept }) => {
            invalidate(episodeId);
            message.success(accept ? (finding.field ? tr("Applied to shot {0}; its segment prompt and video are now stale", finding.shotNumber) : tr("Marked as accepted")) : tr("Dismissed"));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : tr("Could not update the finding")),
    });
    const open = review?.findings.filter((finding) => finding.status === "open") || [];
    const closed = (review?.findings.length || 0) - open.length;
    const startReview = () => {
        if (!open.length) {
            run.mutate();
            return;
        }
        modal.confirm({
            title: tr("Review the episode again?"),
            content: open.length === 1 ? tr("1 open finding will be replaced by the new review.") : tr("{0} open findings will be replaced by the new review.", open.length),
            okText: tr("Review again"),
            cancelText: tr("Keep findings"),
            onOk: () => run.mutate(),
        });
    };
    return (
        <section className="drama-review" aria-label={tr("Review roles")}>
            <div className="drama-review-head">
                <span className="drama-eyebrow">{tr("Review roles")}</span>
                <Checkbox.Group className="drama-review-passes" value={passes} options={PASSES.map((value) => ({ value, label: PASS_LABEL[value] }))} onChange={(values) => setPasses(values as DramaReviewPass[])} disabled={pending} />
                <Button size="small" icon={pending ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} disabled={busy || pending || passes.length === 0} loading={run.isPending} onClick={startReview}>
                    {pending ? tr("Reviewing…") : review ? tr("Review again") : tr("Review episode")}
                </Button>
            </div>
            {review?.waiting ? <p className="drama-sg-note is-warn">{review.waiting}</p> : null}
            {review?.status === "failed" ? (
                <p className="drama-sg-note is-warn">
                    {tr("Review failed:")} {review.error || tr("no result")}
                </p>
            ) : null}
            {review?.status === "ready" ? <p className="drama-sg-note">{review.findings.length === 0 ? tr("No problems found.") : tr("{0} open · {1} resolved", open.length, closed)}</p> : null}
            {open.length ? (
                <ul className="drama-review-list">
                    {open.map((finding) => (
                        <li key={finding.id} className={`drama-review-item is-${finding.severity}`}>
                            <div className="drama-review-meta">
                                <b>{PASS_LABEL[finding.pass]}</b>
                                {finding.shotId ? (
                                    <button type="button" className="drama-review-shot" onClick={() => onJump(finding.shotId!)}>
                                        {tr("Shot")} {String(finding.shotNumber).padStart(2, "0")}
                                    </button>
                                ) : (
                                    <span>{tr("Whole episode")}</span>
                                )}
                                <span className="drama-review-severity">{SEVERITY_LABEL[finding.severity] || finding.severity}</span>
                            </div>
                            <p>{finding.problem}</p>
                            {finding.field ? (
                                <p className="drama-review-fix">
                                    {tr("New")} {FIELD_LABEL[finding.field] || finding.field}: {finding.value}
                                </p>
                            ) : null}
                            <div className="drama-review-actions">
                                <Button size="small" type="primary" disabled={busy || resolve.isPending} onClick={() => resolve.mutate({ finding, accept: true })}>
                                    {finding.field ? tr("Apply") : tr("Accept")}
                                </Button>
                                <Button size="small" type="text" disabled={busy || resolve.isPending} onClick={() => resolve.mutate({ finding, accept: false })}>
                                    {tr("Dismiss")}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
