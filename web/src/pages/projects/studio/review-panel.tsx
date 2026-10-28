import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Checkbox } from "antd";
import { Loader2, ListChecks } from "lucide-react";

import { resolveDramaReviewFinding, runDramaReview, type DramaReviewFinding, type DramaReviewPass, type DramaReviewState } from "@/services/api/drama";

import { useDramaInvalidate } from "./use-studio";

const PASS_LABEL: Record<DramaReviewPass, string> = {
    script: "Script",
    direction: "Direction",
    camera: "Camera",
    continuity: "Continuity",
    sound: "Sound",
};

const PASSES = Object.keys(PASS_LABEL) as DramaReviewPass[];

const FIELD_LABEL: Record<string, string> = {
    speaker: "speaker",
    dialogue: "line",
    action: "action",
    shotSize: "shot size",
    camera: "camera",
    imagePrompt: "frame",
    videoPrompt: "motion",
    transition: "transition",
    durationSeconds: "duration (s)",
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
    const { message } = App.useApp();
    const invalidate = useDramaInvalidate(projectId);
    const [passes, setPasses] = useState<DramaReviewPass[]>(review?.passes?.length ? review.passes : PASSES);
    const pending = review?.status === "queued" || review?.status === "running";
    const run = useMutation({
        mutationFn: () => runDramaReview(projectId, episodeId, passes),
        onSuccess: () => {
            invalidate(episodeId);
            message.success("Review started: one text generation, nothing is changed until you accept a finding");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Could not start the review"),
    });
    const resolve = useMutation({
        mutationFn: ({ finding, accept }: { finding: DramaReviewFinding; accept: boolean }) => resolveDramaReviewFinding(projectId, episodeId, finding.id, accept),
        onSuccess: (_, { finding, accept }) => {
            invalidate(episodeId);
            message.success(accept ? (finding.field ? `Applied to shot ${finding.shotNumber}; its segment prompt and video are now stale` : "Marked as accepted") : "Dismissed");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Could not update the finding"),
    });
    const open = review?.findings.filter((finding) => finding.status === "open") || [];
    const closed = (review?.findings.length || 0) - open.length;
    return (
        <section className="drama-review" aria-label="Review roles">
            <div className="drama-review-head">
                <span className="drama-eyebrow">Review roles</span>
                <Checkbox.Group className="drama-review-passes" value={passes} options={PASSES.map((value) => ({ value, label: PASS_LABEL[value] }))} onChange={(values) => setPasses(values as DramaReviewPass[])} disabled={pending} />
                <Button size="small" icon={pending ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} disabled={busy || pending || passes.length === 0} loading={run.isPending} onClick={() => run.mutate()}>
                    {pending ? "Reviewing…" : review ? "Review again" : "Review episode"}
                </Button>
            </div>
            {review?.status === "failed" ? <p className="drama-sg-note is-warn">Review failed: {review.error || "no result"}</p> : null}
            {review?.status === "ready" ? <p className="drama-sg-note">{review.findings.length === 0 ? "No problems found." : `${open.length} open · ${closed} resolved`}</p> : null}
            {open.length ? (
                <ul className="drama-review-list">
                    {open.map((finding) => (
                        <li key={finding.id} className={`drama-review-item is-${finding.severity}`}>
                            <div className="drama-review-meta">
                                <b>{PASS_LABEL[finding.pass]}</b>
                                {finding.shotId ? (
                                    <button type="button" className="drama-review-shot" onClick={() => onJump(finding.shotId!)}>
                                        Shot {String(finding.shotNumber).padStart(2, "0")}
                                    </button>
                                ) : (
                                    <span>Whole episode</span>
                                )}
                                <span className="drama-review-severity">{finding.severity}</span>
                            </div>
                            <p>{finding.problem}</p>
                            {finding.field ? (
                                <p className="drama-review-fix">
                                    New {FIELD_LABEL[finding.field] || finding.field}: {finding.value}
                                </p>
                            ) : null}
                            <div className="drama-review-actions">
                                <Button size="small" type="primary" disabled={busy || resolve.isPending} onClick={() => resolve.mutate({ finding, accept: true })}>
                                    {finding.field ? "Apply" : "Accept"}
                                </Button>
                                <Button size="small" type="text" disabled={busy || resolve.isPending} onClick={() => resolve.mutate({ finding, accept: false })}>
                                    Dismiss
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
