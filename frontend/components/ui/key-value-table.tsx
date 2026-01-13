'use client'

import * as React from 'react'
import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Minus, Eye, EyeOff, Code, Trash2, FileJson } from 'lucide-react'
import { toast } from 'sonner'

interface KeyValueItem {
    id: string
    key: string
    value: string
    enabled: boolean
}

function valueToItems(value: Record<string, string>): KeyValueItem[] {
    const entries = Object.entries(value || {})
    if (entries.length === 0) {
        return [{ id: crypto.randomUUID(), key: '', value: '', enabled: true }]
    }
    return entries.map(([k, v]) => ({
        id: crypto.randomUUID(),
        key: k,
        value: String(v),
        enabled: true
    }))
}

function itemsToValue(items: KeyValueItem[]): Record<string, string> {
    const result: Record<string, string> = {}
    items.forEach(item => {
        if (item.key && item.enabled) {
            result[item.key] = item.value
        }
    })
    return result
}

interface KeyValueTableProps {
    value: Record<string, string>
    onChange: (value: Record<string, string>) => void
    keyPlaceholder?: string
    valuePlaceholder?: string
    title?: string
    description?: string
    readonly?: boolean
    showToggle?: boolean
    className?: string
}

export function KeyValueTable({
    value,
    onChange,
    keyPlaceholder = '键',
    valuePlaceholder = '值',
    title,
    description,
    readonly = false,
    showToggle = true,
    className
}: KeyValueTableProps) {
    // 使用函数初始化，只在组件挂载时执行一次
    const [items, setItems] = useState<KeyValueItem[]>(() => valueToItems(value))
    const [showJson, setShowJson] = useState(false)
    const [jsonInput, setJsonInput] = useState('')
    const [showJsonInput, setShowJsonInput] = useState(false)

    // 同步到父组件 - 使用 setTimeout 避免在渲染期间更新
    const syncToParent = useCallback(
        (newItems: KeyValueItem[]) => {
            const newValue = itemsToValue(newItems)
            // 使用 setTimeout 延迟调用，避免渲染期间状态更新
            setTimeout(() => onChange(newValue), 0)
        },
        [onChange]
    )

    const handleItemChange = useCallback(
        (id: string, field: 'key' | 'value' | 'enabled', newValue: string | boolean) => {
            setItems(prev => {
                const newItems = prev.map(item => (item.id === id ? { ...item, [field]: newValue } : item))
                syncToParent(newItems)
                return newItems
            })
        },
        [syncToParent]
    )

    const addItem = useCallback(() => {
        setItems(prev => [...prev, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])
    }, [])

    const removeItem = useCallback(
        (id: string) => {
            setItems(prev => {
                if (prev.length <= 1) {
                    const newItems = [{ id: crypto.randomUUID(), key: '', value: '', enabled: true }]
                    syncToParent(newItems)
                    return newItems
                }
                const newItems = prev.filter(item => item.id !== id)
                syncToParent(newItems)
                return newItems
            })
        },
        [syncToParent]
    )

    const copyAsJson = useCallback(() => {
        const result = itemsToValue(items)
        navigator.clipboard.writeText(JSON.stringify(result, null, 2))
        toast.success('已复制到剪贴板')
    }, [items])

    const pasteFromJson = useCallback(() => {
        try {
            const parsed = JSON.parse(jsonInput)
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                toast.error('请输入有效的 JSON 对象')
                return
            }
            const newItems = valueToItems(parsed as Record<string, string>)
            setItems(newItems)
            syncToParent(newItems)
            setShowJsonInput(false)
            setJsonInput('')
            toast.success('JSON 导入成功')
        } catch {
            toast.error('JSON 格式错误')
        }
    }, [jsonInput, syncToParent])

    const hiddenCount = items.filter(i => i.key && !i.enabled).length

    return (
        <div className={cn('space-y-2', className)}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {title && (
                        <span className="text-sm font-medium">
                            {title}
                            {hiddenCount > 0 && (
                                <span className="text-muted-foreground ml-1">（已隐藏{hiddenCount}项）</span>
                            )}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setShowJson(!showJson)}
                        title="查看 JSON"
                    >
                        {showJson ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={copyAsJson}
                        title="复制为 JSON"
                    >
                        <Code className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setShowJsonInput(!showJsonInput)}
                        title="粘贴 JSON"
                    >
                        <FileJson className="h-3.5 w-3.5" />
                    </Button>
                    {!readonly && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                                setItems([{ id: crypto.randomUUID(), key: '', value: '', enabled: true }])
                                onChange({})
                            }}
                            title="清空"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {description && <p className="text-xs text-muted-foreground">{description}</p>}

            {/* JSON 预览 */}
            {showJson && (
                <pre className="p-3 rounded-lg bg-muted/50 text-xs font-mono overflow-auto max-h-32">
                    {JSON.stringify(itemsToValue(items), null, 2) || '{}'}
                </pre>
            )}

            {/* JSON 输入 */}
            {showJsonInput && (
                <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
                    <Textarea
                        value={jsonInput}
                        onChange={e => setJsonInput(e.target.value)}
                        placeholder='{"key": "value"}'
                        rows={4}
                        className="font-mono text-sm"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={pasteFromJson}>
                            导入 JSON
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setShowJsonInput(false)
                                setJsonInput('')
                            }}
                        >
                            取消
                        </Button>
                    </div>
                </div>
            )}

            {/* 表格 */}
            <div className="border rounded-lg overflow-hidden bg-background">
                {/* 表格内容 */}
                <div className="divide-y divide-border">
                    {items.map((item, index) => (
                        <div
                            key={item.id}
                            className={cn(
                                'flex items-center gap-0 transition-colors',
                                !item.enabled && 'opacity-50 bg-muted/30'
                            )}
                        >
                            {/* 启用/禁用复选框 */}
                            {showToggle && !readonly && (
                                <div className="flex items-center justify-center w-10 border-r border-border bg-muted/20">
                                    <Checkbox
                                        checked={item.enabled}
                                        onCheckedChange={checked => handleItemChange(item.id, 'enabled', !!checked)}
                                        className="h-4 w-4"
                                    />
                                </div>
                            )}

                            {/* Key 输入 */}
                            <div className="flex-1 min-w-0">
                                <Input
                                    value={item.key}
                                    onChange={e => handleItemChange(item.id, 'key', e.target.value)}
                                    placeholder={index === 0 ? keyPlaceholder : `${keyPlaceholder} ${index + 1}`}
                                    className="border-0 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-10"
                                    disabled={readonly}
                                />
                            </div>

                            {/* Value 输入 */}
                            <div className="flex-1 min-w-0 border-l border-border">
                                <Input
                                    type="text"
                                    value={item.value}
                                    onChange={e => handleItemChange(item.id, 'value', e.target.value)}
                                    placeholder={index === 0 ? valuePlaceholder : `${valuePlaceholder} ${index + 1}`}
                                    className="border-0 rounded-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-10"
                                    disabled={readonly}
                                />
                            </div>

                            {/* 操作按钮 */}
                            {!readonly && (
                                <div className="flex items-center border-l border-border bg-muted/20">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-10 w-10 rounded-none hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => removeItem(item.id)}
                                    >
                                        <Minus className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* 添加行按钮 */}
                {!readonly && (
                    <div className="border-t border-border">
                        <Button
                            type="button"
                            variant="ghost"
                            className="w-full h-10 rounded-none text-muted-foreground hover:text-foreground"
                            onClick={addItem}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            添加
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}

interface KeyValueDisplayProps {
    value: Record<string, string>
    title?: string
    className?: string
    maskValues?: boolean
}

export function KeyValueDisplay({ value, title, className, maskValues = false }: KeyValueDisplayProps) {
    const entries = Object.entries(value || {})

    if (entries.length === 0) {
        return <div className={cn('text-sm text-muted-foreground', className)}>无数据</div>
    }

    return (
        <div className={cn('space-y-2', className)}>
            {title && <span className="text-sm font-medium">{title}</span>}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <tbody className="divide-y divide-border">
                        {entries.map(([key, val]) => (
                            <tr key={key} className="hover:bg-muted/30">
                                <td className="px-3 py-2 font-medium bg-muted/20 w-1/3 border-r border-border">
                                    {key}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">{maskValues ? '••••••••' : val}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
