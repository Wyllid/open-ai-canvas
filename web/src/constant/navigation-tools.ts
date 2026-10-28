import { tr } from "@/i18n";
import { Blocks, Clapperboard, Images, LibraryBig, ListTodo, PanelsTopLeft, Settings, WandSparkles } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: tr("创作"),
        icon: WandSparkles,
        section: tr("创作空间"),
    },
    {
        slug: "projects",
        label: tr("短剧创作"),
        icon: Clapperboard,
        section: tr("创作空间"),
    },
    {
        slug: "canvas",
        label: tr("画布"),
        icon: PanelsTopLeft,
        section: tr("创作空间"),
    },
    {
        slug: "tasks",
        label: tr("任务"),
        icon: ListTodo,
        section: tr("创作空间"),
    },
    {
        slug: "assets",
        label: tr("素材"),
        icon: Images,
        section: tr("创作空间"),
    },
    {
        slug: "skills",
        label: tr("技能库"),
        icon: LibraryBig,
        section: tr("工作台管理"),
    },
    {
        slug: "plugins",
        label: tr("插件中心"),
        icon: Blocks,
        section: tr("工作台管理"),
    },
    {
        slug: "settings",
        label: tr("设置"),
        icon: Settings,
        section: tr("工作台管理"),
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
