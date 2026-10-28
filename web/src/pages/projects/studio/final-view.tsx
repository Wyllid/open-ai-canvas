import { tr } from "@/i18n";
import { useRef } from "react";
import { App, Button } from "antd";
import { Download, Film } from "lucide-react";

import type { DramaEpisodeDetail } from "@/services/api/drama";

import { aspectRatioValue, downloadResource, formatDuration, MediaThumb, STAGE_LABEL, useResourceMediaUrl } from "../drama-shared";
import { FinalUpscale } from "./final-upscale";
import { PostProduction } from "./post-production";
import { secondsLabel } from "./segment-parts";

/**
 * Final video: segment videos in order with the dialogue and sound the video model generated, plus music,
 * captions and graphics. The filmstrip jumps to a segment and opens its details.
 */
export function FinalView({ projectId, title, detail, aspectRatio, onOpenSegment }: { projectId: string; title: string; detail: DramaEpisodeDetail; aspectRatio: string; onOpenSegment: (index: number) => void }) {
    const { episode, segments } = detail;
    const { message } = App.useApp();
    const videoRef = useRef<HTMLVideoElement>(null);
    const url = useResourceMediaUrl(episode.finalResourceId, "playback");
    const starts: number[] = [];
    segments.reduce((cursor, segment) => {
        starts.push(cursor);
        return cursor + (segment.request.seconds || segment.durationMs / 1000);
    }, 0);
    const fileName = `${title}-episode-${episode.number}`;
    const download = () => {
        if (!episode.finalResourceId) return;
        void downloadResource(episode.finalResourceId, `${fileName}.mp4`).catch((error) => message.error(error instanceof Error ? error.message : tr("下载失败")));
    };
    return (
        <div className="drama-finalv">
            <div className="drama-finalv-stage">
                <div className="drama-finalv-player" style={{ aspectRatio: aspectRatioValue(aspectRatio) }}>
                    {url ? (
                        <video ref={videoRef} key={url} src={url} controls playsInline />
                    ) : (
                        <div className="drama-finalv-empty">
                            <Film className="size-6" aria-hidden />
                            <span>{tr("{0} · 全部段视频生成后自动合成", STAGE_LABEL[episode.stage])}</span>
                        </div>
                    )}
                </div>
                <div className="drama-filmstrip thin-scrollbar">
                    {segments.map((segment, position) => (
                        <button
                            key={segment.id || segment.index}
                            type="button"
                            className="drama-filmstrip-item"
                            title={segment.title}
                            onClick={() => {
                                if (videoRef.current) videoRef.current.currentTime = starts[position];
                                onOpenSegment(segment.index);
                            }}
                        >
                            <MediaThumb resourceId={segment.tailFrameResourceId} alt={segment.title} fallback={<span className="drama-filmstrip-empty" />} />
                            <span>{tr("第 {0} 段 · {1}", segment.index + 1, secondsLabel(segment.durationMs))}</span>
                        </button>
                    ))}
                </div>
            </div>
            <aside className="drama-finalv-side">
                <h2>{tr("第 {0} 集 · {1}", episode.number, episode.title)}</h2>
                <p>
                    {formatDuration(episode.durationMs)} · {tr("{0} 个剧情段 · 对白与音效来自视频模型", segments.length)}
                </p>
                {episode.finalStale ? (
                    <p className="drama-finalv-stale" role="status">
                        {tr("内容已修改，当前成片是修改前的版本，相关段重新生成后会自动重新合成。")}
                    </p>
                ) : null}
                <Button icon={<Download className="size-4" />} disabled={!episode.finalResourceId} onClick={download}>
                    {tr("下载成片")}
                </Button>
                <PostProduction projectId={projectId} episodeId={episode.id} fileName={fileName} captions={detail.captions} motion={detail.motion} />
                <FinalUpscale projectId={projectId} episode={episode} enhance={detail.enhance} fileName={fileName} />
            </aside>
        </div>
    );
}
