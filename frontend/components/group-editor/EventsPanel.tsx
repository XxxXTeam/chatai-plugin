'use client'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
    UserPlus,
    UserMinus,
    Hand,
    Trash2,
    VolumeX,
    Crown,
    Award,
    Star,
    Shield
} from 'lucide-react'
import { FeatureItem } from './FeatureSwitch'
import { TriStateSwitch } from './TriStateSwitch'
import { FormField, FormRow, FormSection, FormDivider } from './FormSection'
import { GroupFormState } from '@/lib/types'

type TriState = 'inherit' | 'on' | 'off'

interface EventsPanelProps {
    form: GroupFormState
    onChange: (updates: Partial<GroupFormState>) => void
    disabled?: boolean
}

interface EventItemProps {
    icon: React.ReactNode
    title: string
    desc: string
    enabled: TriState
    probability: number | 'inherit'
    onEnabledChange: (v: TriState) => void
    onProbabilityChange: (v: number | 'inherit') => void
    disabled?: boolean
    children?: React.ReactNode
}

function EventItem({
    icon,
    title,
    desc,
    enabled,
    probability,
    onEnabledChange,
    onProbabilityChange,
    disabled,
    children
}: EventItemProps) {
    return (
        <FeatureItem
            icon={icon}
            title={title}
            desc={desc}
            value={enabled}
            onChange={onEnabledChange}
            disabled={disabled}
        >
            <FormField label="响应概率">
                <div className="flex items-center gap-2">
                    <TriStateSwitch
                        value={probability === 'inherit' ? 'inherit' : 'on'}
                        onChange={v => onProbabilityChange(v === 'inherit' ? 'inherit' : 1.0)}
                        labels={{ inherit: '继承', on: '自定义', off: '自定义' }}
                        disabled={disabled}
                    />
                    {probability !== 'inherit' && (
                        <Input
                            type="number"
                            min={0}
                            max={1}
                            step={0.1}
                            value={probability}
                            onChange={e => onProbabilityChange(parseFloat(e.target.value) || 1.0)}
                            className="w-24"
                            disabled={disabled}
                        />
                    )}
                </div>
            </FormField>
            {children}
        </FeatureItem>
    )
}

/**
 * 事件处理配置面板
 * 包含入群欢迎、退群、戳一戳、撤回等事件的配置
 */
export function EventsPanel({
    form,
    onChange,
    disabled = false
}: EventsPanelProps) {
    return (
        <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
                配置各类群事件的AI响应行为
            </p>

            {/* 入群欢迎 */}
            <EventItem
                icon={<UserPlus className="h-4 w-4" />}
                title="入群欢迎"
                desc="新成员入群时发送欢迎消息"
                enabled={form.welcomeEnabled}
                probability={form.welcomeProbability}
                onEnabledChange={v => onChange({ welcomeEnabled: v })}
                onProbabilityChange={v => onChange({ welcomeProbability: v })}
                disabled={disabled}
            >
                <FormField label="欢迎消息" hint="留空使用AI生成">
                    <Input
                        value={form.welcomeMessage}
                        onChange={e => onChange({ welcomeMessage: e.target.value })}
                        placeholder="固定欢迎消息，留空使用AI"
                        disabled={disabled}
                    />
                </FormField>
                <FormField label="AI提示词" hint="指导AI如何生成欢迎语">
                    <Textarea
                        value={form.welcomePrompt}
                        onChange={e => onChange({ welcomePrompt: e.target.value })}
                        placeholder="生成欢迎消息的提示词..."
                        rows={2}
                        disabled={disabled}
                    />
                </FormField>
            </EventItem>

            {/* 退群通知 */}
            <EventItem
                icon={<UserMinus className="h-4 w-4" />}
                title="退群通知"
                desc="成员退群时发送告别消息"
                enabled={form.goodbyeEnabled}
                probability={form.goodbyeProbability}
                onEnabledChange={v => onChange({ goodbyeEnabled: v })}
                onProbabilityChange={v => onChange({ goodbyeProbability: v })}
                disabled={disabled}
            >
                <FormField label="AI提示词">
                    <Textarea
                        value={form.goodbyePrompt}
                        onChange={e => onChange({ goodbyePrompt: e.target.value })}
                        placeholder="生成告别消息的提示词..."
                        rows={2}
                        disabled={disabled}
                    />
                </FormField>
            </EventItem>

            {/* 戳一戳 */}
            <EventItem
                icon={<Hand className="h-4 w-4" />}
                title="戳一戳"
                desc="被戳时的响应"
                enabled={form.pokeEnabled}
                probability={form.pokeProbability}
                onEnabledChange={v => onChange({ pokeEnabled: v })}
                onProbabilityChange={v => onChange({ pokeProbability: v })}
                disabled={disabled}
            >
                <FormField label="回戳">
                    <div className="flex items-center h-10">
                        <Switch
                            checked={form.pokeBack}
                            onCheckedChange={v => onChange({ pokeBack: v })}
                            disabled={disabled}
                        />
                        <span className="ml-2 text-sm text-muted-foreground">
                            被戳时是否回戳对方
                        </span>
                    </div>
                </FormField>
            </EventItem>

            <FormDivider label="其他事件" />

            {/* 消息撤回 */}
            <EventItem
                icon={<Trash2 className="h-4 w-4" />}
                title="消息撤回"
                desc="有人撤回消息时的响应"
                enabled={form.recallEnabled}
                probability={form.recallProbability}
                onEnabledChange={v => onChange({ recallEnabled: v })}
                onProbabilityChange={v => onChange({ recallProbability: v })}
                disabled={disabled}
            />

            {/* 禁言事件 */}
            <EventItem
                icon={<VolumeX className="h-4 w-4" />}
                title="禁言事件"
                desc="成员被禁言时的响应"
                enabled={form.banEnabled}
                probability={form.banProbability}
                onEnabledChange={v => onChange({ banEnabled: v })}
                onProbabilityChange={v => onChange({ banProbability: v })}
                disabled={disabled}
            />

            {/* 运气王 */}
            <EventItem
                icon={<Crown className="h-4 w-4" />}
                title="运气王"
                desc="成员成为运气王时的响应"
                enabled={form.luckyKingEnabled}
                probability={form.luckyKingProbability}
                onEnabledChange={v => onChange({ luckyKingEnabled: v })}
                onProbabilityChange={v => onChange({ luckyKingProbability: v })}
                disabled={disabled}
            />

            {/* 群荣誉 */}
            <EventItem
                icon={<Award className="h-4 w-4" />}
                title="群荣誉"
                desc="龙王、群聊之火等荣誉变更"
                enabled={form.honorEnabled}
                probability={form.honorProbability}
                onEnabledChange={v => onChange({ honorEnabled: v })}
                onProbabilityChange={v => onChange({ honorProbability: v })}
                disabled={disabled}
            />

            {/* 精华消息 */}
            <EventItem
                icon={<Star className="h-4 w-4" />}
                title="精华消息"
                desc="消息被设为精华时的响应"
                enabled={form.essenceEnabled}
                probability={form.essenceProbability}
                onEnabledChange={v => onChange({ essenceEnabled: v })}
                onProbabilityChange={v => onChange({ essenceProbability: v })}
                disabled={disabled}
            />

            {/* 管理员变更 */}
            <EventItem
                icon={<Shield className="h-4 w-4" />}
                title="管理员变更"
                desc="管理员设置/取消时的响应"
                enabled={form.adminEnabled}
                probability={form.adminProbability}
                onEnabledChange={v => onChange({ adminEnabled: v })}
                onProbabilityChange={v => onChange({ adminProbability: v })}
                disabled={disabled}
            />
        </div>
    )
}

export default EventsPanel
