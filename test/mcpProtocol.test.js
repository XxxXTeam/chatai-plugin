import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    decodeMcpHeaderValue,
    encodeMcpHeaderValue,
    extractMcpParameterHeaders,
    inspectMcpHeaderSchema,
    validateMcpParameterHeaders
} from '../src/mcp/McpProtocol.js'

test('MCP 参数头编码支持可见 ASCII 与 Base64 哨兵值', () => {
    assert.equal(encodeMcpHeaderValue('us-west1'), 'us-west1')
    assert.equal(decodeMcpHeaderValue('us-west1'), 'us-west1')

    const encoded = encodeMcpHeaderValue(' 北京\n')
    assert.match(encoded, /^=\?base64\?.*\?=$/)
    assert.equal(decodeMcpHeaderValue(encoded), ' 北京\n')
    assert.equal(decodeMcpHeaderValue('=?base64?A?='), null)
    assert.equal(decodeMcpHeaderValue('=?base64?%%%%?='), null)
})

test('MCP 参数头只接受静态可达的 string、integer、boolean 属性', () => {
    const schema = {
        type: 'object',
        properties: {
            region: { type: 'string', 'x-mcp-header': 'Region' },
            retry: { type: 'integer', 'x-mcp-header': 'Retry' },
            dryRun: { type: 'boolean', 'x-mcp-header': 'Dry-Run' }
        }
    }
    assert.deepEqual(inspectMcpHeaderSchema(schema), {
        headers: [
            { name: 'Region', path: ['region'], type: 'string' },
            { name: 'Retry', path: ['retry'], type: 'integer' },
            { name: 'Dry-Run', path: ['dryRun'], type: 'boolean' }
        ]
    })
    assert.match(
        inspectMcpHeaderSchema({ type: 'object', properties: { value: { type: 'number', 'x-mcp-header': 'Value' } } })
            .error,
        /只允许/
    )
    assert.match(
        inspectMcpHeaderSchema({ type: 'object', properties: { nested: { items: { 'x-mcp-header': 'Bad' } } } }).error,
        /静态 properties/
    )
})

test('MCP 参数头提取与服务端一致性校验保持类型和请求体一致', () => {
    const schema = {
        type: 'object',
        properties: {
            options: {
                type: 'object',
                properties: { region: { type: 'string', 'x-mcp-header': 'Region' } }
            },
            count: { type: 'integer', 'x-mcp-header': 'Count' },
            enabled: { type: 'boolean', 'x-mcp-header': 'Enabled' }
        }
    }
    const args = { options: { region: '北京' }, count: 2, enabled: false }
    const headers = extractMcpParameterHeaders(schema, args)
    assert.deepEqual(Object.keys(headers).sort(), ['Mcp-Param-Count', 'Mcp-Param-Enabled', 'Mcp-Param-Region'])
    assert.equal(validateMcpParameterHeaders(schema, args, headers), null)
    assert.match(validateMcpParameterHeaders(schema, { ...args, count: 3 }, headers), /Mcp-Param-Count.*不一致/)
    assert.match(validateMcpParameterHeaders(schema, args, { 'Mcp-Param-Count': '2' }), /Mcp-Param-Region/)
    assert.match(validateMcpParameterHeaders(schema, { ...args, enabled: true }, headers), /Mcp-Param-Enabled.*不一致/)
})
