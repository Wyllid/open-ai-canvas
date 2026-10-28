import { tr } from "@/i18n";
import { ImageOff, Layers3 } from "lucide-react";

export function MediaPlaceholder({ failed = false, label }: { failed?: boolean; label?: string }) {
    const Icon = failed ? ImageOff : Layers3;
    return <span className="product-media-placeholder" role={failed ? "img" : undefined} aria-label={failed ? tr("封面加载失败") : undefined}>
        <span className="product-media-placeholder-icon"><Icon aria-hidden="true" /></span>
        <span>{label || (failed ? tr("封面暂不可用") : tr("从一个想法开始"))}</span>
    </span>;
}
