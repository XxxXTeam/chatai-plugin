'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Power } from 'lucide-react'
import { FormSection, FormRow, FormField } from './FormSection'
import { GroupFormState, Preset } from '@/lib/types'

interface BasicSettingsPanelProps {
    form: GroupFormState
    onChange: (updates: Partial<GroupFormState>) => void
    presets: Preset[]
    disabled?: boolean
    showGroupId?: boolean
}

/**
 * 基础设置面板
 * 包含群号、预设、触发模式、人设等基础配置
 */
export function BasicSettingsPanel({
    form,
    onChange,
    presets,
    disabled = false,
    showGroupId = true
}: BasicSettingsPanelProps) {
    const selectedPreset = presets.find(p => p.id === form.presetId)

    return (
        <div className="space-y-4">
            <FormRow>
                {showGroupId && (
                    <FormField label="群号">
                        <Input value={form.groupId} disabled />
                    </FormField>
                )}
                <FormField label="群名称">
                    <Input
                        value={form.groupName}
                        onChange={e => onChange({ groupName: e.target.value })}
                        placeholder="可选，便于识别"
                        disabled={disabled}
                    />
                </FormField>
            </FormRow>

            <FormRow>
                <FormField label="使用预设">
                    <Select
                        value={form.presetId || '__default__'}
                        onValueChange={v => onChange({ presetId: v === '__default__' ? '' : v })}
                        disabled={disabled}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="使用默认预设" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__default__">使用默认预设</SelectItem>
                            {presets.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                    <div className="flex flex-col">
                                        <span>{p.name}</span>
                                        {p.description && (
                                            <span className="text-xs text-muted-foreground">
                                                {p.description}
                                            </span>
                                        )}
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {selectedPreset?.systemPromptPreview && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                            {selectedPreset.systemPromptPreview}
                        </p>
                    )}
                </FormField>

                <FormField label="触发模式">
                    <Select
                        value={form.triggerMode}
                        onValueChange={v => onChange({ triggerMode: v })}
                        disabled={disabled}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">默认</SelectItem>
                            <SelectItem value="at">仅@触发</SelectItem>
                            <SelectItem value="prefix">仅前缀触发</SelectItem>
                            <SelectItem value="all">全部消息</SelectItem>
                        </SelectContent>
                    </Select>
                </FormField>
            </FormRow>

            <FormField label="自定义前缀">
                <Input
                    value={form.customPrefix}
                    onChange={e => onChange({ customPrefix: e.target.value })}
                    placeholder="留空使用全局前缀，如 #ai"
                    disabled={disabled}
                />
            </FormField>

            <FormField
                label="独立人设"
                hint="支持变量: {{user_name}} {{group_name}} {{date}} 等 | 表达式: ${e.user_id} (e为event)"
            >
                <Textarea
                    value={form.systemPrompt}
                    onChange={e => onChange({ systemPrompt: e.target.value })}
                    placeholder="不填写则使用预设配置..."
                    rows={3}
                    className="font-mono text-sm"
                    disabled={disabled}
                />
            </FormField>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                    <Power className="h-4 w-4" />
                    <Label>启用AI响应</Label>
                </div>
                <Switch
                    checked={form.enabled}
                    onCheckedChange={v => onChange({ enabled: v })}
                    disabled={disabled}
                />
            </div>
        </div>
    )
}

export default BasicSettingsPanel
