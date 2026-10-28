import { tr } from "@/i18n";
import { Button, Form, Input, InputNumber } from "antd";
import { IconButton, SegmentedControl, Select, Tooltip } from "@/pages/admin/ui/controls";
import { Check, Copy, LockKeyhole, Moon, Plus, Sparkles, Sun, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { SKIN_COLOR_GROUPS, SKIN_COMPONENT_NUMBER_FIELDS, SKIN_BUTTON_COLOR_FIELDS, getSkinButtonAppearance, skinSwatches, type SkinButtonFill, type SkinComponentTokens, type SkinDefinition, type SkinModeTokens, type SkinThemeMode } from "@/lib/skin-themes";
import { cn } from "@/lib/utils";
import { AdminStatusBadge } from "@/pages/admin/components/admin-ui";

export function SkinThemeEditor({
    themes,
    selectedID,
    disabled,
    onSelect,
    onCreate,
    onDuplicate,
    onDelete,
    onChange,
}: {
    themes: SkinDefinition[];
    selectedID: string;
    disabled: boolean;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onChange: (theme: SkinDefinition) => void;
}) {
    const [mode, setMode] = useState<SkinThemeMode>("light");
    const selected = useMemo(() => themes.find((theme) => theme.id === selectedID) || themes[0], [selectedID, themes]);
    if (!selected) return null;
    const editorDisabled = disabled || selected.locked;
    const buttonFill = selected.tokens.buttons[mode];
    const updateButton = (patch: Partial<SkinButtonFill>) => onChange({ ...selected, tokens: { ...selected.tokens,
        buttons: { ...selected.tokens.buttons, [mode]: { ...buttonFill, ...patch } },
    } });

    const updateIdentity = (patch: Partial<Pick<SkinDefinition, "name" | "description">>) => onChange({ ...selected, ...patch });
    const updateColor = (key: keyof SkinModeTokens, value: string) =>
        onChange({
            ...selected,
            tokens: { ...selected.tokens, [mode]: { ...selected.tokens[mode], [key]: value.trim().toLowerCase() } },
        });
    const updateComponent = <Key extends keyof SkinComponentTokens>(key: Key, value: SkinComponentTokens[Key]) => onChange({ ...selected, tokens: { ...selected.tokens, components: { ...selected.tokens.components, [key]: value } } });

    return (
        <div className="admin-skin-workspace">
            <div className="admin-skin-library-toolbar">
                <div>
                    <strong>{tr("主题库")}</strong>
                    <span>{tr("共 {0} 套，最多 16 套", themes.length)}</span>
                </div>
                <div>
                    <Button icon={<Plus className="size-3.5" />} disabled={disabled || themes.length >= 16} onClick={onCreate}>
                        {tr("从默认新建")}
                    </Button>
                    <Button icon={<Copy className="size-3.5" />} disabled={disabled || themes.length >= 16} onClick={() => onDuplicate(selected.id)}>
                        {tr("复制当前")}
                    </Button>
                </div>
            </div>

            <div className="admin-skin-library" role="radiogroup" aria-label={tr("选择全站皮肤主题")}>
                {themes.map((theme) => {
                    const active = theme.id === selected.id;
                    const swatches = skinSwatches(theme);
                    return (
                        <article key={theme.id} className={cn("admin-skin-card", active && "is-selected")}>
                            <button type="button" className="admin-skin-card-select" role="radio" aria-checked={active} disabled={disabled} onClick={() => onSelect(theme.id)}>
                                <span className="admin-skin-card-preview" aria-hidden="true" style={{ background: theme.tokens.dark.canvas, borderRadius: theme.tokens.components.cardRadius }}>
                                    <span style={{ background: theme.tokens.dark.surface, borderRadius: theme.tokens.components.inputRadius }}>
                                        {swatches.map((color, index) => (
                                            <i key={`${color}-${index}`} style={{ background: color }} />
                                        ))}
                                    </span>
                                </span>
                                <span className="admin-skin-card-copy">
                                    <strong>{theme.name}</strong>
                                    <small>{theme.description || tr("暂无说明")}</small>
                                </span>
                                {theme.locked ? <LockKeyhole className="admin-skin-card-lock" aria-label={tr("系统默认主题不可修改")} /> : null}
                                {active ? (
                                    <span className="admin-skin-card-check" aria-hidden="true">
                                        <Check />
                                    </span>
                                ) : null}
                            </button>
                            <div className="admin-skin-card-actions">
                                <Tooltip title={tr("复制这套主题")}>
                                    <IconButton size="sm" variant="ghost" icon={Copy} aria-label={tr("复制 {0}", theme.name)} disabled={disabled || themes.length >= 16} onClick={() => onDuplicate(theme.id)} />
                                </Tooltip>
                                <Tooltip title={theme.locked ? tr("系统默认主题不可删除") : tr("删除这套主题")}>
                                    <Button
                                        className="admin-skin-delete-button"
                                        type="primary"
                                        danger
                                        size="small"
                                        aria-label={tr("删除 {0}", theme.name)}
                                        icon={<Trash2 className="size-3.5" />}
                                        disabled={disabled || theme.locked}
                                        onClick={() => onDelete(theme.id)}
                                    />
                                </Tooltip>
                            </div>
                        </article>
                    );
                })}
            </div>

            <div className="admin-skin-editor">
                <div className="admin-skin-editor-heading">
                    <div>
                        <span>{tr("当前编辑")}</span>
                        <strong>{selected.name}</strong>
                    </div>
                    <AdminStatusBadge label={selected.locked ? tr("系统默认 · 只读") : tr("自定义主题")} tone={selected.locked ? "neutral" : "info"} />
                </div>

                {selected.locked ? (
                    <div className="admin-skin-locked-note">
                        <LockKeyhole className="size-4" aria-hidden="true" />
                        <span>{tr("经典黑白采用黑白基础配色与紫蓝渐变主按钮，不能改名、修改或删除。点击“从默认新建”即可复制全部参数后自由调整。")}</span>
                    </div>
                ) : null}

                <Form className="admin-appearance-form admin-skin-identity-form" layout="vertical" requiredMark={false} disabled={editorDisabled}>
                    <div className="admin-appearance-form-grid">
                        <Form.Item label={tr("主题名称")} extra={tr("1–40 个字符，可随时更改。")}>
                            <Input value={selected.name} maxLength={40} showCount onChange={(event) => updateIdentity({ name: event.target.value })} />
                        </Form.Item>
                        <Form.Item label={tr("主题说明")} extra={tr("用于主题库辨识，不影响前台文案。")}>
                            <Input value={selected.description} maxLength={100} showCount onChange={(event) => updateIdentity({ description: event.target.value })} />
                        </Form.Item>
                    </div>
                </Form>

                <div className="admin-skin-mode-bar">
                    <div>
                        <strong>{tr("颜色体系")}</strong>
                        <span>{tr("同一用途的控件统一消费下列语义颜色")}</span>
                    </div>
                    <SegmentedControl<SkinThemeMode>
                        ariaLabel={tr("皮肤预览模式")}
                        value={mode}
                        options={[
                            {
                                label: (
                                    <span className="admin-skin-mode-label">
                                        <Sun />
                                        {tr("浅色")}
                                    </span>
                                ),
                                value: "light",
                            },
                            {
                                label: (
                                    <span className="admin-skin-mode-label">
                                        <Moon />
                                        {tr("深色")}
                                    </span>
                                ),
                                value: "dark",
                            },
                        ]}
                        onChange={setMode}
                    />
                </div>

                <SkinThemePreview theme={selected} mode={mode} />

                <details className="admin-skin-token-group" open>
                    <summary><span>{tr("主按钮填充")}</span><small>{tr("{0}模式", mode === "light" ? tr("浅色") : tr("深色"))}</small></summary>
                    <div className="admin-skin-component-grid">
                        <label className="admin-skin-number-field">
                            <span>{tr("填充方式")}</span>
                            <Select value={buttonFill.mode} disabled={editorDisabled}
                                options={[{ label: tr("纯色（使用主操作颜色）"), value: "solid" }, { label: tr("渐变"), value: "gradient" }]}
                                onChange={(value) => updateButton({ mode: value })} />
                        </label>
                        {buttonFill.mode === "gradient" ? <label className="admin-skin-number-field">
                            <span>{tr("渐变角度")}</span>
                            <InputNumber aria-label={tr("渐变角度")} value={buttonFill.angle} min={0} max={360} precision={0} addonAfter="°" disabled={editorDisabled}
                                onChange={(value) => { if (typeof value === "number") updateButton({ angle: value }); }} />
                        </label> : null}
                    </div>
                    {buttonFill.mode === "gradient" ? <div className="admin-skin-color-grid">
                        {SKIN_BUTTON_COLOR_FIELDS.map(({ key, label }) => <ColorTokenField key={key} label={label} help={tr("仅影响主按钮，不改变选中态、开关和危险操作")} value={buttonFill[key]} disabled={editorDisabled}
                            onChange={(value) => updateButton({ [key]: value.trim().toLowerCase() })} />)}
                    </div> : null}
                </details>

                <div className="admin-skin-color-groups">
                    {SKIN_COLOR_GROUPS.map((group, index) => (
                        <details key={group.key} className="admin-skin-token-group" open={index < 2}>
                            <summary>
                                <span>{group.label}</span>
                                <small>{tr("{0} 项", group.fields.length)}</small>
                            </summary>
                            <div className="admin-skin-color-grid">
                                {group.fields.map((field) => (
                                    <ColorTokenField key={field.key} label={field.label} help={field.help} value={selected.tokens[mode][field.key]} disabled={editorDisabled} onChange={(value) => updateColor(field.key, value)} />
                                ))}
                            </div>
                        </details>
                    ))}
                </div>

                <details className="admin-skin-token-group admin-skin-component-group" open>
                    <summary>
                        <span>{tr("控件尺寸、圆角与反馈")}</span>
                        <small>{tr("17 项")}</small>
                    </summary>
                    <div className="admin-skin-component-grid">
                        {SKIN_COMPONENT_NUMBER_FIELDS.map((field) => (
                            <label key={field.key} className="admin-skin-number-field">
                                <span>{field.label}</span>
                                <InputNumber
                                    value={selected.tokens.components[field.key]}
                                    min={field.min}
                                    max={field.max}
                                    step={field.step || 1}
                                    addonAfter={field.suffix || undefined}
                                    disabled={editorDisabled}
                                    onChange={(value) => {
                                        if (typeof value === "number") updateComponent(field.key, value);
                                    }}
                                />
                            </label>
                        ))}
                        <label className="admin-skin-number-field">
                            <span>{tr("阴影风格")}</span>
                            <Select
                                value={selected.tokens.components.shadowStyle}
                                disabled={editorDisabled}
                                options={[
                                    { label: tr("无阴影"), value: "none" },
                                    { label: tr("柔和阴影"), value: "soft" },
                                    { label: tr("强层次阴影"), value: "strong" },
                                ]}
                                onChange={(value) => updateComponent("shadowStyle", value)}
                            />
                        </label>
                    </div>
                </details>
            </div>
        </div>
    );
}

function ColorTokenField({ label, help, value, disabled, onChange }: { label: string; help: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
    const pickerValue = /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{8}$/i.test(value) ? value.slice(0, 7) : "#000000";
    return (
        <div className="admin-skin-color-field">
            <span>
                <strong>{label}</strong>
                <small>{help}</small>
            </span>
            <span className="admin-skin-color-control">
                <input type="color" value={pickerValue} disabled={disabled} aria-label={tr("{0}取色器", label)} title={tr("选择{0}", label)} onChange={(event) => onChange(event.target.value)} />
                <Input value={value} maxLength={9} disabled={disabled} spellCheck={false} status={/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? undefined : "error"} onChange={(event) => onChange(event.target.value)} />
            </span>
        </div>
    );
}

function SkinThemePreview({ theme, mode }: { theme: SkinDefinition; mode: SkinThemeMode }) {
    const color = theme.tokens[mode];
    const button = getSkinButtonAppearance(theme, mode);
    const component = theme.tokens.components;
    const shadow = component.shadowStyle === "none" ? "none" : component.shadowStyle === "strong" ? "0 18px 44px #0000003d" : "0 10px 28px #00000024";
    return (
        <div className="admin-skin-live-preview" style={{ background: color.canvas, color: color.text, borderColor: color.border, borderRadius: component.cardRadius }}>
            <div className="admin-skin-live-preview-card" style={{ background: color.surface, borderColor: color.border, borderRadius: component.cardRadius, boxShadow: shadow }}>
                <span className="admin-skin-live-preview-icon" style={{ background: color.surfaceSubtle, color: color.iconActive, borderRadius: component.inputRadius }}>
                    <Sparkles />
                </span>
                <div>
                    <strong>{tr("控件组合预览")}</strong>
                    <small style={{ color: color.textMuted }}>{tr("按钮、输入、选中与状态均来自同一套主题参数")}</small>
                </div>
                <span className="admin-skin-live-preview-status" style={{ background: color.selected, color: color.selectedForeground, borderRadius: component.menuRadius }}>
                    {tr("已选中")}
                </span>
                <span className="admin-skin-live-preview-menu" style={{ background: color.selected, color: color.selectedForeground, borderRadius: component.menuRadius }}>
                    {tr("后台菜单")}
                </span>
                <span
                    className="admin-skin-live-preview-input"
                    style={{ height: component.controlHeight, background: color.control, borderColor: color.controlBorder, borderWidth: component.borderWidth, borderRadius: component.inputRadius, color: color.textMuted }}
                >
                    {tr("输入框状态")}
                </span>
                <span className="admin-skin-live-preview-button" style={{ height: component.controlHeight, background: button.background, color: button.foreground, borderRadius: component.buttonRadius, fontWeight: component.buttonFontWeight }}>
                    {tr("主要操作")}
                </span>
                <span className="admin-skin-live-preview-switches" aria-label={tr("开关开启与关闭状态预览")}>
                    <i className="is-on" style={{ background: color.switchChecked }}>
                        <b style={{ background: color.switchCheckedHandle }} />
                    </i>
                    <i style={{ background: color.switchUnchecked }}>
                        <b style={{ background: color.switchUncheckedHandle }} />
                    </i>
                </span>
                <span className="admin-skin-live-preview-danger" style={{ background: color.danger, color: color.dangerForeground, borderRadius: component.buttonRadius }}>
                    {tr("删除")}
                </span>
                <span className="admin-skin-live-preview-signals">
                    <i style={{ background: color.success }} />
                    <i style={{ background: color.warning }} />
                    <i style={{ background: color.danger }} />
                    <i style={{ background: color.info }} />
                </span>
            </div>
        </div>
    );
}
