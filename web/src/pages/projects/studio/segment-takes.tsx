import { useState } from "react";
import { Button, Input, Select } from "antd";

import type { DramaSegment, DramaTake, DramaTakeVerdict } from "@/services/api/drama";

import { aspectRatioValue, useResourceMediaUrl } from "../drama-shared";
import { secondsLabel } from "./segment-parts";

export const TAKE_VERDICT_LABEL: Record<DramaTakeVerdict, string> = {
    approve: "Approved",
    fix_prompt: "Fix prompt",
    new_take: "New take",
};

const VERDICT_OPTIONS = (Object.keys(TAKE_VERDICT_LABEL) as DramaTakeVerdict[]).map((value) => ({ value, label: TAKE_VERDICT_LABEL[value] }));

export type TakeReviewInput = { verdict: DramaTakeVerdict | ""; notes?: string; promptFix?: string };

type Props = {
    segment: DramaSegment;
    aspectRatio: string;
    busy: boolean;
    onSelect: (take: DramaTake) => void;
    onReview: (take: DramaTake, review: TakeReviewInput) => void;
};

/**
 * Every video take of a segment. The selected take is the one in the episode cut; picking another
 * only renders the episode again. Reviews are notes for the person and the agent, never a regeneration.
 */
export function SegmentTakes({ segment, aspectRatio, busy, onSelect, onReview }: Props) {
    const takes = segment.takes || [];
    const [openId, setOpenId] = useState<string>();
    if (takes.length === 0) return null;
    return (
        <section className="drama-sd-block" aria-label="Takes">
            <div className="drama-sd-label">
                <span>Takes</span>
                <small>{takes.length === 1 ? "1 take" : `${takes.length} takes · picking one re-renders the episode, nothing is generated`}</small>
            </div>
            <div className="drama-sd-takes">
                {takes.map((take) => (
                    <TakeRow
                        key={take.id}
                        take={take}
                        open={openId === take.id}
                        aspectRatio={aspectRatio}
                        busy={busy || segment.videoStatus === "queued" || segment.videoStatus === "running"}
                        onToggle={() => setOpenId(openId === take.id ? undefined : take.id)}
                        onSelect={() => onSelect(take)}
                        onReview={(review) => onReview(take, review)}
                    />
                ))}
            </div>
        </section>
    );
}

function TakeRow({ take, open, aspectRatio, busy, onToggle, onSelect, onReview }: { take: DramaTake; open: boolean; aspectRatio: string; busy: boolean; onToggle: () => void; onSelect: () => void; onReview: (review: TakeReviewInput) => void }) {
    const url = useResourceMediaUrl(open && !take.selected ? take.resourceId : undefined, "playback");
    const [verdict, setVerdict] = useState<DramaTakeVerdict | "">(take.review?.verdict || "");
    const [notes, setNotes] = useState(take.review?.notes || "");
    const created = new Date(take.createdAt);
    const dirty = verdict !== (take.review?.verdict || "") || notes !== (take.review?.notes || "");
    return (
        <div className="drama-sd-take" data-selected={take.selected || undefined}>
            <div className="drama-sd-take-head">
                <button type="button" className="drama-sd-take-name" aria-expanded={open} onClick={onToggle}>
                    <b>Take {take.version}</b>
                    <small>
                        {Number.isNaN(created.getTime()) ? "" : created.toLocaleString()}
                        {take.durationMs ? ` · ${secondsLabel(take.durationMs)}` : ""}
                    </small>
                </button>
                {take.review ? <span className={`drama-sd-take-verdict is-${take.review.verdict}`}>{TAKE_VERDICT_LABEL[take.review.verdict]}</span> : null}
                {take.selected ? (
                    <span className="drama-sd-take-cut">In the cut</span>
                ) : (
                    <Button size="small" disabled={busy} onClick={onSelect}>
                        Use in cut
                    </Button>
                )}
            </div>
            {open ? (
                <div className="drama-sd-take-body">
                    {take.selected ? (
                        <p className="drama-sg-note">This take is the video shown above.</p>
                    ) : url ? (
                        <div className="drama-sg-video" style={{ aspectRatio: aspectRatioValue(aspectRatio) }}>
                            <video key={url} src={url} controls playsInline preload="metadata" />
                        </div>
                    ) : null}
                    {take.review?.promptFix ? <p className="drama-sg-note">Suggested prompt change: {take.review.promptFix}</p> : null}
                    <Select size="small" value={verdict || undefined} placeholder="Verdict" allowClear options={VERDICT_OPTIONS} onChange={(value) => setVerdict(value || "")} aria-label="Verdict" />
                    <Input.TextArea size="small" value={notes} autoSize={{ minRows: 2, maxRows: 6 }} placeholder={verdict === "approve" ? "Notes (optional)" : "What is wrong, shot by shot"} onChange={(event) => setNotes(event.target.value)} />
                    <div className="drama-sd-error-actions">
                        <Button size="small" type="primary" disabled={busy || !dirty || (verdict !== "" && verdict !== "approve" && !notes.trim())} onClick={() => onReview({ verdict, notes: notes.trim(), promptFix: take.review?.promptFix })}>
                            Save review
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
