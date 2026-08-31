import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve('.')

test('图谱响应解包兼容标准包、Axios 包和原始业务值', async () => {
    const { graphResponseArray, graphResponseCount, normalizeGraphStats, unwrapGraphData } =
        await import('../frontend/components/graph/graphUtils.ts')
    const rows = [{ entityId: 'global:entity:1' }]
    assert.deepEqual(graphResponseArray({ code: 0, data: rows, message: 'ok' }), rows)
    assert.deepEqual(graphResponseArray({ data: { code: 0, data: rows, message: 'ok' } }), rows)
    assert.deepEqual(graphResponseArray(rows), rows)
    assert.deepEqual(unwrapGraphData({ code: 0, data: { count: '3' }, message: 'ok' }), { count: '3' })
    assert.equal(graphResponseCount({ data: { code: 0, data: { count: '3' }, message: 'ok' } }), 3)
    assert.equal(graphResponseCount({ count: -1 }), undefined)
    assert.deepEqual(normalizeGraphStats({ data: { code: 0, data: { entityCount: '4', relationshipCount: '2' } } }), {
        entityCount: 4,
        relationshipCount: 2,
        typeStats: {}
    })
})

test('图谱总数降级保留同一筛选条件下的既有总数', async () => {
    const { GRAPH_ENTITY_PAGE_SIZE, inferEntityTotal } = await import('../frontend/components/graph/graphUtils.ts')
    assert.equal(inferEntityTotal(0, 3), 3)
    assert.equal(inferEntityTotal(GRAPH_ENTITY_PAGE_SIZE, 2, 52), 52)
    assert.equal(inferEntityTotal(0, GRAPH_ENTITY_PAGE_SIZE), GRAPH_ENTITY_PAGE_SIZE)
    assert.equal(inferEntityTotal(GRAPH_ENTITY_PAGE_SIZE, GRAPH_ENTITY_PAGE_SIZE, 80), 80)
})

test('图谱刷新链路对 count 失败采用非阻断降级并保留旧列表', () => {
    const hookSource = fs.readFileSync(path.join(root, 'frontend/components/graph/useGraphWorkspace.ts'), 'utf8')
    const tableSource = fs.readFileSync(path.join(root, 'frontend/components/graph/GraphEntityTable.tsx'), 'utf8')
    assert.match(hookSource, /Promise\.allSettled\(\[listPromise, countPromise\]\)/)
    assert.match(hookSource, /const nextTotal = parsedCount \?\? fallbackTotal/)
    assert.match(hookSource, /列表刷新失败时保留上一次成功数据/)
    assert.match(tableSource, /if \(error && entities\.length === 0\)/)
    assert.match(tableSource, /warning\?: string \| null/)
})

test('记忆页顶部图谱统计复用同一响应解包规则', () => {
    const pageSource = fs.readFileSync(path.join(root, 'frontend/app/(dashboard)/memory/page.tsx'), 'utf8')
    assert.match(pageSource, /import \{ normalizeGraphStats \} from '@\/components\/graph\/graphUtils'/)
    assert.match(pageSource, /setGraphStats\(normalizeGraphStats\(response\)\)/)
    assert.doesNotMatch(pageSource, /const data = response\?\.data[\s\S]*setGraphStats\(\{/)
})

test('空图谱仍默认落在 global 作用域并保持新建实体入口可用', () => {
    const hookSource = fs.readFileSync(path.join(root, 'frontend/components/graph/useGraphWorkspace.ts'), 'utf8')
    const workspaceSource = fs.readFileSync(path.join(root, 'frontend/components/graph/GraphWorkspace.tsx'), 'utf8')
    assert.match(hookSource, /useState<string\[\]>\(\['global'\]\)/)
    assert.match(hookSource, /const \[selectedScope, setSelectedScope\] = useState\('global'\)/)
    assert.match(workspaceSource, /<Button size="sm" className="h-8" onClick=\{openCreateEntity\}>/)
})
