'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export interface ChannelFormData {
    name: string
    baseUrl: string
    apiKey: string
    adapterType: string
    models: string
    enabled: boolean
    priority: number
    // 高级配置
    modelsPath?: string
    chatPath?: string
    // 图片处理
    imageTransferMode?: 'base64' | 'url' | 'auto'
    imageCompress?: boolean
    imageQuality?: number
    imageMaxSize?: number
}

interface ChannelDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    channelForm: ChannelFormData
    onChannelFormChange: (form: ChannelFormData) => void
    onSave: () => void
    isEditing: boolean
    // 获取模型列表相关
    onFetchModels?: () => Promise<string[]>
    authToken?: string
}

/**
 * 统一的渠道编辑对话框组件
 * 用于 group-admin 和 groups/edit 页面
 */
export function ChannelDialog({
    open,
    onOpenChange,
    channelForm,
    onChannelFormChange,
    onSave,
    isEditing,
    onFetchModels,
    authToken
}: ChannelDialogProps) {
    const [showApiKey, setShowApiKey] = useState(false)
    const [fetchingModels, setFetchingModels] = useState(false)
    const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [selectedModels, setSelectedModels] = useState<string[]>([])
    const [showAdvanced, setShowAdvanced] = useState(false)

    const handleFetchModels = async () => {
        if (!channelForm.baseUrl || !channelForm.apiKey) {
            toast.error('请先填写 Base URL 和 API Key')
            return
        }

        setFetchingModels(true)
        try {
            if (onFetchModels) {
                const models = await onFetchModels()
                setAvailableModels(models)
                setSelectedModels(channelForm.models.split(',').map(m => m.trim()).filter(Boolean))
                setModelSelectorOpen(true)
            } else {
                // 默认实现
                const endpoint = authToken ? '/api/group-admin/models/fetch' : '/api/admin/models/fetch'
                const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                if (authToken) headers.Authorization = `Bearer ${authToken}`

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        baseUrl: channelForm.baseUrl,
                        apiKey: channelForm.apiKey,
                        adapterType: channelForm.adapterType
                    })
                })
                const data = await res.json()
                if (data.code === 0) {
                    setAvailableModels(data.data)
                    setSelectedModels(channelForm.models.split(',').map(m => m.trim()).filter(Boolean))
                    setModelSelectorOpen(true)
                } else {
                    toast.error(data.message || '获取失败')
                }
            }
        } catch {
            toast.error('获取失败')
        } finally {
            setFetchingModels(false)
        }
    }

    const updateForm = (updates: Partial<ChannelFormData>) => {
        onChannelFormChange({ ...channelForm, ...updates })
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{isEditing ? '编辑渠道' : '添加渠道'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>渠道名称</Label>
                                <Input
                                    value={channelForm.name}
                                    onChange={e => updateForm({ name: e.target.value })}
                                    placeholder="例如：OpenAI-1"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>适配器类型</Label>
                                <Select value={channelForm.adapterType} onValueChange={v => updateForm({ adapterType: v })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="openai">OpenAI</SelectItem>
                                        <SelectItem value="azure">Azure</SelectItem>
                                        <SelectItem value="claude">Claude</SelectItem>
                                        <SelectItem value="gemini">Gemini</SelectItem>
                                        <SelectItem value="ollama">Ollama</SelectItem>
                                        <SelectItem value="deepseek">DeepSeek</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>API 地址</Label>
                            <Input
                                value={channelForm.baseUrl}
                                onChange={e => updateForm({ baseUrl: e.target.value })}
                                placeholder="https://api.openai.com/v1"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>API Key</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={channelForm.apiKey}
                                    onChange={e => updateForm({ apiKey: e.target.value })}
                                    placeholder="sk-..."
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                >
                                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                            {channelForm.apiKey.startsWith('****') && (
                                <p className="text-xs text-muted-foreground">当前为掩码显示，不修改则保留原值</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label>模型列表</Label>
                            <div className="flex gap-2">
                                <Input
                                    value={channelForm.models}
                                    onChange={e => updateForm({ models: e.target.value })}
                                    placeholder="模型名称，用逗号分隔。如：gpt-4, gpt-3.5-turbo"
                                    className="flex-1"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={handleFetchModels}
                                    disabled={fetchingModels}
                                >
                                    <RefreshCw className={fetchingModels ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">点击刷新按钮可自动获取可用模型</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center justify-between p-3 rounded-lg border">
                                <Label>启用此渠道</Label>
                                <Switch checked={channelForm.enabled} onCheckedChange={v => updateForm({ enabled: v })} />
                            </div>
                            <div className="space-y-2">
                                <Label>权重</Label>
                                <Input
                                    type="number"
                                    value={channelForm.priority}
                                    onChange={e => updateForm({ priority: parseInt(e.target.value) || 0 })}
                                />
                            </div>
                        </div>

                        {/* 高级配置 */}
                        <div className="border-t pt-4">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className="w-full"
                            >
                                {showAdvanced ? '收起' : '展开'}高级配置
                            </Button>
                        </div>

                        {showAdvanced && (
                            <div className="space-y-4 p-4 rounded-lg bg-muted/30">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs">模型列表路径</Label>
                                        <Input
                                            value={channelForm.modelsPath || ''}
                                            onChange={e => updateForm({ modelsPath: e.target.value })}
                                            placeholder="/models"
                                            className="h-9"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs">对话接口路径</Label>
                                        <Input
                                            value={channelForm.chatPath || ''}
                                            onChange={e => updateForm({ chatPath: e.target.value })}
                                            placeholder="/chat/completions"
                                            className="h-9"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs">图片传输方式</Label>
                                    <Select
                                        value={channelForm.imageTransferMode || 'auto'}
                                        onValueChange={v => updateForm({ imageTransferMode: v as 'base64' | 'url' | 'auto' })}
                                    >
                                        <SelectTrigger className="h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="auto">自动检测</SelectItem>
                                            <SelectItem value="base64">Base64</SelectItem>
                                            <SelectItem value="url">URL</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="flex items-center justify-between p-2 rounded border">
                                    <Label className="text-xs">压缩图片</Label>
                                    <Switch
                                        checked={channelForm.imageCompress ?? true}
                                        onCheckedChange={v => updateForm({ imageCompress: v })}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button onClick={onSave}>{isEditing ? '更新' : '添加'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 模型选择器 */}
            <Dialog open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>选择模型</DialogTitle>
                    </DialogHeader>
                    <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-2">
                            {availableModels.map(model => (
                                <div key={model} className="flex items-center gap-2">
                                    <Checkbox
                                        checked={selectedModels.includes(model)}
                                        onCheckedChange={checked => {
                                            if (checked) {
                                                setSelectedModels([...selectedModels, model])
                                            } else {
                                                setSelectedModels(selectedModels.filter(m => m !== model))
                                            }
                                        }}
                                    />
                                    <Label className="text-sm font-normal">{model}</Label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSelectedModels(availableModels)}>
                            全选
                        </Button>
                        <Button variant="outline" onClick={() => setSelectedModels([])}>
                            清空
                        </Button>
                        <Button
                            onClick={() => {
                                updateForm({ models: selectedModels.join(', ') })
                                setModelSelectorOpen(false)
                            }}
                        >
                            确认 ({selectedModels.length})
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
