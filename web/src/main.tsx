import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { installChunkRecovery } from "@/lib/chunk-recovery";
import { initI18n } from "@/i18n";

installChunkRecovery();

// The language catalog loads before any app module, so module-level labels are translated.
void initI18n().then(async () => {
    const { bootstrapAppearance } = await import("@/services/appearance-bootstrap");
    const { isIsolatedPrevisRepro } = await import("@/lib/dev-repro");
    // The public film entry checks its availability independently of workspace bootstrap.
    if (/^\/welcome\/?$/.test(window.location.pathname)) {
        void bootstrapAppearance().catch(() => undefined);
        void import("./welcome-application");
    } else {
        // The backend-free DEV lab must not make requests before AppProviders isolates it.
        const appearanceReady = isIsolatedPrevisRepro(import.meta.env.DEV, window.location.pathname) ? Promise.resolve() : bootstrapAppearance();
        void import("./application");
        void appearanceReady.catch(() => undefined);
    }
});
