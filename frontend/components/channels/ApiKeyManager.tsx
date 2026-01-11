'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Plus, Trash2, Eye, EyeOff, GripVertical, AlertCircle, CheckCircle, Copy, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// APIKey对象类型
export interface ApiKeyItem {
    key: string
    name: string
    enabled: boolean
    weight: number
    usageCount?: number
    errorCount?: number
    lastUsed?: number
    lastError?: number
}

// 轮询策略
export const keyStrategies = [
    { value: 'round-robin', label: '轮询', desc: '按顺序依次使用' },
    { value: 'random', label: '随机', desc: '随机选择一个Key' },
    { value: 'weighted', label: '权重', desc: '根据权重随机分配' },
    { value: 'least-used', label: '最少使用', desc: '优先使用调用次数最少的' },
    { value: 'failover', label: '故障转移', desc: '按顺序使用，失败后切换下一个' }
]

interface ApiKeyManagerProps {
    apiKeys: ApiKeyItem[]
    strategy: string
    onChange: (keys: ApiKeyItem[], strategy: string) => void
    // 是否显示统计信息
    showStats?: boolean
}

/**
 * 多APIKey管理组件
 * 支持添加/删除/启用禁用/权重调整/策略选择
 */
export function ApiKeyManager({ apiKeys, strategy, onChange, showStats = false }: ApiKeyManagerProps) {
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [editForm, setEditForm] = useState<ApiKeyItem>({
        key: '',
        name: '',
        enabled: true,
        weight: 100
    })
    const [showKey, setShowKey] = useState<Record<number, boolean>>({})
    const [batchInput, setBatchInput] = useState('')
    const [batchDialogOpen, setBatchDialogOpen] = useState(false)

    // 打开编辑对话框
    const openEditDialog = (index?: number) => {
        if (index !== undefined && apiKeys[index]) {
            setEditingIndex(index)
            setEditForm({ ...apiKeys[index] })
        } else {
            setEditingIndex(null)
            setEditForm({
                key: '',
                name: `Key ${apiKeys.length + 1}`,
                enabled: true,
                weight: 100
            })
        }
        setEditDialogOpen(true)
    }

    // 保存编辑
    const saveEdit = () => {
        if (!editForm.key.trim()) {
            toast.error('请输入API Key')
            return
        }

        const newKeys = [...apiKeys]
        if (editingIndex !== null) {
            newKeys[editingIndex] = editForm
        } else {
            newKeys.push(editForm)
        }
        onChange(newKeys, strategy)
        setEditDialogOpen(false)
    }

    // 删除Key
    const deleteKey = (index: number) => {
        const newKeys = apiKeys.filter((_, i) => i !== index)
        onChange(newKeys, strategy)
    }

    // 切换启用状态
    const toggleEnabled = (index: number) => {
        const newKeys = [...apiKeys]
        newKeys[index] = { ...newKeys[index], enabled: !newKeys[index].enabled }
        onChange(newKeys, strategy)
    }

    // 复制Key
    const copyKey = (key: string) => {
        navigator.clipboard.writeText(key)
        toast.success('已复制到剪贴板')
    }
    const handleBatchImport = () => {
        const lines = batchInput.trim().split('\n').filter(Boolean)
        if (lines.length === 0) {
            toast.error('请输入API Keys')
            return
        }
        const existingKeys = new Set(apiKeys.map(k => k.key.trim()))
        const seenKeys = new Set<string>()
        const uniqueLines: string[] = []
        let duplicateCount = 0

        for (const line of lines) {
            const trimmedKey = line.trim()
            if (!trimmedKey) continue

            if (existingKeys.has(trimmedKey) || seenKeys.has(trimmedKey)) {
                duplicateCount++
                continue
            }

            seenKeys.add(trimmedKey)
            uniqueLines.push(trimmedKey)
        }

        if (uniqueLines.length === 0) {
            toast.error('所有Key都已存在，无需导入')
            return
        }

        const newKeys: ApiKeyItem[] = uniqueLines.map((key, i) => ({
            key,
            name: `Key ${apiKeys.length + i + 1}`,
            enabled: true,
            weight: 100
        }))

        onChange([...apiKeys, ...newKeys], strategy)
        setBatchDialogOpen(false)
        setBatchInput('')

        if (duplicateCount > 0) {
            toast.success(`成功导入 ${newKeys.length} 个Key，跳过 ${duplicateCount} 个重复`)
        } else {
            toast.success(`成功导入 ${newKeys.length} 个Key`)
        }
    }

    // 重置错误计数
    const resetErrors = (index: number) => {
        const newKeys = [...apiKeys]
        newKeys[index] = {
            ...newKeys[index],
            errorCount: 0,
            lastError: undefined
        }
        onChange(newKeys, strategy)
        toast.success('已重置错误计数')
    }

    // 遮蔽Key显示
    const maskKey = (key: string) => {
        if (key.length <= 12) return '••••••••'
        return `${key.substring(0, 8)}••••${key.slice(-4)}`
    }

    return (
        <div className="space-y-4">
            {/* 策略选择 */}
            <div className="grid gap-2">
                <Label>轮询策略</Label>
                <Select value={strategy} onValueChange={(v: string) => onChange(apiKeys, v)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {keyStrategies.map(s => (
                            <SelectItem key={s.value} value={s.value}>
                                <div className="flex flex-col">
                                    <span>{s.label}</span>
                                    <span className="text-xs text-muted-foreground">{s.desc}</span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Key列表 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>API Keys ({apiKeys.length})</Label>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setBatchDialogOpen(true)}>
                            批量导入
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEditDialog()}>
                            <Plus className="h-4 w-4 mr-1" />
                            添加
                        </Button>
                    </div>
                </div>

                {apiKeys.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                        暂无API Key，点击&quot;添加&quot;按钮添加
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {apiKeys.map((item, index) => (
                            <Card key={index} className={cn('transition-opacity', !item.enabled && 'opacity-50')}>
                                <CardContent className="p-3">
                                    <div className="flex items-center gap-3">
                                        {/* 拖拽手柄 */}
                                        <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />

                                        {/* 状态指示 */}
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger>
                                                    {item.errorCount && item.errorCount >= 5 ? (
                                                        <AlertCircle className="h-4 w-4 text-destructive" />
                                                    ) : item.enabled ? (
                                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                                    ) : (
                                                        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />
                                                    )}
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {item.errorCount && item.errorCount >= 5
                                                        ? `错误次数过多 (${item.errorCount})`
                                                        : item.enabled
                                                          ? '已启用'
                                                          : '已禁用'}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>

                                        {/* Key信息 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm truncate">{item.name}</span>
                                                {strategy === 'weighted' && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        权重: {item.weight}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <code className="text-xs text-muted-foreground font-mono">
                                                    {showKey[index] ? item.key : maskKey(item.key)}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5"
                                                    onClick={() =>
                                                        setShowKey(prev => ({ ...prev, [index]: !prev[index] }))
                                                    }
                                                >
                                                    {showKey[index] ? (
                                                        <EyeOff className="h-3 w-3" />
                                                    ) : (
                                                        <Eye className="h-3 w-3" />
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5"
                                                    onClick={() => copyKey(item.key)}
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </Button>
                                            </div>

                                            {/* 统计信息 */}
                                            {showStats && (
                                                <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                                                    {item.usageCount !== undefined && (
                                                        <span>调用: {item.usageCount}</span>
                                                    )}
                                                    {item.errorCount !== undefined && item.errorCount > 0 && (
                                                        <span className="text-destructive">
                                                            错误: {item.errorCount}
                                                        </span>
                                                    )}
                                                    {item.lastUsed && (
                                                        <span>
                                                            最后使用: {new Date(item.lastUsed).toLocaleString()}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* 操作按钮 */}
                                        <div className="flex items-center gap-1">
                                            {item.errorCount && item.errorCount > 0 && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => resetErrors(index)}
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Switch
                                                checked={item.enabled}
                                                onCheckedChange={() => toggleEnabled(index)}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => openEditDialog(index)}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                                onClick={() => deleteKey(index)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* 编辑对话框 */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingIndex !== null ? '编辑 API Key' : '添加 API Key'}</DialogTitle>
                        <DialogDescription>配置API Key的名称、密钥和权重</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="keyName">名称</Label>
                            <Input
                                id="keyName"
                                value={editForm.name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setEditForm({ ...editForm, name: e.target.value })
                                }
                                placeholder="Key 1"
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="keyValue">API Key</Label>
                            <Input
                                id="keyValue"
                                type="password"
                                value={editForm.key}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setEditForm({ ...editForm, key: e.target.value })
                                }
                                placeholder="sk-..."
                            />
                        </div>

                        <div className="grid gap-2">
                            <div className="flex justify-between">
                                <Label>权重</Label>
                                <span className="text-sm text-muted-foreground">{editForm.weight}</span>
                            </div>
                            <Slider
                                value={[editForm.weight]}
                                min={1}
                                max={100}
                                step={1}
                                onValueChange={(v: number[]) => setEditForm({ ...editForm, weight: v[0] })}
                            />
                            <p className="text-xs text-muted-foreground">
                                权重越高，在&quot;权重&quot;策略下被选中的概率越大
                            </p>
                        </div>

                        <div className="flex items-center justify-between">
                            <Label>启用</Label>
                            <Switch
                                checked={editForm.enabled}
                                onCheckedChange={(checked: boolean) => setEditForm({ ...editForm, enabled: checked })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={saveEdit}>保存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 批量导入对话框 */}
            <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>批量导入 API Keys</DialogTitle>
                        <DialogDescription>每行输入一个API Key</DialogDescription>
                    </DialogHeader>

                    <textarea
                        className="w-full h-40 p-3 border rounded-md font-mono text-sm resize-none"
                        value={batchInput}
                        onChange={e => setBatchInput(e.target.value)}
                        placeholder="sk-key1...&#10;sk-key2...&#10;sk-key3..."
                    />

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleBatchImport}>导入</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default ApiKeyManager
