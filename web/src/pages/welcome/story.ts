import { tr } from "@/i18n";
export const chapters = [
    { id: "opening", label: tr("序幕"), title: tr("影策"), subtitle: tr("让一个故事，从文字走向银幕。"), description: tr("面向 AI 影视与短剧创作的开源工作台。") },
    { id: "story", label: tr("故事"), title: tr("一念，成故事。") },
    { id: "world", label: tr("角色"), title: tr("让想象，有了面孔。") },
    { id: "shots", label: tr("分镜"), title: tr("字里行间，皆是镜头。") },
    { id: "motion", label: tr("生成"), title: tr("这一刻，动起来。") },
    { id: "canvas", label: tr("画布"), title: tr("一个世界，一张画布。") },
] as const;

export type WelcomeLook = {
    id: string;
    label: string;
    title: string;
    frames: string[];
    screenplay: string[];
    video?: string;
    credit?: string;
};

const reelFrames = (folder: string, names: string[]) => Array.from({ length: 12 }, (_, index) => `/welcome/${folder}/${names[index % names.length]}.webp`);

export const welcomeLooks: WelcomeLook[] = [
    {
        id: "spring", label: tr("Spring · 奇幻"), title: tr("山谷之春"),
        frames: reelFrames("spring", ["1807", "1669", "4336", "3191", "3250"]),
        screenplay: [tr("外景 · 山谷 · 黎明"), tr("云海漫过山脊。"), tr("她握紧手中的木杖。"), tr("一条小路，通往谷底。"), tr("石壁投下巨大的影子。"), tr("她停下，望向高处。"), tr("风声忽然安静。"), tr("微光落在她的脸上。"), tr("沉睡的山谷开始苏醒。"), tr("她向前迈出一步。"), tr("远处，第一片新叶展开。"), tr("春天，终于来到。")],
        credit: tr("Spring · Blender 开放电影演示素材"),
    },
    {
        id: "charge", label: tr("Charge · 科幻"), title: tr("最后的电量"),
        frames: reelFrames("charge", ["factory-final", "einar", "robot", "character-final", "factory"]),
        screenplay: [tr("外景 · 能源工厂 · 傍晚"), tr("最后一盏灯闪了一下。"), tr("他望向远处的高塔。"), tr("机械手臂缓缓收紧。"), tr("工厂大门留着一道缝。"), tr("他走进无人值守的走廊。"), tr("警示灯突然亮起。"), tr("一个身影挡住去路。"), tr("电池就在玻璃后面。"), tr("他没有后退。"), tr("微弱的电流重新接通。"), tr("黑暗中，多了一点光。")],
        video: "/welcome/charge/sequence.mp4", credit: tr("Charge · Blender 开放电影演示素材"),
    },
    {
        id: "wing-it", label: tr("Wing It! · 动画"), title: tr("飞向云端"),
        frames: reelFrames("wing-it", ["banner", "pitch", "sky-01", "barn", "sky-04", "sky-06"]),
        screenplay: [tr("内景 · 谷仓 · 午后"), tr("飞行器还差最后一颗螺丝。"), tr("他拧紧旋钮。"), tr("仪表盘上的指针跳了起来。"), tr("屋顶外，是辽阔的天空。"), tr("引擎轰鸣，尘土飞扬。"), tr("他们终于离开地面。"), tr("一片云从舷窗掠过。"), tr("飞行器向左倾斜。"), tr("他重新握住操纵杆。"), tr("阳光照亮了整片云海。"), tr("下一站，还没有名字。")],
        credit: tr("Wing It! · Blender 开放电影演示素材"),
    },
];

export function getWelcomeLook(search = window.location.search) {
    const id = new URLSearchParams(search).get("look");
    return welcomeLooks.find((look) => look.id === id) ?? welcomeLooks[0];
}

export const showcases = [
    { name: tr("自由画布"), image: "/welcome/workbench-canvas.webp", description: tr("把灵感连成作品。"), detail: tr("整理参考、连接节点、比较结果，沿着自己的思路继续创作。"), href: "/canvas" },
    { name: tr("即时创作"), image: "/welcome/workbench-create.webp", description: tr("从一句话开始。"), detail: tr("选择模型与参考素材，在对话中逐步完成图片和视频。"), href: "/create" },
    { name: tr("项目工作台"), image: "/welcome/workbench-project.webp", description: tr("让长故事有条理。"), detail: tr("围绕章节、人物与分镜组织制作，随时回到正在推进的故事。"), href: "/projects" },
] as const;
