import { lazy, Suspense, useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

import { SETTINGS_PARAM, settingsSearch, type SettingsSectionKey } from "@/lib/settings-navigation";
import { useUserStore } from "@/stores/use-user-store";

const SettingsModal = lazy(() => import("./settings-modal"));

/** Opens the settings modal over the current page whenever the URL carries `?settings=<section>`. */
export function SettingsModalHost() {
    const location = useLocation();
    const signedIn = useUserStore((state) => Boolean(state.user));
    const requested = new URLSearchParams(location.search).get(SETTINGS_PARAM);
    if (!requested || !signedIn) return null;
    return (
        <Suspense fallback={null}>
            <SettingsModal requested={requested} />
        </Suspense>
    );
}

/** Opens the settings modal over the current page; closing it returns here through history. */
export function useOpenSettings() {
    const location = useLocation();
    const navigate = useNavigate();
    return useCallback(
        (section: SettingsSectionKey = "account", extra?: Record<string, string>) => navigate({ pathname: location.pathname, search: settingsSearch(location.search, section, extra) }, { state: { settingsBackground: true } }),
        [location.pathname, location.search, navigate],
    );
}
