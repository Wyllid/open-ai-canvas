import { Dropdown } from "antd";
import { Check, Globe } from "lucide-react";

import { LOCALES, selectedLocale, setLocale, tr } from "@/i18n";

/** Interface language picker (English / Português). Choosing a language reloads the page. */
export function LanguageSwitcher({ className, showLabel = true }: { className?: string; showLabel?: boolean }) {
    const current = selectedLocale();
    const active = LOCALES.find((item) => item.value === current) ?? LOCALES[0];
    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
                selectedKeys: [current],
                items: LOCALES.map((item) => ({
                    key: item.value,
                    label: (
                        <span className="inline-flex min-w-40 items-center justify-between gap-3">
                            {item.label}
                            {item.value === current ? <Check className="size-3.5" aria-hidden="true" /> : null}
                        </span>
                    ),
                })),
                onClick: ({ key }) => setLocale(key as (typeof LOCALES)[number]["value"]),
            }}
        >
            <button type="button" className={className} aria-label={tr("Language")} title={tr("Language")}>
                <Globe className="size-4" aria-hidden="true" />
                {showLabel ? <span className="text-xs font-medium">{active.short}</span> : null}
            </button>
        </Dropdown>
    );
}
