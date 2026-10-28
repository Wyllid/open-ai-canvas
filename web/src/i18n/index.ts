// Interface language. The Chinese source text is the catalog key (see scripts/i18n-codemod.mjs);
// en and pt-BR catalogs map it to the translation. The active catalog loads before the app
// modules (main.tsx), so module-level labels resolve in the chosen language. Changing the
// language reloads the page.
//
// Until initI18n() runs (tests, scripts) tr() returns the source text and currentLocale() is
// "zh-CN", so behaviour there is unchanged.

export type Locale = "en" | "pt-BR";
type ActiveLocale = Locale | "zh-CN";
type Catalog = Record<string, string>;

export const LOCALES: ReadonlyArray<{ value: Locale; label: string; short: string }> = [
    { value: "en", label: "English", short: "EN" },
    { value: "pt-BR", label: "Português (Brasil)", short: "PT" },
];

const STORAGE_KEY = "yingce.locale";
const PLACEHOLDER = /\{(\d+)\}/g;

let active: ActiveLocale = "zh-CN";
let catalog: Catalog | null = null;
let fallback: Catalog | null = null;

const loaders: Record<Locale, () => Promise<{ default: Catalog }>> = {
    en: () => import("./locales/en.json"),
    "pt-BR": () => import("./locales/pt-BR.json"),
};

function isLocale(value: unknown): value is Locale {
    return value === "en" || value === "pt-BR";
}

export function detectLocale(): Locale {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (isLocale(stored)) return stored;
    } catch {
        // Storage can be blocked; fall back to the browser language.
    }
    const languages = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
    return languages.some((language) => language?.toLowerCase().startsWith("pt")) ? "pt-BR" : "en";
}

/** Loads the catalog of the stored (or browser) language. Call before importing app modules. */
export async function initI18n(): Promise<Locale> {
    const locale = detectLocale();
    try {
        catalog = (await loaders[locale]()).default;
        fallback = locale === "en" ? null : (await loaders.en()).default;
        active = locale;
    } catch {
        // A missing chunk keeps the source text rather than blocking the app.
        catalog = null;
        fallback = null;
    }
    if (typeof document !== "undefined") document.documentElement.lang = active;
    return locale;
}

/** BCP 47 tag of the interface language, for Intl and toLocale*String. */
export function currentLocale(): ActiveLocale {
    return active;
}

/** The selectable language currently shown (English before init). */
export function selectedLocale(): Locale {
    return isLocale(active) ? active : "en";
}

export function setLocale(next: Locale) {
    if (next === active) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // Without storage the choice only lasts for this load.
    }
    window.location.reload();
}

function format(text: string, args: unknown[]) {
    return args.length ? text.replace(PLACEHOLDER, (match, index: string) => (Number(index) < args.length ? String(args[Number(index)] ?? "") : match)) : text;
}

/** Translates a source string; "{0}", "{1}"… are replaced by args. */
export function tr(source: string, ...args: unknown[]): string {
    const text = catalog?.[source] || fallback?.[source] || source;
    return format(text, args);
}

/** tr for a word whose meaning depends on where it is shown: the catalog key is "source@context". */
export function trIn(context: string, source: string, ...args: unknown[]): string {
    const key = `${source}@${context}`;
    return format(catalog?.[key] || fallback?.[key] || catalog?.[source] || fallback?.[source] || source, args);
}

/** Like tr, but keeps args as values (e.g. React elements) so a whole sentence can wrap rich parts. */
export function trParts<T>(source: string, ...args: Array<T | string>): Array<string | T> {
    const text = catalog?.[source] || fallback?.[source] || source;
    return text.split(PLACEHOLDER).map((part, index) => (index % 2 ? args[Number(part)] : part));
}

/** Translates a message that came from the backend when it matches a catalog key exactly. */
export function trMessage(message: string): string {
    return catalog?.[message] || fallback?.[message] || message;
}
