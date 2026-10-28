import { currentLocale, tr } from "@/i18n";
/** 内容库通用时间文案：列表展示相对时间，tooltip 展示绝对时间。 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toTimestamp(value: string | number | Date | undefined | null) {
    if (value === undefined || value === null || value === "") return Number.NaN;
    return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

/** 1 分钟内为「刚刚」，7 天内为「N 分钟/小时/天前」，同年显示「M月D日」，跨年显示「YYYY年M月D日」。 */
export function formatRelativeTime(value: string | number | Date | undefined | null, now: number = Date.now()) {
    const timestamp = toTimestamp(value);
    if (!Number.isFinite(timestamp)) return tr("时间未知");
    const elapsed = Math.max(0, now - timestamp);
    if (elapsed < MINUTE) return tr("刚刚");
    if (elapsed < HOUR) return tr("{0} 分钟前", Math.floor(elapsed / MINUTE));
    if (elapsed < DAY) return tr("{0} 小时前", Math.floor(elapsed / HOUR));
    if (elapsed < 7 * DAY) return tr("{0} 天前", Math.floor(elapsed / DAY));
    const date = new Date(timestamp);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString(currentLocale(), sameYear ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

/** 绝对时间：YYYY/MM/DD HH:mm，用于 title / tooltip。 */
export function formatAbsoluteDateTime(value: string | number | Date | undefined | null) {
    const timestamp = toTimestamp(value);
    if (!Number.isFinite(timestamp)) return tr("时间未知");
    return new Date(timestamp).toLocaleString(currentLocale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
