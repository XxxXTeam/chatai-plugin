'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { TriStateSwitch } from './TriStateSwitch'

type TriState = 'inherit' | 'on' | 'off'

interface FeatureSwitchProps {
    value: TriState
    onChange: (value: TriState) => void
    disabled?: boolean
}

/**
 * 功能开关组件（简化版三态开关）
 */
export function FeatureSwitch({ value, onChange, disabled }: FeatureSwitchProps) {
    return (
        <TriStateSwitch
            value={value}
            onChange={onChange}
            disabled={disabled}
        />
    )
}

interface FeatureItemProps {
    icon: ReactNode
    title: string
    desc?: string
    value: TriState
    onChange: (value: TriState) => void
    disabled?: boolean
    children?: ReactNode
    className?: string
}

/**
 * 功能配置项组件
 * 包含图标、标题、描述和三态开关
 */
export function FeatureItem({
    icon,
    title,
    desc,
    value,
    onChange,
    disabled,
    children,
    className
}: FeatureItemProps) {
    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                    <div className="text-muted-foreground">{icon}</div>
                    <div>
                        <div className="font-medium text-sm">{title}</div>
                        {desc && (
                            <div className="text-xs text-muted-foreground">{desc}</div>
                        )}
                    </div>
                </div>
                <FeatureSwitch value={value} onChange={onChange} disabled={disabled} />
            </div>
            {/* 展开的子配置项 */}
            {children && value === 'on' && (
                <div className="ml-4 pl-4 border-l-2 border-muted space-y-3">
                    {children}
                </div>
            )}
        </div>
    )
}

export default FeatureItem
