import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ReactNode } from 'react'
import { ProbabilitySlider } from './probability-slider'

interface EventConfigProps {
    icon: ReactNode
    title: string
    enabled: 'inherit' | 'on' | 'off'
    onEnabledChange: (value: 'inherit' | 'on' | 'off') => void
    probability: 'inherit' | number
    onProbabilityChange: (value: number) => void
    children?: ReactNode
}

export function EventConfig({
    icon,
    title,
    enabled,
    onEnabledChange,
    probability,
    onProbabilityChange,
    children
}: EventConfigProps) {
    return (
        <div className="rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                    {icon}
                    <span className="text-sm font-medium">{title}</span>
                </div>
                <Select value={enabled} onValueChange={onEnabledChange}>
                    <SelectTrigger className="w-24 h-8">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="inherit">继承</SelectItem>
                        <SelectItem value="on">开启</SelectItem>
                        <SelectItem value="off">关闭</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {enabled === 'on' && (
                <div className="p-3 space-y-3 border-t">
                    <ProbabilitySlider value={probability} onChange={onProbabilityChange} />
                    {children}
                </div>
            )}
        </div>
    )
}
