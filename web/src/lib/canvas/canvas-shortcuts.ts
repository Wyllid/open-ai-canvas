import { tr } from "@/i18n";
export type CanvasShortcutCategoryId = "common" | "navigation" | "selection" | "editing";

export type CanvasShortcutCategory = {
    id: CanvasShortcutCategoryId;
    label: string;
    description: string;
};

export type CanvasShortcutItem = {
    id: string;
    category: CanvasShortcutCategoryId;
    title: string;
    description: string;
    keys: string[][];
    keywords?: string[];
};

export const CANVAS_MODIFIER_KEY = "Ctrl / Cmd";

export const CANVAS_SHORTCUT_CATEGORIES: CanvasShortcutCategory[] = [
    { id: "common", label: tr("常用"), description: tr("搜索、保存与界面") },
    { id: "navigation", label: tr("视图与导航"), description: tr("平移、缩放与定位") },
    { id: "selection", label: tr("选择与连接"), description: tr("批量选择和节点连接") },
    { id: "editing", label: tr("编辑与文件"), description: tr("编辑、撤销与导入") },
];

export const CANVAS_SHORTCUTS: CanvasShortcutItem[] = [
    {
        id: "search",
        category: "common",
        title: tr("搜索画布节点"),
        description: tr("按名称或内容搜索并定位节点"),
        keys: [[CANVAS_MODIFIER_KEY, "F"]],
        keywords: [tr("查找"), tr("定位"), "find", "search"],
    },
    {
        id: "shortcuts",
        category: "common",
        title: tr("打开快捷键中心"),
        description: tr("查看画布中的键盘和鼠标操作"),
        keys: [["?"]],
        keywords: [tr("帮助"), tr("说明"), "help"],
    },
    {
        id: "save",
        category: "common",
        title: tr("保存画布"),
        description: tr("保存当前画布布局和节点位置"),
        keys: [[CANVAS_MODIFIER_KEY, "S"]],
        keywords: [tr("存储"), "save"],
    },
    {
        id: "focus",
        category: "common",
        title: tr("进入或退出专注模式"),
        description: tr("隐藏界面干扰，聚焦当前画布"),
        keys: [["Shift", CANVAS_MODIFIER_KEY, "F"]],
        keywords: [tr("沉浸"), tr("全屏"), "focus"],
    },
    {
        id: "pan",
        category: "navigation",
        title: tr("平移视图"),
        description: tr("触控板双指滑动，按住空格键 / 中键拖动，或切到抓手工具后拖动画布"),
        keys: [[tr("触控板双指")], ["Space", tr("左键拖动")], [tr("中键拖动")]],
        keywords: [tr("移动"), tr("画布"), tr("触控板"), "pan"],
    },
    {
        id: "zoom-wheel",
        category: "navigation",
        title: tr("缩放画布"),
        description: tr("以鼠标所在位置为中心缩放"),
        keys: [[tr("滚轮")]],
        keywords: [tr("放大"), tr("缩小"), "zoom"],
    },
    {
        id: "resize-selected-image",
        category: "navigation",
        title: tr("等比例调整选中图片大小"),
        description: tr("单选一张未锁定的图片，按住 Ctrl 滚动滚轮；只改变画布上的显示尺寸，原图像素不变。触控板捏合仍缩放画布"),
        keys: [["Ctrl", tr("滚轮")]],
        keywords: [tr("图片"), tr("节点"), tr("大小"), tr("比例")],
    },
    {
        id: "zoom-controls",
        category: "navigation",
        title: tr("精确调整缩放"),
        description: tr("使用画布缩放滑杆调整比例"),
        keys: [[tr("缩放滑杆")]],
        keywords: [tr("比例"), "zoom"],
    },
    {
        id: "zoom-steps",
        category: "navigation",
        title: tr("步进缩放画布"),
        description: tr("按固定步长放大或缩小画布"),
        keys: [[CANVAS_MODIFIER_KEY, "+"], [CANVAS_MODIFIER_KEY, "-"]],
        keywords: [tr("放大"), tr("缩小"), "zoom"],
    },
    {
        id: "zoom-presets",
        category: "navigation",
        title: tr("快速调整视图"),
        description: tr("0/1 恢复 100%，2 适应画布，3 适应选择"),
        keys: [[CANVAS_MODIFIER_KEY, "0"], [CANVAS_MODIFIER_KEY, "1"], [CANVAS_MODIFIER_KEY, "2"], [CANVAS_MODIFIER_KEY, "3"]],
        keywords: ["100%", tr("适应"), tr("居中"), tr("缩放"), "fit"],
    },
    {
        id: "box-select",
        category: "selection",
        title: tr("框选多个节点"),
        description: tr("空白处左键拖动默认框选；Shift 追加、Command/Ctrl 切换、Alt 移除"),
        keys: [[tr("空白处左键拖动")], ["Shift", tr("拖动")], [CANVAS_MODIFIER_KEY, tr("拖动")], ["Alt", tr("拖动")]],
        keywords: [tr("多选"), tr("范围"), "selection"],
    },
    {
        id: "box-select-tool",
        category: "selection",
        title: tr("使用区域选择工具"),
        description: tr("底部工具栏的胶囊开关切到区域选择后，空白处拖动可连续框选"),
        keys: [[tr("区域选择"), tr("拖动")]],
        keywords: [tr("工具栏"), tr("多选"), "selection"],
    },
    {
        id: "add-selection",
        category: "selection",
        title: tr("追加选择节点"),
        description: tr("保留已有选择并加入更多节点"),
        keys: [["Shift", tr("点击")], [CANVAS_MODIFIER_KEY, tr("点击")]],
        keywords: [tr("多选"), tr("添加"), "selection"],
    },
    {
        id: "remove-selection",
        category: "selection",
        title: tr("移除选择节点"),
        description: tr("从当前选择中移除点击或框选的节点"),
        keys: [["Alt", tr("点击 / 框选")]],
        keywords: [tr("取消"), tr("排除"), "selection"],
    },
    {
        id: "select-all",
        category: "selection",
        title: tr("全选节点"),
        description: tr("选择画布中的全部节点"),
        keys: [[CANVAS_MODIFIER_KEY, "A"]],
        keywords: [tr("全部"), "select all"],
    },
    {
        id: "batch-connect",
        category: "selection",
        title: tr("批量连接节点"),
        description: tr("为两个或更多已选节点进入批量连接模式"),
        keys: [["Alt", "L"]],
        keywords: [tr("连线"), tr("连接"), "link"],
    },
    {
        id: "copy",
        category: "editing",
        title: tr("复制节点"),
        description: tr("复制当前选中的节点"),
        keys: [[CANVAS_MODIFIER_KEY, "C"]],
        keywords: ["copy"],
    },
    {
        id: "paste",
        category: "editing",
        title: tr("粘贴节点或剪贴板内容"),
        description: tr("粘贴已复制节点、文本或图片"),
        keys: [[CANVAS_MODIFIER_KEY, "V"]],
        keywords: [tr("剪贴板"), "paste"],
    },
    {
        id: "delete",
        category: "editing",
        title: tr("删除选中内容"),
        description: tr("删除选中的节点或连线"),
        keys: [["Delete"], ["Backspace"]],
        keywords: [tr("移除"), "delete"],
    },
    {
        id: "undo",
        category: "editing",
        title: tr("撤销"),
        description: tr("撤销上一步画布编辑"),
        keys: [[CANVAS_MODIFIER_KEY, "Z"]],
        keywords: ["undo"],
    },
    {
        id: "redo",
        category: "editing",
        title: tr("重做"),
        description: tr("恢复刚刚撤销的画布编辑"),
        keys: [[CANVAS_MODIFIER_KEY, "Shift", "Z"], [CANVAS_MODIFIER_KEY, "Y"]],
        keywords: [tr("恢复"), "redo"],
    },
    {
        id: "escape",
        category: "editing",
        title: tr("取消当前操作"),
        description: tr("取消选择、关闭浮层或退出专注模式"),
        keys: [["Esc"]],
        keywords: [tr("关闭"), tr("退出"), "cancel"],
    },
    {
        id: "import-media",
        category: "editing",
        title: tr("导入媒体"),
        description: tr("将图片、视频或音频文件拖入画布"),
        keys: [[tr("拖入媒体")]],
        keywords: [tr("上传"), tr("文件"), tr("图片"), tr("视频"), tr("音频"), "upload"],
    },
];

export function filterCanvasShortcuts(query: string, category?: CanvasShortcutCategoryId | "all") {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return CANVAS_SHORTCUTS.filter((shortcut) => {
        if (category && category !== "all" && shortcut.category !== category) return false;
        if (!terms.length) return true;

        const categoryLabel = CANVAS_SHORTCUT_CATEGORIES.find((entry) => entry.id === shortcut.category)?.label || "";
        const searchableText = [shortcut.title, shortcut.description, categoryLabel, shortcut.keys.flat().join(" "), ...(shortcut.keywords || [])]
            .join(" ")
            .toLocaleLowerCase();
        return terms.every((term) => searchableText.includes(term));
    });
}
