'use client'

import { useMemo } from 'react'

interface CodeBlockProps {
    code: string
    language?: string
    className?: string
    maxHeight?: string
}

const COLORS = {
    key: '#9cdcfe',
    string: '#ce9178',
    number: '#b5cea8',
    boolean: '#569cd6',
    null: '#569cd6',
    keyword: '#c586c0',
    comment: '#6a9955'
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// JSON 语法高亮
function highlightJson(json: string): string {
    return json.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        match => {
            let color = COLORS.number
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    color = COLORS.key
                } else {
                    color = COLORS.string
                }
            } else if (/true|false/.test(match)) {
                color = COLORS.boolean
            } else if (/null/.test(match)) {
                color = COLORS.null
            }
            return `<span style="color:${color}">${match}</span>`
        }
    )
}

// JavaScript/TypeScript 语法高亮
function highlightJavaScript(code: string): string {
    let result = escapeHtml(code)

    // 注释优先处理
    result = result.replace(/\/\/.*$/gm, `<span style="color:${COLORS.comment};font-style:italic">$&</span>`)
    result = result.replace(/\/\*[\s\S]*?\*\//g, `<span style="color:${COLORS.comment};font-style:italic">$&</span>`)

    // 字符串
    result = result.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, `<span style="color:${COLORS.string}">$&</span>`)

    // 关键字
    const keywords = [
        'const',
        'let',
        'var',
        'function',
        'async',
        'await',
        'return',
        'if',
        'else',
        'for',
        'while',
        'do',
        'switch',
        'case',
        'break',
        'continue',
        'try',
        'catch',
        'finally',
        'throw',
        'new',
        'class',
        'extends',
        'import',
        'export',
        'from',
        'default',
        'typeof',
        'instanceof',
        'in',
        'of',
        'this',
        'super',
        'static',
        'get',
        'set',
        'true',
        'false',
        'null',
        'undefined'
    ]
    keywords.forEach(kw => {
        result = result.replace(
            new RegExp(`\\b${kw}\\b`, 'g'),
            `<span style="color:${COLORS.keyword};font-weight:500">${kw}</span>`
        )
    })

    // 数字
    result = result.replace(/\b\d+(\.\d+)?\b/g, `<span style="color:${COLORS.number}">$&</span>`)

    return result
}

function formatCode(code: string, lang: string): string {
    if (!code) return ''
    const normalizedLang = lang?.toLowerCase() || 'text'

    switch (normalizedLang) {
        case 'json':
            try {
                const obj = typeof code === 'string' ? JSON.parse(code) : code
                const jsonStr = JSON.stringify(obj, null, 2)
                return highlightJson(jsonStr)
            } catch {
                return highlightJson(escapeHtml(code))
            }

        case 'javascript':
        case 'js':
        case 'ts':
        case 'typescript':
            return highlightJavaScript(code)

        default:
            return escapeHtml(code)
    }
}

export function CodeBlock({ code, language = 'json', className = '', maxHeight }: CodeBlockProps) {
    const renderedContent = useMemo(() => formatCode(code, language), [code, language])

    return (
        <div
            className={`rounded-lg overflow-hidden ${className}`}
            style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
        >
            <pre
                style={{
                    margin: 0,
                    padding: '12px 16px',
                    backgroundColor: '#1e1e1e',
                    color: '#d4d4d4',
                    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                    fontSize: '13px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    overflowX: 'auto'
                }}
            >
                <code dangerouslySetInnerHTML={{ __html: renderedContent }} />
            </pre>
        </div>
    )
}

// JSON 美化显示组件
export function JsonView({ data, maxHeight }: { data: unknown; maxHeight?: string }) {
    const jsonString = useMemo(() => {
        try {
            return JSON.stringify(data, null, 2)
        } catch {
            return String(data)
        }
    }, [data])

    return <CodeBlock code={jsonString} language="json" maxHeight={maxHeight} />
}
