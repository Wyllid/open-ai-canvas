import { http } from "@/services/api/request";
import type { ModelTag } from "@/lib/model-tags";
import type { ImageResolutionOption } from "@/lib/image-resolution-tiers";

export type InputConstraint = { min: number; max: number };
export type OptionConstraint = { values?: unknown[]; min?: number; max?: number; step?: number };
export type CapabilityImageSizePreset = ImageResolutionOption;
export type CapabilityImageSize = {
    parameter?: "size" | "aspect_ratio";
    allowCustom?: boolean;
    presets?: CapabilityImageSizePreset[];
};
export type CapabilitySpec = {
    imageParameters?: import("@/lib/image-parameters").ImageParameter[];
    version: 1;
    capability: "text" | "image" | "video" | "audio";
    operations?: string[];
    inputs?: Record<string, InputConstraint>;
    options?: Record<string, OptionConstraint>;
    imageSize?: CapabilityImageSize;
};

export type ModelRequestIntent = {
    capability: CapabilitySpec["capability"];
    operation?: string;
    inputs?: Record<string, number>;
    options?: Record<string, unknown>;
};

export type PublicLogicalModel = {
    id: string;
    code: string;
    name: string;
    icon?: string;
    description: string;
    capability: CapabilitySpec["capability"];
    sortOrder: number;
    priceTiers: PublicLogicalModelPriceTier[];
    legacyModelIds: string[];
    capabilitySpec: CapabilitySpec;
    capabilityProfiles: CapabilitySpec[];
    defaultOptions: Record<string, unknown>;
    available: boolean;
};

/** Public SKU (spec tier) of a logical model; historical name, carries no price. */
export type PublicLogicalModelPriceTier = {
    selector: Record<string, string>;
    resolution: string;
    videoSeconds: number;
};

export type AdminLogicalRoute = {
    id: string;
    channelModelId: string;
    channelId: string;
    channelModelKey: string;
    channelModelName: string;
    enabled: boolean;
    priority: number;
    weight: number;
    available: boolean;
    capabilitySpec: CapabilitySpec;
};

export type AdminLogicalModel = PublicLogicalModel & {
    enabled: boolean;
    activeRevisionId: string;
    revisionVersion: number;
    configurationError?: string;
    routes: AdminLogicalRoute[];
};

/**
 * Keep admin model responses usable when a server is upgraded before its
 * existing process or historical response shape has caught up with the
 * current contract. Collection fields must always be arrays for the page.
 */
export function normalizeAdminLogicalModel(model: AdminLogicalModel): AdminLogicalModel {
    return {
        ...model,
        priceTiers: Array.isArray(model.priceTiers) ? model.priceTiers : [],
        legacyModelIds: Array.isArray(model.legacyModelIds) ? model.legacyModelIds : [],
        capabilityProfiles: Array.isArray(model.capabilityProfiles) ? model.capabilityProfiles : [],
        defaultOptions: model.defaultOptions && typeof model.defaultOptions === "object" ? model.defaultOptions : {},
        routes: Array.isArray(model.routes) ? model.routes : [],
    };
}

export type LogicalModelMutation = {
    code: string;
    name: string;
    icon: string;
    description: string;
    capability: CapabilitySpec["capability"];
    enabled: boolean;
    sortOrder: number;
    legacyModelIds?: string[];
    capabilitySpec: CapabilitySpec;
    defaultOptions: Record<string, unknown>;
    routes: Array<{ channelModelId: string; enabled: boolean; priority: number; weight: number }>;
};

export type RouteSimulationResult = {
    productMatch: { matched: boolean; reasons?: string[] };
    candidates: Array<{ routeId: string; channelModelId: string; channelModelKey: string; channelModelName: string; priority: number; weight: number; enabled: boolean; matched: boolean; blocked: boolean; inPool: boolean; reasons?: string[] }>;
};

export type ModelCatalogSource = "system";

export type PublicChannelCatalog = {
    id: string;
    name: string;
    displayName: string;
    sortOrder?: number;
    models: PublicChannelModel[];
};

export type PublicChannelModel = {
    id: string;
    modelKey: string;
    displayName: string;
    channelLabel?: string;
    tags?: ModelTag[];
    description?: string;
    sortOrder?: number;
    icon: string;
    capability: string;
    protocol?: string;
    capabilityConfig?: Record<string, any>;
    priceTiers: PublicChannelModelPriceTier[];
    available: boolean;
    availability?: PublicChannelModelAvailability;
};

export type PublicChannelModelAvailability = {
    rate24h: number | null;
    sampleCount24h: number;
    trend7d: PublicChannelModelAvailabilityDay[];
    recentResults?: boolean[];
    dataState: "ready" | "insufficient" | "no_data";
    computedAt: string;
    dataThrough?: string;
};

export type PublicChannelModelAvailabilityDay = {
    day: string;
    rate: number | null;
    sampleCount: number;
    dataState: "ready" | "insufficient" | "no_data";
};

export type PublicChannelModelPriceTier = {
    id: string;
    selector?: Record<string, string>;
    resolution: string;
    videoSeconds: number;
};

export type ModelCatalogResponse = {
    source: ModelCatalogSource;
    models?: PublicLogicalModel[];
    channels?: PublicChannelCatalog[];
};

// 创作目录直接读取系统渠道模型，不使用逻辑模型及其功能开关。
export function getModelCatalog() {
    return http.get<ModelCatalogResponse>("/model-catalog");
}

export function listAdminLogicalModels() {
    return http.get<{ models?: AdminLogicalModel[] }>("/admin/logical-models").then((result) => ({
        models: Array.isArray(result?.models) ? result.models.filter(Boolean).map(normalizeAdminLogicalModel) : [],
    }));
}

export function createAdminLogicalModel(input: LogicalModelMutation) {
    return http.post<{ model: AdminLogicalModel }>("/admin/logical-models", input);
}

export function updateAdminLogicalModel(id: string, input: LogicalModelMutation) {
    return http.patch<{ model: AdminLogicalModel }>(`/admin/logical-models/${encodeURIComponent(id)}`, input);
}

export function deleteAdminLogicalModel(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/logical-models/${encodeURIComponent(id)}`);
}

export function simulateAdminLogicalModel(id: string, intent: ModelRequestIntent) {
    return http.post<RouteSimulationResult>(`/admin/logical-models/${encodeURIComponent(id)}/simulate`, intent);
}
