import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Select, Switch } from "antd";
import { FileText, Plus, Trash2 } from "lucide-react";

import { setDramaCaptions, setDramaMotion, type DramaCaptionCue, type DramaCaptions, type DramaCaptionsUpdate, type DramaCaptionStyle, type DramaMotionItem } from "@/services/api/drama";

import { useDramaInvalidate } from "./use-studio";

type Props = {
    projectId: string;
    episodeId: string;
    fileName: string;
    captions?: DramaCaptions;
    motion?: DramaMotionItem[];
};

const STYLE_OPTIONS: { value: DramaCaptionStyle; label: string }[] = [
    { value: "plain", label: "Plain" },
    { value: "karaoke", label: "Karaoke, word by word" },
];

const NO_GRAPHICS: DramaMotionItem[] = [];

const POSITION_LABEL: Record<string, string> = {
    "top-left": "top left",
    "top-right": "top right",
    "bottom-left": "bottom left",
    "bottom-right": "bottom right",
    center: "center",
};

function clock(ms: number) {
    const seconds = Math.max(ms, 0) / 1000;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

function downloadText(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/x-subrip;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Captions and graphics for the final video. Every change only re-renders the episode with local ffmpeg:
 * no segment video is generated again. The SRT is always exported; burning is optional.
 */
export function PostProduction({ projectId, episodeId, fileName, captions, motion }: Props) {
    const { message } = App.useApp();
    const invalidate = useDramaInvalidate(projectId);
    const onError = (error: unknown) => message.error(error instanceof Error ? error.message : "Could not save");
    const saveCaptions = useMutation({
        mutationFn: (update: DramaCaptionsUpdate) => setDramaCaptions(projectId, episodeId, update),
        onSuccess: () => {
            invalidate(episodeId);
            message.success("Captions saved; the episode is rendered again without new videos");
        },
        onError,
    });
    const saveMotion = useMutation({
        mutationFn: (items: DramaMotionItem[]) => setDramaMotion(projectId, episodeId, items),
        onSuccess: () => {
            invalidate(episodeId);
            message.success("Graphics saved; the episode is rendered again without new videos");
        },
        onError,
    });
    const busy = saveCaptions.isPending || saveMotion.isPending;
    return (
        <section className="drama-post" aria-label="Post-production">
            <CaptionsBlock captions={captions} fileName={fileName} busy={busy} onSave={(update) => saveCaptions.mutate(update)} />
            <GraphicsBlock items={motion || NO_GRAPHICS} busy={busy} onSave={(items) => saveMotion.mutate(items)} />
        </section>
    );
}

function CaptionsBlock({ captions, fileName, busy, onSave }: { captions?: DramaCaptions; fileName: string; busy: boolean; onSave: (update: DramaCaptionsUpdate) => void }) {
    const [open, setOpen] = useState(false);
    const [texts, setTexts] = useState<string[]>([]);
    const cues = captions?.cues || [];
    useEffect(() => setTexts((captions?.cues || []).map((cue) => cue.text)), [captions]);
    const dirty = texts.some((text, index) => text !== cues[index]?.text);
    const saveTexts = () => {
        const edited: DramaCaptionCue[] = cues.map((cue, index) => ({ ...cue, text: texts[index]?.trim() || cue.text }));
        onSave({ cues: edited });
    };
    return (
        <div className="drama-post-block">
            <div className="drama-post-head">
                <span className="drama-eyebrow">Captions</span>
                <Button size="small" type="text" icon={<FileText className="size-3.5" />} disabled={!captions?.srt} onClick={() => captions && downloadText(captions.srt, `${fileName}.srt`)}>
                    Download SRT
                </Button>
            </div>
            <label className="drama-post-row">
                <Switch size="small" checked={captions?.burn || false} disabled={busy || !captions} onChange={(burn) => onSave({ burn })} />
                <span>Burn into the video</span>
            </label>
            <Select size="small" value={captions?.style || "plain"} options={STYLE_OPTIONS} disabled={busy || !captions?.burn} onChange={(style) => onSave({ style })} aria-label="Caption style" />
            <p className="drama-sg-note">
                {cues.length === 0
                    ? "No dialogue to caption yet."
                    : captions?.edited
                      ? `${cues.length} edited captions; script changes no longer update them.`
                      : `${cues.length} captions timed from the dialogue${captions?.estimatedTiming ? "; word timing is estimated" : ""}.`}
                {captions?.outdated?.length ? " Some of their shots were removed from the script." : ""}
            </p>
            <div className="drama-post-actions">
                {cues.length ? (
                    <Button size="small" onClick={() => setOpen(!open)} aria-expanded={open}>
                        {open ? "Hide captions" : "Edit text"}
                    </Button>
                ) : null}
                {captions?.edited ? (
                    <Button size="small" type="text" disabled={busy} onClick={() => onSave({ reset: true })}>
                        Back to automatic
                    </Button>
                ) : null}
            </div>
            {open ? (
                <div className="drama-post-list thin-scrollbar">
                    {cues.map((cue, index) => (
                        <div key={`${cue.startMs}-${index}`} className="drama-post-cue">
                            <small>
                                {clock(cue.startMs)} to {clock(cue.startMs + cue.durationMs)}
                            </small>
                            <Input size="small" value={texts[index] ?? cue.text} maxLength={120} onChange={(event) => setTexts((current) => current.map((text, at) => (at === index ? event.target.value : text)))} />
                        </div>
                    ))}
                    <Button size="small" type="primary" disabled={busy || !dirty} onClick={saveTexts}>
                        Save captions
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

function GraphicsBlock({ items, busy, onSave }: { items: DramaMotionItem[]; busy: boolean; onSave: (items: DramaMotionItem[]) => void }) {
    const [draft, setDraft] = useState<DramaMotionItem[]>(items);
    useEffect(() => setDraft(items), [items]);
    const dirty = JSON.stringify(draft) !== JSON.stringify(items);
    const update = (index: number, patch: Partial<DramaMotionItem>) => setDraft((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));
    const valid = draft.every((item) => item.kind !== "lowerThird" || (item.title || "").trim() !== "");
    return (
        <div className="drama-post-block">
            <div className="drama-post-head">
                <span className="drama-eyebrow">Lower thirds and overlays</span>
                <Button size="small" type="text" icon={<Plus className="size-3.5" />} disabled={busy || draft.length >= 32} onClick={() => setDraft([...draft, { kind: "lowerThird", title: "", subtitle: "", startMs: 0, durationMs: 3000 }])}>
                    Lower third
                </Button>
            </div>
            {draft.length === 0 ? <p className="drama-sg-note">Name and place bars appear over the picture. Image overlays such as a logo can be added by the agent.</p> : null}
            {draft.map((item, index) => (
                <div key={index} className="drama-post-item">
                    {item.kind === "lowerThird" ? (
                        <>
                            <Input size="small" value={item.title} maxLength={40} placeholder="Name or place" onChange={(event) => update(index, { title: event.target.value })} />
                            <Input size="small" value={item.subtitle} maxLength={60} placeholder="Second line (optional)" onChange={(event) => update(index, { subtitle: event.target.value })} />
                        </>
                    ) : (
                        <span className="drama-post-overlay">
                            Image overlay · {POSITION_LABEL[item.position || "top-right"]} · {item.widthPct || 18}% wide
                        </span>
                    )}
                    <div className="drama-post-times">
                        <InputNumber size="small" min={0} step={0.5} value={item.startMs / 1000} prefix="At" suffix="s" aria-label="Start (seconds)" onChange={(value) => update(index, { startMs: Math.round((value || 0) * 1000) })} />
                        <InputNumber
                            size="small"
                            min={0.5}
                            max={600}
                            step={0.5}
                            value={item.durationMs / 1000}
                            prefix="For"
                            suffix="s"
                            aria-label="Duration (seconds)"
                            onChange={(value) => update(index, { durationMs: Math.round((value || 0.5) * 1000) })}
                        />
                        <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} aria-label="Remove" onClick={() => setDraft(draft.filter((_, at) => at !== index))} />
                    </div>
                </div>
            ))}
            {dirty ? (
                <div className="drama-post-actions">
                    <Button size="small" type="primary" disabled={busy || !valid} onClick={() => onSave(draft)}>
                        Save graphics
                    </Button>
                    <Button size="small" type="text" disabled={busy} onClick={() => setDraft(items)}>
                        Discard
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
