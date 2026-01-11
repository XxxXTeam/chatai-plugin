'use client'

import { useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Textarea } from './textarea'
import { Button } from './button'
import { Tabs, TabsList, TabsTrigger } from './tabs'
import {
    Eye,
    Edit,
    Columns,
    Maximize2,
    Minimize2,
    Bold,
    Italic,
    Code,
    Link,
    List,
    ListOrdered,
    Quote,
    Table,
    Heading1,
    Heading2,
    Heading3
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MarkdownEditorProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    minHeight?: string
}

export function MarkdownEditor({
    value,
    onChange,
    placeholder = '输入 Markdown 内容...',
    className,
    minHeight = '400px'
}: MarkdownEditorProps) {
    const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split')
    const [isFullscreen, setIsFullscreen] = useState(false)

    // 插入文本的辅助函数
    const insertText = useCallback(
        (before: string, after: string = '', placeholder: string = '') => {
            const textarea = document.getElementById('md-editor') as HTMLTextAreaElement
            if (!textarea) return

            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            const selectedText = value.substring(start, end) || placeholder

            const newText = value.substring(0, start) + before + selectedText + after + value.substring(end)
            onChange(newText)

            // 恢复光标位置
            setTimeout(() => {
                textarea.focus()
                const newCursorPos = start + before.length + selectedText.length
                textarea.setSelectionRange(newCursorPos, newCursorPos)
            }, 0)
        },
        [value, onChange]
    )

    // 工具栏按钮
    const toolbarButtons = useMemo(
        () => [
            { icon: Bold, title: '粗体', action: () => insertText('**', '**', '粗体文本') },
            { icon: Italic, title: '斜体', action: () => insertText('*', '*', '斜体文本') },
            { icon: Code, title: '代码', action: () => insertText('`', '`', 'code') },
            { icon: Link, title: '链接', action: () => insertText('[', '](url)', '链接文本') },
            { icon: Heading1, title: '标题1', action: () => insertText('\n# ', '\n', '标题') },
            { icon: Heading2, title: '标题2', action: () => insertText('\n## ', '\n', '标题') },
            { icon: Heading3, title: '标题3', action: () => insertText('\n### ', '\n', '标题') },
            { icon: List, title: '无序列表', action: () => insertText('\n- ', '\n', '列表项') },
            { icon: ListOrdered, title: '有序列表', action: () => insertText('\n1. ', '\n', '列表项') },
            { icon: Quote, title: '引用', action: () => insertText('\n> ', '\n', '引用文本') },
            {
                icon: Table,
                title: '表格',
                action: () => insertText('\n| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| ', ' |  |  |\n', '内容')
            }
        ],
        [insertText]
    )

    // Markdown 渲染组件
    const MarkdownPreview = useMemo(
        () => (
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                    h1: props => <h1 className="text-2xl font-bold mt-6 mb-4 border-b pb-2" {...props} />,
                    h2: props => <h2 className="text-xl font-bold mt-5 mb-3 border-b pb-1" {...props} />,
                    h3: props => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
                    h4: props => <h4 className="text-base font-semibold mt-3 mb-2" {...props} />,
                    p: props => <p className="my-2 leading-relaxed" {...props} />,
                    ul: props => <ul className="list-disc list-inside my-2 space-y-1" {...props} />,
                    ol: props => <ol className="list-decimal list-inside my-2 space-y-1" {...props} />,
                    li: props => <li className="ml-2" {...props} />,
                    blockquote: props => (
                        <blockquote
                            className="border-l-4 border-primary/50 pl-4 my-3 italic text-muted-foreground"
                            {...props}
                        />
                    ),
                    code: ({
                        className,
                        children,
                        ...props
                    }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
                        const isInline = !className
                        if (isInline) {
                            return <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                        }
                        return (
                            <pre className="bg-muted p-4 rounded-lg my-3 overflow-x-auto">
                                <code className="text-sm font-mono" {...props}>
                                    {children}
                                </code>
                            </pre>
                        )
                    },
                    table: props => (
                        <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-border" {...props} />
                        </div>
                    ),
                    thead: props => <thead className="bg-muted" {...props} />,
                    th: props => <th className="border border-border px-4 py-2 text-left font-semibold" {...props} />,
                    td: props => <td className="border border-border px-4 py-2" {...props} />,
                    a: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
                        <a
                            href={href}
                            className="text-primary hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                            {...props}
                        />
                    ),
                    hr: () => <hr className="my-6 border-border" />,
                    strong: props => <strong className="font-bold" {...props} />,
                    em: props => <em className="italic" {...props} />
                }}
            >
                {value || '*预览区域*\n\n在左侧输入 Markdown 内容，这里会实时显示渲染结果。'}
            </ReactMarkdown>
        ),
        [value]
    )

    const containerClass = cn(
        'border rounded-lg overflow-hidden flex flex-col',
        isFullscreen && 'fixed inset-4 z-50 bg-background shadow-2xl',
        className
    )

    return (
        <div className={containerClass} style={{ minHeight: isFullscreen ? undefined : minHeight }}>
            {/* 工具栏 */}
            <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-1">
                <div className="flex items-center gap-0.5">
                    {toolbarButtons.map((btn, idx) => (
                        <Button
                            key={idx}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={btn.action}
                            title={btn.title}
                            disabled={mode === 'preview'}
                        >
                            <btn.icon className="h-4 w-4" />
                        </Button>
                    ))}
                </div>

                <div className="flex items-center gap-1">
                    <Tabs value={mode} onValueChange={v => setMode(v as 'split' | 'edit' | 'preview')}>
                        <TabsList className="h-7">
                            <TabsTrigger value="edit" className="h-6 px-2 text-xs">
                                <Edit className="h-3 w-3 mr-1" />
                                编辑
                            </TabsTrigger>
                            <TabsTrigger value="split" className="h-6 px-2 text-xs">
                                <Columns className="h-3 w-3 mr-1" />
                                分栏
                            </TabsTrigger>
                            <TabsTrigger value="preview" className="h-6 px-2 text-xs">
                                <Eye className="h-3 w-3 mr-1" />
                                预览
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        title={isFullscreen ? '退出全屏' : '全屏编辑'}
                    >
                        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 编辑区 */}
                {(mode === 'edit' || mode === 'split') && (
                    <div className={cn('flex-1 flex flex-col', mode === 'split' && 'border-r')}>
                        <Textarea
                            id="md-editor"
                            value={value}
                            onChange={e => onChange(e.target.value)}
                            placeholder={placeholder}
                            className="flex-1 resize-none border-0 rounded-none font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                            style={{ minHeight: isFullscreen ? 'calc(100vh - 120px)' : '350px' }}
                        />
                        <div className="text-xs text-muted-foreground px-2 py-1 border-t bg-muted/20">
                            {value.length.toLocaleString()} 字符 | {value.split('\n').length} 行
                        </div>
                    </div>
                )}

                {/* 预览区 */}
                {(mode === 'preview' || mode === 'split') && (
                    <div className={cn('flex-1 overflow-auto', mode === 'split' && 'max-w-[50%]')}>
                        <div
                            className="p-4 prose prose-sm dark:prose-invert max-w-none overflow-auto"
                            style={{
                                height: isFullscreen ? 'calc(100vh - 80px)' : minHeight,
                                maxHeight: isFullscreen ? 'calc(100vh - 80px)' : minHeight
                            }}
                        >
                            {MarkdownPreview}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default MarkdownEditor
