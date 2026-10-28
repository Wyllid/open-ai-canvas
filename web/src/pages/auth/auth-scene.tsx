import { tr } from "@/i18n";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { motion, useReducedMotion } from "motion/react";
import { Outlet, useLocation } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { LocalStudioMark } from "@/components/brand/local-studio-mark";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore } from "@/stores/use-theme-store";

/** Self-hosted sign-in: one centered card for the local administrator account defined in the server .env. */
export function AuthScene() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const theme = useThemeStore((state) => state.theme);
    const location = useLocation();
    const reducedMotion = useReducedMotion();

    return (
        <main className="auth-scene auth-scene-center relative grid h-dvh min-h-0 place-items-center overflow-y-auto px-4 py-10">
            <div aria-hidden className="auth-scene-backdrop pointer-events-none absolute inset-0" />
            <LanguageSwitcher className="auth-scene-return absolute right-4 top-4 z-20 inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-xs transition sm:right-6 sm:top-6" />
            <motion.section
                initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                aria-labelledby="auth-scene-title"
                className="auth-scene-card relative z-10 w-full max-w-[400px] rounded-xl"
            >
                <header className="flex flex-col items-center px-8 pb-2 pt-9 text-center">
                    <span className="auth-scene-mark grid size-12 place-items-center rounded-xl">
                        <BrandLogo theme={theme} className="size-7" alt="" fallback={<LocalStudioMark className="size-7" />} />
                    </span>
                    <h1 id="auth-scene-title" className="mt-4 text-xl font-semibold tracking-tight">
                        {appearance.brandName}
                    </h1>
                    <p className="auth-scene-muted mt-1.5 text-sm">{tr("Sign in to your self-hosted studio")}</p>
                </header>
                <div key={location.pathname} className="px-8 pb-8 pt-6">
                    <Outlet />
                </div>
            </motion.section>
        </main>
    );
}
