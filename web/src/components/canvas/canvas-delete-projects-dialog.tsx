import { tr } from "@/i18n";
import { App, Button, Modal } from "antd";
import { useState } from "react";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { deleteCanvasProjectsWithRemoteSync } from "@/services/user-data-sync";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const [deleting, setDeleting] = useState(false);
    const confirm = async () => {
        setDeleting(true);
        try {
            await deleteCanvasProjectsWithRemoteSync(ids);
            void cleanupImages();
            removeSelectedIds(ids);
            setDeleteIds([]);
        } catch (error) {
            message.error(error instanceof Error ? tr("删除画布失败：{0}", error.message) : tr("删除画布失败，请稍后重试"));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={tr("删除画布？")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{tr("取消")}</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        {tr("删除")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">
                {tr("将删除")} {ids.length} {tr("个画布，里面的节点和连线也会一起移除。")}
            </p>
        </Modal>
    );
}
