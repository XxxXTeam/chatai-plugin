import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve('.')

test('MCP 工具测试使用唯一 identity，复制模板只公开标准上下文', async () => {
    const pageSource = fs.readFileSync(path.join(root, 'frontend/app/(dashboard)/mcp/page.tsx'), 'utf8')
    assert.match(pageSource, /toolName:\s*selectedTool\.identity\s*\|\|\s*getToolKey\(selectedTool\)/)
    assert.match(pageSource, /const identity = tool\.identity \|\| getToolKey\(tool\)/)
    assert.match(pageSource, /createCopiedToolName\(tool\)/)

    const { buildCustomToolSource } = await import('../frontend/components/tools/custom-tool-source.ts')
    const source = buildCustomToolSource(
        {
            name: 'remote_tool',
            description: "包含 ' 引号和\n换行的说明",
            serverName: 'server-a',
            inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
        },
        'custom_remote_tool'
    )

    assert.match(source, /context\.getApi\(\)/)
    assert.match(source, /context\.message/)
    assert.match(source, /context\.getEvent\(\)/)
    assert.match(source, /context\.isMaster\(\)/)
    assert.doesNotMatch(source, /context\.getBot|context\.getAdapter|context\.isIcqq|context\.isNapCat/)
    assert.doesNotThrow(() => new Function(source.replace('export default', 'return')))
})

test('工具管理表单把结构化字段生成可加载的标准 ESM', async () => {
    const toolsPageSource = fs.readFileSync(path.join(root, 'frontend/components/tools/useToolsPage.ts'), 'utf8')
    const toolsDialogSource = fs.readFileSync(path.join(root, 'frontend/components/tools/ToolDialogs.tsx'), 'utf8')
    const { buildStandardToolSource, parseToolInputSchema, STANDARD_TOOL_HANDLER_TEMPLATE } =
        await import('../frontend/components/tools/custom-tool-source.ts')
    const schema = parseToolInputSchema('{"type":"object","properties":{"value":{"type":"string"}}}')
    const source = buildStandardToolSource({
        name: 'managed_tool',
        description: '受管工具',
        inputSchema: schema,
        handlerCode: STANDARD_TOOL_HANDLER_TEMPLATE
    })

    assert.match(source, /export default\s*\{/)
    assert.match(source, /name:\s*"managed_tool"/)
    assert.match(source, /inputSchema:/)
    assert.match(source, /async run\(args, context\)/)
    assert.match(source, /context\.getApi\(\)/)
    assert.doesNotMatch(source, /context\.getBot|context\.getAdapter/)
    assert.doesNotThrow(() => new Function(source.replace('export default', 'return')))
    assert.throws(() => parseToolInputSchema('[]'), /JSON 对象/)
    assert.throws(() => parseToolInputSchema('{"type":"array"}'), /type 必须是 object/)
    assert.throws(() => parseToolInputSchema('{"required":[1]}'), /required 必须是字符串数组/)
    assert.match(toolsPageSource, /source = buildStandardToolSource\(/)
    assert.match(toolsPageSource, /toolsApi\.createJs\(\{ name: jsForm\.name, source \}\)/)
    assert.doesNotMatch(toolsPageSource, /async function execute\(args, context\)/)
    assert.doesNotMatch(toolsDialogSource, /context \(上下文信息，包含 e, Bot 等\)/)
})

test('Markdown 清理规则保留常用 Markdown/GFM 并拒绝主动内容', async () => {
    const { MARKDOWN_SANITIZE_SCHEMA } = await import('../frontend/components/ui/markdown-sanitize.ts')
    const allowedTags = new Set(MARKDOWN_SANITIZE_SCHEMA.tagNames)
    for (const tag of ['a', 'blockquote', 'code', 'del', 'img', 'table', 'input', 'ul']) {
        assert.equal(allowedTags.has(tag), true, `应保留 ${tag}`)
    }
    for (const tag of ['script', 'iframe', 'style', 'object', 'embed', 'form']) {
        assert.equal(allowedTags.has(tag), false, `不得允许 ${tag}`)
        assert.equal(MARKDOWN_SANITIZE_SCHEMA.strip.includes(tag), true, `应剥离 ${tag}`)
    }

    const allowedAttributeNames = Object.values(MARKDOWN_SANITIZE_SCHEMA.attributes)
        .flat()
        .map(attribute => (Array.isArray(attribute) ? attribute[0] : attribute))
    assert.equal(allowedAttributeNames.includes('style'), false)
    assert.equal(
        allowedAttributeNames.some(name => /^on/i.test(String(name))),
        false
    )
    assert.deepEqual(MARKDOWN_SANITIZE_SCHEMA.protocols.href, ['http', 'https', 'mailto'])
    assert.deepEqual(MARKDOWN_SANITIZE_SCHEMA.protocols.src, ['http', 'https'])
})

test('CodeBlock 高亮在生成 HTML 前转义 JSON 与 JavaScript 用户内容', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/ui/code-block.tsx'), 'utf8')
    const jsonHighlighter = source.match(/function highlightJson\(json: string\): string \{[\s\S]*?\n\}/)?.[0]

    assert.ok(jsonHighlighter, '应保留 JSON 高亮函数')
    assert.match(jsonHighlighter, /const escapedJson = escapeHtml\(json\)/)
    assert.match(jsonHighlighter, /return escapedJson\.replace\(/)
    assert.match(source, /catch \{\s*return highlightJson\(code\)\s*\}/)
    assert.match(source, /let result = escapeHtml\(code\)/)
    assert.match(source, /dangerouslySetInnerHTML=\{\{ __html: renderedContent \}\}/)
})

test('Next 配置定位包含前端工作区的最近 pnpm 根目录', async () => {
    const { findPnpmWorkspaceRoot } = await import('../frontend/next.config.ts')
    const workspaceRoot = findPnpmWorkspaceRoot(path.join(root, 'frontend'))
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml')), true)
    assert.equal(path.relative(workspaceRoot, path.join(root, 'frontend')).startsWith('..'), false)
})

test('页面导航和 Markdown 编辑器不再依赖不可聚焦伪 tab 或全局固定 ID', () => {
    const tabsSource = fs.readFileSync(path.join(root, 'frontend/components/layout/PageTabs.tsx'), 'utf8')
    const editorSource = fs.readFileSync(path.join(root, 'frontend/components/ui/markdown-editor.tsx'), 'utf8')
    const tourSource = fs.readFileSync(path.join(root, 'frontend/components/DashboardTour.tsx'), 'utf8')

    assert.match(tabsSource, /<nav[\s\S]*aria-label="已打开页面"/)
    assert.doesNotMatch(tabsSource, /role="tab"/)
    assert.match(tabsSource, /aria-label=\{`关闭 \$\{tab\.label\}`\}/)
    assert.match(tabsSource, /aria-label="管理已打开页面"/)
    assert.match(tourSource, /aria-label="重新开始功能引导"/)
    assert.match(editorSource, /useRef<HTMLTextAreaElement>/)
    assert.doesNotMatch(editorSource, /document\.getElementById\(['"]md-editor['"]\)/)
})

test('MCP 管理表单可显式选择 Streamable HTTP 传输', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/app/(dashboard)/mcp/page.tsx'), 'utf8')
    assert.match(source, /<SelectItem value="streamable-http">/)
    assert.match(source, /serverForm\.type === 'streamable-http'/)
    assert.match(source, /editForm\.type === 'streamable-http'/)
})

test('MCP 管理页展示资源、资源模板与提示词清单', () => {
    const apiSource = fs.readFileSync(path.join(root, 'frontend/lib/api.ts'), 'utf8')
    const pageSource = fs.readFileSync(path.join(root, 'frontend/app/(dashboard)/mcp/page.tsx'), 'utf8')
    assert.match(apiSource, /getResourceTemplates: \(\) => api\.get\('\/api\/mcp\/resources\/templates'\)/)
    assert.match(apiSource, /\/api\/mcp\/servers\/\$\{encodeURIComponent\(name\)\}/)
    for (const marker of ['mcpApi.getResources()', 'mcpApi.getResourceTemplates()', 'mcpApi.getPrompts()']) {
        assert.match(pageSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
    assert.match(pageSource, /<TabsTrigger value="resources"/)
    assert.match(pageSource, /资源模板 \(\{resourceTemplates\.length\}\)/)
    assert.match(pageSource, /提示词 \(\{prompts\.length\}\)/)
})

test('键值参数表由显式版本重建，重置不会被内部缓存吞掉', () => {
    const tableSource = fs.readFileSync(path.join(root, 'frontend/components/ui/key-value-table.tsx'), 'utf8')
    const dialogsSource = fs.readFileSync(path.join(root, 'frontend/components/tools/ToolDialogs.tsx'), 'utf8')
    const mcpSource = fs.readFileSync(path.join(root, 'frontend/app/(dashboard)/mcp/page.tsx'), 'utf8')

    assert.doesNotMatch(tableSource, /useEffect\([\s\S]*setItems/)
    assert.match(dialogsSource, /key=\{`\$\{tool\?\.identity[\s\S]*resetVersion/)
    assert.match(dialogsSource, /setResetVersion\(version => version \+ 1\)/)
    assert.match(mcpSource, /key=\{`\$\{selectedTool\.identity[\s\S]*testArgsVersion/)
    assert.match(mcpSource, /setTestArgsVersion\(version => version \+ 1\)/)
})

test('图谱删除历史快照只读，避免显示必然失败的回滚按钮', () => {
    const entityHistorySource = fs.readFileSync(
        path.join(root, 'frontend/components/graph/EntityHistoryDialog.tsx'),
        'utf8'
    )
    const relationshipHistorySource = fs.readFileSync(
        path.join(root, 'frontend/components/graph/RelationshipHistoryDialog.tsx'),
        'utf8'
    )
    for (const source of [entityHistorySource, relationshipHistorySource]) {
        assert.match(source, /item\.changeType === 'deleted'/)
        assert.match(source, /disabled=\{rollingBack \|\| item\.changeType === 'deleted'\}/)
        assert.match(source, /已删除（仅查看）/)
    }
})

test('关系搜索文本变化时清除过期目标，避免提交错误实体', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/graph/RelationshipFormDialog.tsx'), 'utf8')
    assert.match(source, /if \(target && value !== target\.name\) setTarget\(null\)/)
})

test('图谱导出识别 Blob 错误包，避免把失败响应保存为文件', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/graph/GraphWorkspace.tsx'), 'utf8')
    assert.match(source, /blob\.slice\(0, 4096\)\.text\(\)/)
    assert.match(source, /Number\(payload\.code\) !== 0/)
    assert.match(source, /导出响应不是有效的图谱 JSON/)
})

test('新建技能表单按钮复用规范校验，不允许非法名称提交', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/skills/skill-create-dialog.tsx'), 'utf8')
    assert.match(source, /const canSubmit = useMemo\(/)
    assert.match(source, /const name = form\.name\.trim\(\)/)
    assert.match(source, /disabled=\{submitting \|\| !canSubmit\}/)
})

test('技能编辑器主文件保存后始终重新读取，避免源码与表单状态分叉', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/skills/skill-editor-dialog.tsx'), 'utf8')
    assert.match(
        source,
        /await onSaved\?\.\(\)[\s\S]*if \(activeFile === MAIN_FILE_KEY\) await loadContent\(MAIN_FILE_KEY\)/
    )
    assert.doesNotMatch(source, /if \(structuredMode && activeFile === MAIN_FILE_KEY\)/)
})

test('图谱 SVG 的 defs 标识按实例隔离，避免多个画布互相引用', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/graph/GraphCanvas.tsx'), 'utf8')
    assert.match(source, /useId\(\)/)
    assert.match(source, /const gridId = `graph-grid-\$\{idPrefix\}`/)
    assert.match(source, /const arrowId = `graph-arrow-\$\{idPrefix\}`/)
    assert.doesNotMatch(source, /id="graph-grid"/)
    assert.doesNotMatch(source, /id="graph-arrow"/)
})

test('图谱未知实体/关系类型不会把对象原型渲染到页面', () => {
    const constantsSource = fs.readFileSync(path.join(root, 'frontend/components/graph/constants.tsx'), 'utf8')
    const canvasSource = fs.readFileSync(path.join(root, 'frontend/components/graph/GraphCanvas.tsx'), 'utf8')
    for (const name of ['entityTypeLabels', 'entityTypeIcons', 'relationTypeLabels', 'changeTypeLabels']) {
        assert.match(
            constantsSource,
            new RegExp(`export const ${name}[^=]*= Object\\.assign\\(Object\\.create\\(null\\)`)
        )
    }
    assert.match(canvasSource, /const TYPE_COLORS[^=]*= Object\.assign\(Object\.create\(null\)/)
})

test('图谱 API 的实体与关系路径标识统一进行 URL 编码', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/lib/api.ts'), 'utf8')
    const entityPathUses = source.match(/\/api\/graph\/entities\/\$\{encodeURIComponent\(entityId\)\}/g) || []
    const relationshipPathUses =
        source.match(/\/api\/graph\/relationships\/\$\{encodeURIComponent\(relationshipId\)\}/g) || []
    assert.equal(entityPathUses.length, 6)
    assert.equal(relationshipPathUses.length, 4)
})

test('图谱新增与编辑表单使用后端规定的写入字段并在成功后刷新', () => {
    const entitySource = fs.readFileSync(path.join(root, 'frontend/components/graph/EntityFormDialog.tsx'), 'utf8')
    const relationshipSource = fs.readFileSync(
        path.join(root, 'frontend/components/graph/RelationshipFormDialog.tsx'),
        'utf8'
    )
    const relationshipEditSource = fs.readFileSync(
        path.join(root, 'frontend/components/graph/RelationshipEditDialog.tsx'),
        'utf8'
    )

    assert.match(entitySource, /graphApi\.createEntity\(\{\s*name: trimmedName, type, scopeId, properties\s*\}\)/s)
    assert.match(entitySource, /graphApi\.updateEntity\(entity\.entityId, \{ name: trimmedName, type, properties \}\)/)
    assert.match(relationshipSource, /fromEntityId:[\s\S]*toEntityId:[\s\S]*relationType: finalRelation[\s\S]*scopeId/s)
    assert.match(
        relationshipEditSource,
        /graphApi\.updateRelationship\(relationship\.relationshipId, \{[\s\S]*properties:/s
    )
    for (const source of [entitySource, relationshipSource, relationshipEditSource]) {
        assert.match(source, /onOpenChange\(false\)/)
        assert.match(source, /onSaved\(\)/)
    }
})

test('工具管理开关与选择框标签可聚焦关联，点击文字也能操作', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/components/tools/ToolManagementCard.tsx'), 'utf8')
    for (const id of [
        'builtin-tools-enabled',
        'builtin-tools-dangerous',
        'tools-watcher-enabled',
        'tools-approval-mode'
    ]) {
        assert.match(source, new RegExp(`id="${id}"`))
        assert.match(source, new RegExp(`htmlFor="${id}"`))
    }
})
