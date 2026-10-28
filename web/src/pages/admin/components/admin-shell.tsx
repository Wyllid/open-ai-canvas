import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AdminTooltip } from "../ui/controls";

/**
 * Header and body of a platform page shown in the settings modal. The modal provides navigation,
 * close and scrolling, so the frame only carries the page title, description and actions.
 */
export function AdminPageFrame({ title, description, actions, back, scroll = false, children }: { title: string; description?: string; actions?: ReactNode; back?: { label: string; onClick: () => void }; scroll?: boolean; children: ReactNode }) {
    return (
        <div className={cn("admin-page-root", scroll && "admin-page-root-scrollable")}>
            <div className={cn("admin-page-frame", scroll && "admin-page-frame-scrollable")}>
                <header className="admin-page-header flex shrink-0 flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                        {back ? (
                            <AdminTooltip title={back.label}>
                                <button type="button" className="admin-icon-button shrink-0" aria-label={back.label} onClick={back.onClick}>
                                    <ArrowLeft className="size-4" />
                                </button>
                            </AdminTooltip>
                        ) : null}
                        <div className="admin-page-title-block min-w-0">
                            <h2 className="admin-page-title truncate">{title}</h2>
                            {description ? <p className="admin-page-description">{description}</p> : null}
                        </div>
                    </div>
                    {actions ? <div className="admin-page-actions flex shrink-0 flex-wrap items-center">{actions}</div> : null}
                </header>
                {children}
            </div>
        </div>
    );
}
