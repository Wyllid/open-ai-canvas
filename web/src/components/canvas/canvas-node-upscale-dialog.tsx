import { tr } from "@/i18n";
import { useState } from "react";
import { Radio, Select } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize, type ImageUpscaleAlgorithm, type ImageUpscaleParams } from "@/lib/canvas/image-operation-plan";
import { useImageToolSource } from "./use-image-tool-source";

export type CanvasImageUpscaleParams = ImageUpscaleParams;
type UpscaleDialogProps = { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageUpscaleParams) => void };
const pixelTargets = [1024, 2048, MAX_UPSCALE_LONG_EDGE];

export function CanvasNodeUpscaleDialog(props: UpscaleDialogProps) {
    return props.open && props.dataUrl ? <ResizeEditor key={props.dataUrl} {...props} /> : null;
}

function ResizeEditor({ dataUrl, onClose, onConfirm }: UpscaleDialogProps) {
    const { size, error } = useImageToolSource(dataUrl);
    const [chosen, setChosen] = useState<number | null>(null);
    const [algorithm, setAlgorithm] = useState<ImageUpscaleAlgorithm>("high");
    const edge = size ? Math.max(size.width, size.height) : 0;
    const target = chosen ?? pixelTargets.find((pixels) => pixels > edge) ?? MAX_UPSCALE_LONG_EDGE;
    const output = size ? resolveUpscaleSize(size.width, size.height, target) : null;
    const ready = Boolean(size && target > edge);
    return (
        <AppModal open centered title={tr("调整图片尺寸")} width={760} onCancel={onClose} okText={tr("生成放大图")} okButtonProps={{ disabled: !ready }} onOk={() => ready && onConfirm({ targetLongEdge: target, algorithm })}>
            <p className="mb-4 text-sm text-muted-foreground">{tr("插值放大并另存为新图片，原图保留。此操作不生成新的真实细节。")}</p>
            <div className="grid gap-5 md:grid-cols-2">
                <figure className="m-0 flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-surface-active p-3">
                    <img alt={tr("待调整尺寸的图片")} src={dataUrl} draggable={false} className="max-h-[320px] max-w-full object-contain" />
                    <figcaption className="text-sm text-muted-foreground">{size ? tr("原图 {0} × {1} px", size.width, size.height) : error || tr("正在读取图片…")}</figcaption>
                </figure>
                <div className="flex flex-col gap-5">
                    <label className="flex flex-col gap-2 text-sm">
                        {tr("目标长边")}
                        <Select aria-label={tr("目标长边")} value={target} onChange={setChosen} options={pixelTargets.map((pixels) => ({ value: pixels, label: `${pixels} px`, disabled: pixels <= edge }))} />
                    </label>
                    <fieldset className="space-y-2">
                        <legend className="mb-2 text-sm">{tr("插值方式")}</legend>
                        <Radio.Group value={algorithm} onChange={(event) => setAlgorithm(event.target.value)} className="flex flex-col gap-2">
                            <Radio value="high">{tr("高质量 · 照片与细节图")}</Radio>
                            <Radio value="bilinear">{tr("双线性 · 平滑快速")}</Radio>
                            <Radio value="nearest">{tr("最近邻 · 像素图")}</Radio>
                        </Radio.Group>
                    </fieldset>
                    <output className="text-sm">{output ? tr("输出 {0} × {1} px", output.width, output.height) : tr("等待读取尺寸")}</output>
                    {error || (size && !ready) ? (
                        <p role="alert" className="text-sm text-destructive">
                            {error || (edge >= MAX_UPSCALE_LONG_EDGE ? tr("图片已达到 4K，无需放大") : tr("请选择大于原图的目标尺寸"))}
                        </p>
                    ) : null}
                </div>
            </div>
        </AppModal>
    );
}
