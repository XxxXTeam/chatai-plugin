'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Zap, Image, FileText, Calendar } from 'lucide-react'
import { FeatureItem } from './FeatureSwitch'
import { FormField, FormRow } from './FormSection'
import { GroupFormState } from '@/lib/types'

type TriState = 'inherit' | 'on' | 'off'

interface FeaturesPanelProps {
    form: GroupFormState
    onChange: (updates: Partial<GroupFormState>) => void
    models: string[]
    disabled?: boolean
}

/**
 * 功能配置面板
 * 包含工具调用、绘图、总结、事件处理等功能开关
 */
export function FeaturesPanel({
    form,
    onChange,
    models,
    disabled = false
}: FeaturesPanelProps) {
    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-2">
                群管理员也可通过命令控制这些功能
            </p>

            {/* 工具调用 */}
            <FeatureItem
                icon={<Zap className="h-4 w-4" />}
                title="工具调用"
                desc="允许AI使用搜索、代码执行等工具"
                value={form.toolsEnabled}
                onChange={v => onChange({ toolsEnabled: v })}
                disabled={disabled}
            />

            {/* 绘图功能 */}
            <FeatureItem
                icon={<Image className="h-4 w-4" />}
                title="绘图功能"
                desc="文生图、图生图等"
                value={form.imageGenEnabled}
                onChange={v => onChange({ imageGenEnabled: v })}
                disabled={disabled}
            >
                <FormField label="绘图模型">
                    <Select
                        value={form.imageGenModel || '__default__'}
                        onValueChange={v => onChange({ imageGenModel: v === '__default__' ? '' : v })}
                        disabled={disabled}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="继承全局" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__default__">继承全局</SelectItem>
                            {models.map(m => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
                <FormRow>
                    <FormField label="文生图模型" hint="留空继承通用绘图模型">
                        <Select
                            value={form.text2imgModel || '__default__'}
                            onValueChange={v => onChange({ text2imgModel: v === '__default__' ? '' : v })}
                            disabled={disabled}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="继承通用" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__default__">继承通用</SelectItem>
                                {models.map(m => (
                                    <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label="图生图模型" hint="留空继承通用绘图模型">
                        <Select
                            value={form.img2imgModel || '__default__'}
                            onValueChange={v => onChange({ img2imgModel: v === '__default__' ? '' : v })}
                            disabled={disabled}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="继承通用" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__default__">继承通用</SelectItem>
                                {models.map(m => (
                                    <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                </FormRow>
                <FormRow>
                    <FormField label="图片尺寸">
                        <Select
                            value={form.imageGenSize}
                            onValueChange={v => onChange({ imageGenSize: v })}
                            disabled={disabled}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1024x1024">1024x1024</SelectItem>
                                <SelectItem value="1792x1024">1792x1024 (横)</SelectItem>
                                <SelectItem value="1024x1792">1024x1792 (竖)</SelectItem>
                                <SelectItem value="512x512">512x512</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label="图片质量">
                        <Select
                            value={form.imageGenQuality}
                            onValueChange={v => onChange({ imageGenQuality: v })}
                            disabled={disabled}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="standard">标准</SelectItem>
                                <SelectItem value="hd">高清</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>
                </FormRow>
                <FormField label="每日限额" hint="0 表示不限制">
                    <Input
                        type="number"
                        min={0}
                        value={form.imageGenDailyLimit}
                        onChange={e => onChange({ imageGenDailyLimit: parseInt(e.target.value) || 0 })}
                        disabled={disabled}
                    />
                </FormField>
            </FeatureItem>

            {/* 群聊总结 */}
            <FeatureItem
                icon={<FileText className="h-4 w-4" />}
                title="群聊总结"
                desc="AI生成群聊内容总结"
                value={form.summaryEnabled}
                onChange={v => onChange({ summaryEnabled: v })}
                disabled={disabled}
            >
                <FormField label="总结模型">
                    <Select
                        value={form.summaryModel || '__default__'}
                        onValueChange={v => onChange({ summaryModel: v === '__default__' ? '' : v })}
                        disabled={disabled}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="继承全局" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__default__">继承全局</SelectItem>
                            {models.map(m => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
            </FeatureItem>

            {/* 事件处理 */}
            <FeatureItem
                icon={<Calendar className="h-4 w-4" />}
                title="事件处理"
                desc="入群欢迎、戳一戳等事件响应"
                value={form.eventEnabled}
                onChange={v => onChange({ eventEnabled: v })}
                disabled={disabled}
            />
        </div>
    )
}

export default FeaturesPanel
