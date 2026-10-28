import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button } from "antd";
import { ImageUp, X } from "lucide-react";

import { setDramaSegmentStartFrame, type DramaSegment } from "@/services/api/drama";
import { uploadResourceFile } from "@/services/api/resources";

import { MediaThumb } from "../drama-shared";
import { useDramaInvalidate } from "./use-studio";

/**
 * The image a segment's video starts from, such as a previs render exported from the canvas or a refined keyframe.
 * Picking one replaces the previous segment's last frame and makes this segment's prompt and video stale.
 */
export function SegmentStartFrame({ projectId, episodeId, segment, busy }: { projectId: string; episodeId: string; segment: DramaSegment; busy: boolean }) {
    const { message } = App.useApp();
    const invalidate = useDramaInvalidate(projectId);
    const input = useRef<HTMLInputElement>(null);
    const save = useMutation({
        mutationFn: async (file: File | null) => {
            const resourceId = file ? (await uploadResourceFile(file, "image", { fileName: file.name })).id : "";
            return setDramaSegmentStartFrame(projectId, episodeId, segment.index, resourceId);
        },
        onSuccess: (_, file) => {
            invalidate(episodeId);
            message.success(file ? "Start frame set; this segment's prompt and video need generating again" : "Start frame cleared");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Could not save the start frame"),
    });
    const disabled = busy || save.isPending || segment.videoStatus === "queued" || segment.videoStatus === "running";
    return (
        <div className="drama-sd-start">
            {segment.startFrameResourceId ? <MediaThumb resourceId={segment.startFrameResourceId} alt="Start frame" className="drama-sd-start-thumb" /> : null}
            <div className="drama-sd-start-text">
                <b>Start frame</b>
                <small>{segment.startFrameResourceId ? "The video starts from this image instead of the previous segment's last frame." : "Optional: start from a previs render or a keyframe you made."}</small>
                <div className="drama-sd-error-actions">
                    <Button size="small" icon={<ImageUp className="size-3.5" />} loading={save.isPending} disabled={disabled} onClick={() => input.current?.click()}>
                        {segment.startFrameResourceId ? "Replace" : "Upload image"}
                    </Button>
                    {segment.startFrameResourceId ? (
                        <Button size="small" type="text" icon={<X className="size-3.5" />} disabled={disabled} onClick={() => save.mutate(null)}>
                            Clear
                        </Button>
                    ) : null}
                </div>
            </div>
            <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) save.mutate(file);
                }}
            />
        </div>
    );
}
