'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Search, ChevronDown, ChevronUp, CheckCircle, Plus, X } from 'lucide-react'

interface ModelSelectorProps {
    value: string[]
    allModels: string[]
    onChange: (models: string[]) => void
    allowCustom?: boolean // 是否允许自定义模型
    singleSelect?: boolean // 是否单选模式
}

// 模型分组规则
function getModelGroup(model: string): string {
    const lower = model.toLowerCase()
    if (lower.includes('yi-') || lower.includes('零一')) return '零一万物'
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('davinci'))
        return 'OpenAI'
    if (lower.includes('claude')) return 'Claude'
    if (lower.includes('gemini') || lower.includes('gemma')) return 'Gemini'
    if (lower.includes('deepseek')) return 'DeepSeek'
    if (lower.includes('glm') || lower.includes('智谱')) return '智谱 (GLM)'
    if (lower.includes('qwen') || lower.includes('qwq')) return 'Qwen (通义千问)'
    if (lower.includes('doubao') || lower.includes('豆包')) return 'Doubao (豆包)'
    if (lower.includes('mistral')) return 'Mistral AI'
    if (lower.includes('llama')) return 'Llama'
    if (lower.includes('grok')) return 'Grok'
    if (lower.includes('kimi') || lower.includes('moonshot')) return 'Kimi (Moonshot)'
    if (lower.includes('minimax') || lower.includes('abab')) return 'MiniMax'
    if (lower.includes('cohere') || lower.includes('command')) return 'Cohere'
    return '其他'
}

export function ModelSelector({
    value,
    allModels,
    onChange,
    allowCustom = true,
    singleSelect = false
}: ModelSelectorProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedGroup, setExpandedGroup] = useState<string>('')
    const [customInput, setCustomInput] = useState('')

    // 使用 useMemo 确保 selectedSet 与 value 同步
    const selectedSet = useMemo(() => new Set(value), [value])

    // 自定义模型（不在allModels中的已选模型）
    const customModels = useMemo(() => value.filter(m => !allModels.includes(m)), [value, allModels])

    // 分组后的模型
    const groupedModels = useMemo(() => {
        const groups: Record<string, string[]> = {}
        const searchLower = searchQuery.toLowerCase()

        const filteredModels = allModels.filter(model => model.toLowerCase().includes(searchLower))

        filteredModels.forEach(model => {
            const group = getModelGroup(model)
            if (!groups[group]) groups[group] = []
            groups[group].push(model)
        })

        // 按模型数量排序
        return Object.entries(groups)
            .filter(([, models]) => models.length > 0)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([name, models]) => ({ name, models }))
    }, [allModels, searchQuery])

    const toggleModel = (model: string) => {
        if (singleSelect) {
            // 单选模式
            onChange(selectedSet.has(model) ? [] : [model])
        } else {
            const newSet = new Set(selectedSet)
            if (newSet.has(model)) {
                newSet.delete(model)
            } else {
                newSet.add(model)
            }
            onChange(Array.from(newSet))
        }
    }

    // 添加自定义模型
    const addCustomModel = () => {
        const trimmed = customInput.trim()
        if (!trimmed) return
        if (singleSelect) {
            onChange([trimmed])
        } else if (!selectedSet.has(trimmed)) {
            onChange([...value, trimmed])
        }
        setCustomInput('')
    }

    // 删除自定义模型
    const removeCustomModel = (model: string) => {
        onChange(value.filter(m => m !== model))
    }

    const selectAll = () => {
        onChange([...allModels])
    }

    const deselectAll = () => {
        onChange([])
    }

    const selectAllInGroup = (models: string[]) => {
        const newSet = new Set(selectedSet)
        models.forEach(m => newSet.add(m))
        onChange(Array.from(newSet))
    }

    const deselectAllInGroup = (models: string[]) => {
        const newSet = new Set(selectedSet)
        models.forEach(m => newSet.delete(m))
        onChange(Array.from(newSet))
    }

    const getGroupSelectedCount = (models: string[]) => {
        return models.filter(m => selectedSet.has(m)).length
    }

    return (
        <div className="space-y-4">
            {/* 顶部统计 - 移动端优化 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="secondary" className="gap-1">
                    <CheckCircle className="h-3 w-3" />
                    已选择 {value.length}
                    {!singleSelect && ` / ${allModels.length}`}
                </Badge>
                {!singleSelect && (
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={selectAll} className="text-xs px-2 py-1 h-7">
                            全选
                        </Button>
                        <Button variant="outline" size="sm" onClick={deselectAll} className="text-xs px-2 py-1 h-7">
                            取消全选
                        </Button>
                    </div>
                )}
            </div>

            {/* 自定义模型输入 */}
            {allowCustom && (
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <Input
                            value={customInput}
                            onChange={e => setCustomInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addCustomModel()}
                            placeholder="输入自定义模型名称..."
                            className="flex-1"
                        />
                        <Button variant="outline" size="sm" onClick={addCustomModel} disabled={!customInput.trim()}>
                            <Plus className="h-4 w-4 mr-1" />
                            添加
                        </Button>
                    </div>
                    {/* 显示自定义模型 */}
                    {customModels.length > 0 && (
                        <div className="flex flex-wrap gap-1 p-2 border rounded-lg bg-muted/30">
                            <span className="text-xs text-muted-foreground mr-1">自定义:</span>
                            {customModels.map(model => (
                                <Badge key={model} variant="secondary" className="gap-1 pr-1">
                                    {model}
                                    <button
                                        onClick={() => removeCustomModel(model)}
                                        className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 搜索框 */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索模型..."
                    className="pl-9"
                />
            </div>

            {/* 分组列表 - 移动端高度自适应 */}
            <ScrollArea className="h-[300px] sm:h-[400px] pr-2 sm:pr-4">
                <div className="space-y-2">
                    {groupedModels.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">没有找到模型</p>
                    ) : (
                        groupedModels.map(group => {
                            const selectedCount = getGroupSelectedCount(group.models)
                            const isExpanded = expandedGroup === group.name
                            const isAllSelected = selectedCount === group.models.length

                            return (
                                <div key={group.name} className="border rounded-lg overflow-hidden">
                                    {/* 分组头部 */}
                                    <div
                                        className="flex flex-wrap items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 bg-muted/50 cursor-pointer hover:bg-muted/80"
                                        onClick={() => setExpandedGroup(isExpanded ? '' : group.name)}
                                    >
                                        <span className="font-medium flex-1 text-sm">{group.name}</span>
                                        <Badge variant="outline" className="text-xs">
                                            {selectedCount}/{group.models.length}
                                        </Badge>
                                        {!singleSelect && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 px-2 text-xs hidden sm:inline-flex"
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    if (isAllSelected) {
                                                        deselectAllInGroup(group.models)
                                                    } else {
                                                        selectAllInGroup(group.models)
                                                    }
                                                }}
                                            >
                                                {isAllSelected ? '取消' : '全选'}
                                            </Button>
                                        )}
                                        {isExpanded ? (
                                            <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                        )}
                                    </div>

                                    {/* 展开的模型列表 - 移动端单列 */}
                                    {isExpanded && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2 bg-background max-h-[200px] sm:max-h-[250px] overflow-y-auto">
                                            {group.models.map(model => (
                                                <label
                                                    key={model}
                                                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                                                >
                                                    <Checkbox
                                                        checked={selectedSet.has(model)}
                                                        onCheckedChange={() => toggleModel(model)}
                                                    />
                                                    <span className="truncate" title={model}>
                                                        {model}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </ScrollArea>
        </div>
    )
}
