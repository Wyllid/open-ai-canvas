import { tr } from "@/i18n";
import { useRef } from "react";
import { App, Button } from "antd";
import { Download, Film } from "lucide-react";

import type { DramaEpisodeDetail } from "@/services/api/drama";

import { aspectRatioValue, downloadResource, formatDuration, MediaThumb, STAGE_LABEL, useResourceMediaUrl } from "../drama-shared";
import { secondsLabel } from "./segment-parts";

/** 成片：各剧情段视频按顺序拼接，保留视频模型生成的对白与音效。片段条可跳到对应段并打开该段详情。 */
export function FinalView({ title, detail, aspectRatio, onOpenSegment }: { title: string; detail: DramaEpisodeDetail; aspectRatio: string; onOpenSegment: (index: number) => void }) {
    const { episode, segments } = detail;
    const { message } = App.useApp();
    const videoRef = useRef<HTMLVideoElement>(null);
    const url = useResourceMediaUrl(episode.finalResourceId, "playback");
    const starts: number[] = [];
    segments.reduce((cursor, segment) => {
        starts.push(cursor);
        return cursor + (segment.request.seconds || segment.durationMs / 1000);
    }, 0);
    const download = () => {
        if (!episode.finalResourceId) return;
        void downloadResource(episode.finalResourceId, tr("{0}-第{1}集.mp4", title, episode.number)).catch((error) => message.error(error instanceof Error ? error.message : tr("下载失败")));
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
            </aside>
        </div>
    );
}
