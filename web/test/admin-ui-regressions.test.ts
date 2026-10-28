import { expect, test } from "bun:test";
import { moduleGroupSource } from "./helpers/module-group-source";

function compactSource(source: string) {
    return source.replace(/\s+/g, " ").trim();
}

function sourceSection(source: string, startMarker: string, endMarker: string) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

test("plugin upload owns native drops and spec tier toggle text remains readable", async () => {
    const [pluginSource, adminCss] = await Promise.all([Bun.file(new URL("../src/pages/plugins/plugin-documentation-modals.tsx", import.meta.url)).text(), Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text()]);
    const toggleCss = sourceSection(adminCss, ".admin-price-tier-toggle span {", ".admin-model-editor-add-tier.ant-btn {");

    expect(pluginSource).toContain("event.preventDefault()");
    expect(pluginSource).toContain("onDragOver={(event)");
    expect(pluginSource).toContain("onDrop={handlePluginDrop}");
    expect(pluginSource).toContain("点击选择插件文件，也可拖拽到此处");
    expect(pluginSource).toContain("释放文件以上传插件");
    expect(pluginSource).toContain("isDraggingPlugin");
    expect(compactSource(adminCss)).toContain(".admin-price-tier-controls { margin-left: auto;");
    expect(toggleCss).toContain("overflow-wrap: anywhere;");
    expect(toggleCss).toContain("white-space: normal;");
    expect(toggleCss).not.toContain("text-overflow: ellipsis;");
});

test("model reference limits use compact rows only inside the admin editor", async () => {
    const css = await Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text();
    const numberField = sourceSection(css, ".admin-model-editor-references .admin-capability-number-field {", ".admin-model-editor-references .admin-capability-boolean-field {");
    expect(numberField).toContain("grid-template-columns: minmax(0, 1fr) 80px;");
    expect(numberField).toContain("min-height: 32px;");
    expect(numberField).toContain("align-items: center;");
    const switches = sourceSection(css, ".admin-model-editor-references .admin-capability-boolean-field label {", "@media (min-width: 601px)");
    expect(switches).toContain("display: flex;");
    expect(compactSource(css)).toContain(".admin-model-editor-references .admin-capability-reference-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start;");
    expect(compactSource(css)).toContain(".admin-model-editor-modal .admin-capability-reference-grid { grid-template-columns: minmax(0, 1fr);");
});

test("model editor presents protocols in a searchable inline radio browser instead of a dropdown", async () => {
    const [source, css] = await Promise.all([Bun.file(new URL("../src/pages/admin/components/channel-model-editor.tsx", import.meta.url)).text(), Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text()]);
    const protocolSection = sourceSection(compactSource(source), '<Form.Item className="admin-model-protocol-field"', "{protocolError && (");

    expect(protocolSection).toContain("<ModelProtocolBrowser");
    expect(protocolSection).not.toContain("<Select");
    expect(compactSource(css)).toContain(".admin-model-protocol-field { grid-column: 1 / -1;");
});

test("channel model fetch requires explicit selection before import", async () => {
    const [componentSource, apiSource, adminCssSource] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/components/channel-model-manager.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/channel-models.ts", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text(),
    ]);
    const component = compactSource(componentSource);

    expect(apiSource).toContain("http.post<{ models: string[] }>(`/admin/channels/${encodeURIComponent(channelId)}/models/fetch`)");
    expect(apiSource).toContain("http.post<{ models: string[]; added: number }>(`/admin/channels/${encodeURIComponent(channelId)}/models/import`, { models })");
    expect(component).toContain('title={tr("选择要导入的模型")}');
    expect(component).toContain("默认勾选已存在的模型，新模型默认不勾选");
    expect(component).toContain("setFetchPreviewOpen(true)");
    expect(component).toContain("setSelectedFetchModels(selectExistingImportModels(result.models,");
    expect(component).toContain('{tr("已选择 {0} / {1} 个模型", selectedFetchModels.length, fetchPreviewModels.length)}');
    expect(component).toContain("disabled={importing || !visibleFetchModels.length || allVisibleFetchModelsSelected}");
    expect(component).toContain("onClick={() => setSelectedFetchModels((current) => selectVisibleModels(current, visibleFetchModels))}");
    expect(component).toContain("disabled={importing || selectedVisibleFetchCount === 0}");
    expect(component).toContain("onClick={() => setSelectedFetchModels((current) => deselectVisibleModels(current, visibleFetchModels))}");
    expect(component).toContain("取消全选");
    expect(component).toContain("disabled={importing}");
    expect(component).toContain("importAdminChannelModels(channel.id, selectedFetchModels)");
    expect(component).toContain("disabled={!selectedFetchModels.length}");
    expect(component).not.toContain("disabled: alreadyExists");
    expect(component).not.toContain("const result = await fetchAdminChannelModels(channel.id); await reload();");
    expect(adminCssSource).toContain(".admin-model-import-modal .channel-model-import-picker .ant-checkbox-checked");
    expect(adminCssSource).toContain("border-color: var(--control-check-fg) !important");
});

test("channel model manager supports bounded atomic batch deletion", async () => {
    const [componentSource, apiSource] = await Promise.all([Bun.file(new URL("../src/pages/admin/components/channel-model-manager.tsx", import.meta.url)).text(), Bun.file(new URL("../src/services/api/channel-models.ts", import.meta.url)).text()]);
    const component = compactSource(componentSource);

    expect(apiSource).toContain("http.post<{ deleted: number }>(`/admin/channels/${encodeURIComponent(channelId)}/models/batch-delete`, { modelIds })");
    expect(component).toContain("<AdminBatchBar count={selectedModelIds.length}");
    expect(component).toContain("rowSelection:");
    expect(component).toContain("selectedRowKeys: selectedModelIds");
    expect(component).toContain("preserveSelectedRowKeys: true");
    expect(component).toContain("setSelectedModelIds(next.slice(0, 100))");
    expect(component).toContain("deleteAdminChannelModels(channel.id, selectedModelIds)");
    expect(component).toContain("okButtonProps: { danger: true }");
    expect(component).toContain("本次就不会删除任何模型");
    expect(component).toContain("批量删除");
});

test("analytics keeps range presets without finance or pricing panels", async () => {
    const source = compactSource(await Bun.file(new URL("../src/pages/admin/components/analytics-panel.tsx", import.meta.url)).text());

    expect(source).toContain('type RangePreset = "7d" | "30d" | "60d"');
    expect(source).toContain('["60d", tr("60 天")]');
    expect(source).toContain('next.set("rangePreset", rangePreset)');
    expect(source).toContain("setRangePreset(undefined)");
    expect(source).not.toContain("模型价格配置");
    expect(source).not.toContain("listAdminModelPricings");
    expect(source).not.toContain("finance.");
    expect(source).not.toContain("analyticsFinanceColumns");
});

test("storage settings keep generic S3 controls and connection validation", async () => {
    const source = await Promise.resolve(moduleGroupSource("pages/admin/settings/storage-settings-page.tsx"));
    const compacted = compactSource(source);

    expect(compacted).toContain('{ mode: "s3", label: tr("S3 兼容存储")');
    expect(compacted).toContain("testAdminOSSConnection(connectionInput(values))");
    for (const field of ["s3Preset", "sessionToken", "pathStyle", "allowUserS3"]) {
        expect(compacted).toContain(`name="${field}"`);
    }
    expect(compacted).toContain('["aliyun", "tencent", "qiniu", "s3"].includes(setting.provider || "")');
});

test("settings modal keeps the storage resource page reachable", async () => {
    const source = await Bun.file(new URL("../src/components/settings/settings-modal.tsx", import.meta.url)).text();
    expect(source).toContain('key: "resources"');
});

test("high impact feature shutdowns require confirmation", async () => {
    const source = await Bun.file(new URL("../src/pages/admin/components/feature-availability-panel.tsx", import.meta.url)).text();
    expect(source).not.toContain("creditsEnabled");
    expect(source).toContain('title: tr("关闭前台模型功能？")');
    expect(source).toContain("onChange={requestFeatureChange}");
});

test("admin settings use full-width summaries without selected-card side stripes", async () => {
    const [componentSource, cssSource] = await Promise.all([Bun.file(new URL("../src/pages/admin/components/admin-ui.tsx", import.meta.url)).text(), Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text()]);

    expect(componentSource).not.toContain("lg:grid lg:grid-cols-4");
    expect(cssSource).not.toContain('content: "配置摘要"');
    expect(cssSource).not.toContain("grid-template-columns: minmax(0, 1fr) 344px");
    expect(cssSource).not.toContain(".admin-storage-mode-choice::before");

    const featureSelected = sourceSection(cssSource, ".admin-feature-board-row.is-selected {", ".admin-feature-board-row.is-dirty {");
    const drawingSelected = sourceSection(cssSource, ".admin-drawing-engine-choice.is-selected {", ".admin-drawing-engine-choice.is-unavailable");
    expect(featureSelected).not.toContain("inset 3px 0 0");
    expect(drawingSelected).not.toContain("inset 3px 0 0");
});

test("task-first settings reveal dependent configuration only after the primary choice", async () => {
    const [storageSource, featureSource, appearanceSource, welcomeSource, drawingSource, arkSource, interceptionSource, thirdPartySource, cssSource] = await Promise.all([
        Promise.resolve(moduleGroupSource("pages/admin/settings/storage-settings-page.tsx")),
        Bun.file(new URL("../src/pages/admin/components/feature-availability-panel.tsx", import.meta.url)).text(),
        Promise.resolve(moduleGroupSource("pages/admin/settings/appearance-settings-page.tsx")),
        Bun.file(new URL("../src/pages/admin/settings/components/welcome-setting.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/drawing-engine-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/ark-private-assets-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/response-interception-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/settings/libtv-settings-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/admin-ui.css", import.meta.url)).text(),
    ]);

    expect(storageSource).toContain('title={tr("1. 选择新资源存储位置")}');
    expect(storageSource).toContain("选择后继续完成第 2 步并保存");
    expect(sourceSection(storageSource, "const requestModeChange", "const save")).not.toContain("save(values)");

    expect(featureSource).toContain('title={tr("1. 用户工作台入口")}');
    expect(featureSource).toContain('title={tr("2. 插件开放范围")}');
    expect(featureSource).toContain('title={tr("3. 用户模型来源")}');
    expect(appearanceSource).toContain("<WelcomeSetting />");
    expect(welcomeSource).toContain('<strong>{tr("启用欢迎页")}</strong>');
    expect(welcomeSource).toContain("updateAdminFeatureAvailability({ welcomeEnabled: value })");

    expect(drawingSource).toContain('title={tr("1. 选择新建绘图默认编辑器")}');
    expect(drawingSource).toContain('title={tr("2. 配置 tldraw 授权（按需）")}');
    expect(sourceSection(drawingSource, "const selectEngine", "async function save")).not.toContain("save(");

    expect(arkSource).toContain('title={tr("1. 配置方舟项目与 IAM 凭据")}');
    expect(arkSource).toContain('title={tr("2. 是否启用可信素材同步")}');
    expect(arkSource).toContain("{prerequisitesReady || draftEnabled ? (");
    expect(arkSource).toContain('aria-label={tr("启用可信素材同步，保存修改后生效")}');

    expect(interceptionSource).toContain('title={tr("1. 是否替换用户可见的上游错误")}');
    expect(interceptionSource).toContain('title={tr("2. 配置替换规则与优先级")}');
    expect(interceptionSource).toContain('title={tr("3. 本地预览用户最终文案")}');
    expect(interceptionSource).toContain("{enabled ? (");
    expect(interceptionSource).not.toContain('className="admin-intercept-overview"');
    expect(sourceSection(interceptionSource, "const changeEnabled", "if (loading")).not.toContain("save(");

    expect(thirdPartySource).toContain('title={tr("1. 配置 LibTV 服务端访问凭据")}');
    expect(thirdPartySource).toContain('title={tr("2. 是否开放用户导入 LibTV 画布")}');
    expect(thirdPartySource).toContain('title={tr("3. 验证已保存的 LibTV 凭据")}');
    expect(thirdPartySource).toContain("{draftHasToken ? (");
    expect(thirdPartySource).toContain("{setting.hasToken && !clearTokenDraft ? (");
    expect(thirdPartySource).not.toContain('className="admin-third-party-overview"');
    expect(sourceSection(thirdPartySource, "const changeEnabled", "const markTokenForRemoval")).not.toContain("save(");

    expect(compactSource(cssSource)).toContain(".admin-feature-board { width: 100%; max-width: none; grid-template-columns: minmax(0, 1fr);");
});

test("admin tables keep requested filters and actions in the intended positions", async () => {
    const storageSource = await Bun.file(new URL("../src/pages/admin/components/storage-resources-panel.tsx", import.meta.url)).text();

    const storageToolbar = sourceSection(storageSource, "toolbar={", "toolbarActiveFilters=");
    expect(storageToolbar).toContain('className="admin-storage-resource-filters"');
    expect(storageToolbar).toContain('placeholder={tr("资源 ID 或对象路径")}');
    expect(storageToolbar).toContain('placeholder={tr("用户名 / 昵称 / 邮箱 / 用户 ID")}');
    expect(storageSource).toContain("user: debouncedUserQuery || undefined");
    expect(storageSource).toContain("userId: debouncedUserQuery || undefined");
    expect(storageToolbar).toContain('aria-label={tr("筛选资源类型")}');
    expect(storageToolbar).toContain('aria-label={tr("筛选资源状态")}');
    expect(storageToolbar).toContain('aria-label={tr("筛选存储类型")}');
});

test("request logs show request stages without credit billing", async () => {
    const [listSource, detailSource, apiSource] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/logs/logs-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/api-log-detail-drawer.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/services/api/auth.ts", import.meta.url)).text(),
    ]);

    expect(listSource).toContain('title: tr("请求阶段 / 状态")');
    expect(listSource).toContain('description={tr("模型生成与结果下载记录")}');
    expect(listSource).not.toContain("BillingSummary");
    expect(listSource).not.toContain("积分");
    expect(detailSource).toContain('label={tr("请求阶段")} value={requestKindText(log.requestKind)}');
    expect(detailSource).not.toContain("billingText");
    expect(detailSource).toContain('label={tr("请求 ID")} value={<CopyValue value={log.id} />}');
    expect(detailSource).toContain('label={tr("供应商任务 ID")} value={log.providerRequestId ? <CopyValue value={log.providerRequestId} /> : tr("未记录")}');
    expect(apiSource).not.toContain("billingAmountMicrocredits");
    expect(apiSource).not.toContain("billingAvailable");
});

test("admin console tokens and shell stay isolated from the user workspace", async () => {
    const [tokens, shell, chrome, globals] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/theme/admin-tokens.css", import.meta.url)).text(),
        Bun.file(new URL("../src/components/settings/settings-modal.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/theme/admin-chrome.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
    ]);

    // Platform pages render inside the settings modal, which carries the isolated admin root and theme.
    expect(tokens).toContain("--admin-canvas: #f7f8fa;");
    expect(tokens).toContain("--admin-canvas: #111317;");
    expect(tokens).not.toContain("--admin-layer-0: var(--workspace-");
    expect(tokens).not.toContain("--admin-layer-0: var(--skin-admin-");
    expect(shell).toContain("data-admin-root");
    expect(shell).toContain("getIsolatedAdminAntTheme");
    expect(shell).not.toContain("WorkspacePage");
    expect(shell).not.toContain("getAdminAntThemeConfig");
    expect(shell).not.toContain("app-workspace-nav-link");
    expect(chrome).toContain("[data-admin-root] .admin-nav-link");
    expect(chrome).toContain("border-left: 0 !important");
    expect(chrome).not.toContain("left: -8px");
    expect(chrome).toContain(".admin-drawer .ant-drawer-content");
    expect(globals).not.toContain("/* 管理端专用视觉收口：不覆盖创作端 workspace 的导航、状态和图表样式。 */");

    const [overlays, prompts, modelEditor] = await Promise.all([
        Bun.file(new URL("../src/pages/admin/ui/overlays.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/storyboard-prompts/storyboard-prompts-page.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/admin/components/channel-model-editor.tsx", import.meta.url)).text(),
    ]);
    expect(overlays).toContain('rootClassName={cn("admin-drawer"');
    expect(overlays).toContain('rootClassName={cn("admin-modal-root"');
    expect(overlays).not.toContain("@/components/ui/product");
    for (const source of [prompts, modelEditor]) {
        expect(source).not.toContain("@/components/ui/product");
        expect(source).not.toContain("AppDrawer");
        expect(source).not.toContain("AppModal");
    }
});
