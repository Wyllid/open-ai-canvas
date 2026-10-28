import { cn } from "@/lib/utils";

/** Built-in Local Studio mark: a camera viewfinder with a recording dot. Uses currentColor. */
export function LocalStudioMark({ className, title }: { className?: string; title?: string }) {
    return (
        <svg viewBox="0 0 64 64" className={cn("block shrink-0", className)} fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
            <path d={LOCAL_STUDIO_MARK_FRAME} />
            <circle cx="32" cy="32" r="9" />
        </svg>
    );
}

export const LOCAL_STUDIO_MARK_FRAME = "M6 22V14a8 8 0 0 1 8-8h8v7h-8a1 1 0 0 0-1 1v8H6Zm36-16h8a8 8 0 0 1 8 8v8h-7v-8a1 1 0 0 0-1-1h-8V6Zm16 36v8a8 8 0 0 1-8 8h-8v-7h8a1 1 0 0 0 1-1v-8h7ZM22 58h-8a8 8 0 0 1-8-8v-8h7v8a1 1 0 0 0 1 1h8v7Z";
