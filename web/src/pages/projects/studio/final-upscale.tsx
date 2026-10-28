import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, Select } from "antd";
import { Download, Loader2, Sparkles } from "lucide-react";

import { listVideoEnhanceModels, videoEnhanceProfile } from "@/lib/canvas/canvas-video-enhance";
import { enhanceDramaFinal, type DramaEnhanceState, type DramaEpisode } from "@/services/api/drama";
import { decodeChannelModel, modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

import { downloadResource } from "../drama-shared";
import { useDramaInvalidate } from "./use-studio";

/**
 * Optional, paid upscale (and frame interpolation where the model allows it) of the current final video.
 * It always asks for confirmation, keeps the final video as it is and stores the result next to it.
 */
export function FinalUpscale({ projectId, episode, enhance, fileName }: { projectId: string; episode: DramaEpisode; enhance?: DramaEnhanceState; fileName: string }) {
    const { message, modal } = App.useApp();
    const invalidate = useDramaInvalidate(projectId);
    const config = useEffectiveConfig();
    const models = useMemo(() => listVideoEnhanceModels(config), [config]);
    const [model, setModel] = useState<string>();
    const selected = model && models.includes(model) ? model : models[0];
    const profile = useMemo(() => (selected ? videoEnhanceProfile(config, selected) : undefined), [config, selected]);
    const [resolution, setResolution] = useState<string>();
    const [fps, setFps] = useState<number>();
    const chosenResolution = resolution && profile?.resolutions.includes(resolution) ? resolution : profile?.defaultResolution;
    const fpsOptions = profile?.processing.fpsPolicy === "user_select" ? profile.processing.fpsOptions || [] : [];
    const chosenFps = fps && fpsOptions.includes(fps) ? fps : fpsOptions[0];
    const pending = enhance?.status === "queued" || enhance?.status === "running";
    const tooLong = profile ? episode.durationMs > profile.maxSourceSeconds * 1000 : false;
    const run = useMutation({
        mutationFn: () => {
            const decoded = selected ? decodeChannelModel(selected) : null;
            if (!decoded || !chosenResolution) throw new Error("Pick an enhance model and a resolution");
            return enhanceDramaFinal(projectId, episode.id, { model: { channelId: decoded.channelId, modelKey: decoded.model }, resolution: chosenResolution, ...(chosenFps ? { fps: chosenFps } : {}), confirm: true });
        },
        onSuccess: () => {
            invalidate(episode.id);
            message.success("Upscale started; the final video stays as it is");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Could not start the upscale"),
    });
    const confirm = () =>
        modal.confirm({
            title: "Upscale this episode?",
            content: `This is a paid generation billed by the video length (${Math.ceil(episode.durationMs / 1000)} s) at ${chosenResolution?.toUpperCase()}${chosenFps ? `, ${chosenFps} fps` : ""}. The current final video is kept; the upscaled copy is saved next to it.`,
            okText: "Upscale",
            onOk: () => run.mutateAsync(),
        });
    const ready = Boolean(episode.finalResourceId && !episode.finalStale && selected && chosenResolution && !pending && !tooLong);
    return (
        <div className="drama-post-block">
            <div className="drama-post-head">
                <span className="drama-eyebrow">Upscale</span>
                {enhance?.status === "succeeded" && enhance.resourceId ? (
                    <Button
                        size="small"
                        type="text"
                        icon={<Download className="size-3.5" />}
                        onClick={() => void downloadResource(enhance.resourceId!, `${fileName}-${enhance.resolution}.mp4`).catch((error) => message.error(error instanceof Error ? error.message : "Download failed"))}
                    >
                        Download {enhance.resolution.toUpperCase()}
                    </Button>
                ) : null}
            </div>
            {models.length === 0 ? (
                <p className="drama-sg-note">No video enhance model is configured.</p>
            ) : (
                <>
                    {models.length > 1 ? <Select size="small" value={selected} options={models.map((value) => ({ value, label: modelDisplayName(config, value) }))} onChange={setModel} aria-label="Enhance model" /> : null}
                    <div className="drama-post-times">
                        <Select size="small" value={chosenResolution} options={(profile?.resolutions || []).map((value) => ({ value, label: value.toUpperCase() }))} onChange={setResolution} aria-label="Output resolution" />
                        {fpsOptions.length ? <Select size="small" value={chosenFps} options={fpsOptions.map((value) => ({ value, label: `${value} fps` }))} onChange={setFps} aria-label="Output frame rate" /> : null}
                        <Button size="small" icon={pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} disabled={!ready} loading={run.isPending} onClick={confirm}>
                            {pending ? "Upscaling…" : "Upscale"}
                        </Button>
                    </div>
                </>
            )}
            <p className="drama-sg-note">
                {tooLong
                    ? `The model accepts videos up to ${profile?.maxSourceSeconds} s.`
                    : episode.finalStale || !episode.finalResourceId
                      ? "Available once the final video is rendered and up to date."
                      : enhance?.status === "failed"
                        ? `Last upscale failed: ${enhance.error || "no result"}`
                        : enhance?.status === "succeeded" && enhance.outdated
                          ? "The upscaled copy is from an earlier render of this episode."
                          : "Paid and optional; asks before it runs."}
            </p>
        </div>
    );
}
