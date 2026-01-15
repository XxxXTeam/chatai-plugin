'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2, Plus, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelMappingEditorProps {
    value: Record<string, string>
    onChange: (value: Record<string, string>) => void
    className?: string
}

// 模板预设
const TEMPLATES: Record<string, Record<string, string>> = {
    'gemini-image': {
        'gemini-3-pro-image': 'gemini-3-pro-preview-image'
    },
    'glm-to-gemini': {
        'glm-4': 'gemini-1.5-pro',
        'glm-4-flash': 'gemini-1.5-flash'
    },
    'gpt-to-claude': {
        'gpt-4': 'claude-3-5-sonnet-20241022',
        'gpt-4o': 'claude-3-5-sonnet-20241022'
    }
}

export function ModelMappingEditor({ value, onChange, className }: ModelMappingEditorProps) {
    const [mode, setMode] = useState<'visual' | 'manual'>('visual')
    const [jsonError, setJsonError] = useState('')
    const [localPairs, setLocalPairs] = useState<Array<{ key: string; value: string }> | null>(null)
    const [templateOpen, setTemplateOpen] = useState(false)
    const pairs = useMemo(() => {
        if (localPairs !== null) return localPairs
        const entries = Object.entries(value || {})
        return entries.map(([key, val]) => ({ key, value: val }))
    }, [value, localPairs])
    const jsonText = useMemo(() => {
        return JSON.stringify(value || {}, null, 2)
    }, [value])
    const updatePair = (index: number, field: 'key' | 'value', newValue: string) => {
        const newPairs = [...pairs]
        newPairs[index][field] = newValue
        setLocalPairs(newPairs)
        const newMapping: Record<string, string> = {}
        newPairs.forEach(p => {
            if (p.key.trim()) {
                newMapping[p.key.trim()] = p.value.trim()
            }
        })
        onChange(newMapping)
        setLocalPairs(null)
    }

    // 添加新键值对
    const addPair = () => {
        const newPairs = [...pairs, { key: '', value: '' }]
        setLocalPairs(newPairs)
    }

    // 删除键值对
    const removePair = (index: number) => {
        const newPairs = pairs.filter((_, i) => i !== index)
        setLocalPairs(newPairs)

        const newMapping: Record<string, string> = {}
        newPairs.forEach(p => {
            if (p.key.trim()) {
                newMapping[p.key.trim()] = p.value.trim()
            }
        })
        onChange(newMapping)
        setLocalPairs(null)
    }

    // 手动模式：解析JSON
    const [localJsonText, setLocalJsonText] = useState<string | null>(null)
    const displayJsonText = localJsonText !== null ? localJsonText : jsonText

    const handleJsonChange = (text: string) => {
        setLocalJsonText(text)
        setJsonError('')

        if (!text.trim()) {
            onChange({})
            return
        }

        try {
            const parsed = JSON.parse(text)
            if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                setJsonError('必须是一个对象')
                return
            }
            // 验证所有值都是字符串
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v !== 'string') {
                    setJsonError(`"${k}" 的值必须是字符串`)
                    return
                }
            }
            onChange(parsed)
            setLocalJsonText(null) // 重置本地状态
        } catch {
            setJsonError('JSON 格式错误')
        }
    }

    // 填入模板
    const applyTemplate = (templateKey: string) => {
        const template = TEMPLATES[templateKey]
        if (template) {
            const merged = { ...value, ...template }
            onChange(merged)
        }
    }

    return (
        <div className={cn('space-y-3', className)}>
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">模型重定向</Label>
            </div>

            {/* 模式切换 */}
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setMode('visual')}
                        className={cn(
                            'px-2 py-1 rounded transition-colors',
                            mode === 'visual'
                                ? 'text-primary font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        可视化
                    </button>
                    <span className="text-muted-foreground">/</span>
                    <button
                        type="button"
                        onClick={() => setMode('manual')}
                        className={cn(
                            'px-2 py-1 rounded transition-colors',
                            mode === 'manual'
                                ? 'text-primary font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        手动编辑
                    </button>
                </div>

                {/* 模板下拉 */}
                <div className="relative">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        type="button"
                        onClick={() => setTemplateOpen(!templateOpen)}
                    >
                        填入模板
                    </Button>
                    {templateOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-popover border rounded-md shadow-lg z-50 min-w-[160px]">
                            <div className="p-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        applyTemplate('gemini-image')
                                        setTemplateOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent"
                                >
                                    Gemini 图片模型
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        applyTemplate('glm-to-gemini')
                                        setTemplateOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent"
                                >
                                    GLM → Gemini
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        applyTemplate('gpt-to-claude')
                                        setTemplateOpen(false)
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent"
                                >
                                    GPT → Claude
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 可视化模式 */}
            {mode === 'visual' && (
                <div className="space-y-2">
                    {pairs.map((pair, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <Input
                                placeholder="源模型名称"
                                value={pair.key}
                                onChange={e => updatePair(index, 'key', e.target.value)}
                                className="flex-1 h-9 text-sm"
                            />
                            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            <Input
                                placeholder="目标模型名称"
                                value={pair.value}
                                onChange={e => updatePair(index, 'value', e.target.value)}
                                className="flex-1 h-9 text-sm"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => removePair(index)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}

                    <Button type="button" variant="outline" size="sm" className="w-full h-8 text-sm" onClick={addPair}>
                        <Plus className="h-4 w-4 mr-1" />
                        添加键值对
                    </Button>
                </div>
            )}

            {/* 手动编辑模式 */}
            {mode === 'manual' && (
                <div className="space-y-2">
                    <textarea
                        value={displayJsonText}
                        onChange={e => handleJsonChange(e.target.value)}
                        placeholder={'{\n  "源模型": "目标模型"\n}'}
                        className={cn(
                            'w-full h-32 p-3 text-sm font-mono rounded-md border bg-muted/30 resize-none',
                            'focus:outline-none focus:ring-2 focus:ring-ring',
                            jsonError && 'border-destructive focus:ring-destructive'
                        )}
                    />
                    {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                </div>
            )}

            <p className="text-xs text-muted-foreground">键为请求中的模型名称，值为要替换的模型名称</p>
        </div>
    )
}
