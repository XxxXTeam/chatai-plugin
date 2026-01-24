'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, MessageCircle, Clock } from 'lucide-react'
import { FeatureItem } from './FeatureSwitch'
import { TriStateSwitch } from './TriStateSwitch'
import { FormSection, FormField, FormRow, FormGroup, FormDivider } from './FormSection'
import { GroupFormState, Preset } from '@/lib/types'

type TriState = 'inherit' | 'on' | 'off'

interface BymPanelProps {
    form: GroupFormState
    onChange: (updates: Partial<GroupFormState>) => void
    presets: Preset[]
    models: string[]
    disabled?: boolean
}

/**
 * 伪人模式配置面板
 * 包含伪人模式开关、参数配置、主动发言设置等
 */
export function BymPanel({
    form,
    onChange,
    presets,
    models,
    disabled = false
}: BymPanelProps) {
    const showCustomPrompt = form.bymPresetId === '__custom__'

    return (
        <div className="space-y-4">
            {/* 伪人模式主开关 */}
            <FeatureItem
                icon={<Sparkles className="h-4 w-4" />}
                title="伪人模式"
                desc="让AI模拟真人发言风格，随机参与群聊"
                value={form.bymEnabled}
                onChange={v => onChange({ bymEnabled: v })}
                disabled={disabled}
            >
                {/* 基础配置 */}
                <FormSection title="基础配置">
                    <FormRow>
                        <FormField label="伪人预设">
                            <Select
                                value={form.bymPresetId}
                                onValueChange={v => onChange({ bymPresetId: v })}
                                disabled={disabled}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__default__">使用默认预设</SelectItem>
                                    <SelectItem value="__custom__">自定义提示词</SelectItem>
                                    {presets.map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>

                        <FormField label="伪人模型">
                            <Select
                                value={form.bymModel || '__default__'}
                                onValueChange={v => onChange({ bymModel: v === '__default__' ? '' : v })}
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
                    </FormRow>

                    {showCustomPrompt && (
                        <FormField label="自定义提示词">
                            <Textarea
                                value={form.bymPrompt}
                                onChange={e => onChange({ bymPrompt: e.target.value })}
                                placeholder="输入伪人模式的自定义提示词..."
                                rows={3}
                                className="font-mono text-sm"
                                disabled={disabled}
                            />
                        </FormField>
                    )}
                </FormSection>

                {/* 参数配置 */}
                <FormSection title="参数配置">
                    <FormRow>
                        <FormField label="触发概率">
                            <div className="flex items-center gap-2">
                                <TriStateSwitch
                                    value={form.bymProbability === 'inherit' ? 'inherit' : 'on'}
                                    onChange={v => onChange({ 
                                        bymProbability: v === 'inherit' ? 'inherit' : 0.02 
                                    })}
                                    labels={{ inherit: '继承', on: '自定义', off: '自定义' }}
                                    disabled={disabled}
                                />
                                {form.bymProbability !== 'inherit' && (
                                    <Input
                                        type="number"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={form.bymProbability}
                                        onChange={e => onChange({ 
                                            bymProbability: parseFloat(e.target.value) || 0 
                                        })}
                                        className="w-24"
                                        disabled={disabled}
                                    />
                                )}
                            </div>
                        </FormField>

                        <FormField label="生成温度">
                            <div className="flex items-center gap-2">
                                <TriStateSwitch
                                    value={form.bymTemperature === 'inherit' ? 'inherit' : 'on'}
                                    onChange={v => onChange({ 
                                        bymTemperature: v === 'inherit' ? 'inherit' : 0.9 
                                    })}
                                    labels={{ inherit: '继承', on: '自定义', off: '自定义' }}
                                    disabled={disabled}
                                />
                                {form.bymTemperature !== 'inherit' && (
                                    <Input
                                        type="number"
                                        min={0}
                                        max={2}
                                        step={0.1}
                                        value={form.bymTemperature}
                                        onChange={e => onChange({ 
                                            bymTemperature: parseFloat(e.target.value) || 0.9 
                                        })}
                                        className="w-24"
                                        disabled={disabled}
                                    />
                                )}
                            </div>
                        </FormField>
                    </FormRow>

                    <FormRow>
                        <FormField label="回复长度">
                            <Select
                                value={form.bymReplyLength}
                                onValueChange={v => onChange({ bymReplyLength: v })}
                                disabled={disabled}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="short">简短 (1-2句)</SelectItem>
                                    <SelectItem value="medium">中等 (2-4句)</SelectItem>
                                    <SelectItem value="long">较长 (4句以上)</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormField>

                        <FormField label="使用表情">
                            <div className="flex items-center h-10">
                                <Switch
                                    checked={form.bymUseEmoji}
                                    onCheckedChange={v => onChange({ bymUseEmoji: v })}
                                    disabled={disabled}
                                />
                            </div>
                        </FormField>
                    </FormRow>
                </FormSection>

                <FormDivider label="主动发言" />

                {/* 主动发言配置 */}
                <FeatureItem
                    icon={<MessageCircle className="h-4 w-4" />}
                    title="主动发言"
                    desc="让AI主动参与群聊讨论"
                    value={form.proactiveChatEnabled}
                    onChange={v => onChange({ proactiveChatEnabled: v })}
                    disabled={disabled}
                >
                    <FormRow>
                        <FormField label="主动发言概率">
                            <div className="flex items-center gap-2">
                                <TriStateSwitch
                                    value={form.proactiveChatProbability === 'inherit' ? 'inherit' : 'on'}
                                    onChange={v => onChange({ 
                                        proactiveChatProbability: v === 'inherit' ? 'inherit' : 0.05 
                                    })}
                                    labels={{ inherit: '继承', on: '自定义', off: '自定义' }}
                                    disabled={disabled}
                                />
                                {form.proactiveChatProbability !== 'inherit' && (
                                    <Input
                                        type="number"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={form.proactiveChatProbability}
                                        onChange={e => onChange({ 
                                            proactiveChatProbability: parseFloat(e.target.value) || 0 
                                        })}
                                        className="w-24"
                                        disabled={disabled}
                                    />
                                )}
                            </div>
                        </FormField>

                        <FormField label="冷却时间(分钟)">
                            <div className="flex items-center gap-2">
                                <TriStateSwitch
                                    value={form.proactiveChatCooldown === 'inherit' ? 'inherit' : 'on'}
                                    onChange={v => onChange({ 
                                        proactiveChatCooldown: v === 'inherit' ? 'inherit' : 10 
                                    })}
                                    labels={{ inherit: '继承', on: '自定义', off: '自定义' }}
                                    disabled={disabled}
                                />
                                {form.proactiveChatCooldown !== 'inherit' && (
                                    <Input
                                        type="number"
                                        min={1}
                                        value={form.proactiveChatCooldown}
                                        onChange={e => onChange({ 
                                            proactiveChatCooldown: parseInt(e.target.value) || 10 
                                        })}
                                        className="w-24"
                                        disabled={disabled}
                                    />
                                )}
                            </div>
                        </FormField>
                    </FormRow>

                    <FormRow>
                        <FormField label="每日最大次数">
                            <div className="flex items-center gap-2">
                                <TriStateSwitch
                                    value={form.proactiveChatMaxDaily === 'inherit' ? 'inherit' : 'on'}
                                    onChange={v => onChange({ 
                                        proactiveChatMaxDaily: v === 'inherit' ? 'inherit' : 20 
                                    })}
                                    labels={{ inherit: '继承', on: '自定义', off: '自定义' }}
                                    disabled={disabled}
                                />
                                {form.proactiveChatMaxDaily !== 'inherit' && (
                                    <Input
                                        type="number"
                                        min={0}
                                        value={form.proactiveChatMaxDaily}
                                        onChange={e => onChange({ 
                                            proactiveChatMaxDaily: parseInt(e.target.value) || 20 
                                        })}
                                        className="w-24"
                                        disabled={disabled}
                                    />
                                )}
                            </div>
                        </FormField>

                        <FormField label="最少消息数">
                            <Input
                                type="number"
                                min={1}
                                value={form.proactiveChatMinMessages}
                                onChange={e => onChange({ 
                                    proactiveChatMinMessages: parseInt(e.target.value) || 5 
                                })}
                                disabled={disabled}
                            />
                        </FormField>
                    </FormRow>

                    <FormGroup title="活跃时间段" icon={<Clock className="h-3 w-3" />}>
                        <FormRow>
                            <FormField label="开始时间">
                                <Input
                                    type="number"
                                    min={0}
                                    max={23}
                                    value={form.proactiveChatTimeStart}
                                    onChange={e => onChange({ 
                                        proactiveChatTimeStart: parseInt(e.target.value) || 8 
                                    })}
                                    disabled={disabled}
                                />
                            </FormField>
                            <FormField label="结束时间">
                                <Input
                                    type="number"
                                    min={0}
                                    max={23}
                                    value={form.proactiveChatTimeEnd}
                                    onChange={e => onChange({ 
                                        proactiveChatTimeEnd: parseInt(e.target.value) || 23 
                                    })}
                                    disabled={disabled}
                                />
                            </FormField>
                        </FormRow>
                    </FormGroup>
                </FeatureItem>
            </FeatureItem>
        </div>
    )
}

export default BymPanel
