'use client'

import { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type TriState = 'inherit' | 'on' | 'off'

interface TriStateSwitchProps {
    value: TriState
    onChange: (value: TriState) => void
    labels?: {
        inherit?: string
        on?: string
        off?: string
    }
    disabled?: boolean
    className?: string
}

/**
 * 三态开关组件
 * 支持 继承/开启/关闭 三种状态
 */
export function TriStateSwitch({
    value,
    onChange,
    labels = { inherit: '继承', on: '开启', off: '关闭' },
    disabled = false,
    className
}: TriStateSwitchProps) {
    const options: { value: TriState; label: string }[] = [
        { value: 'inherit', label: labels.inherit || '继承' },
        { value: 'on', label: labels.on || '开启' },
        { value: 'off', label: labels.off || '关闭' }
    ]

    return (
        <div className={cn('inline-flex rounded-lg border p-1 bg-muted/30', className)}>
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        'px-3 py-1 text-xs rounded-md transition-colors',
                        value === opt.value
                            ? opt.value === 'on'
                                ? 'bg-green-500 text-white'
                                : opt.value === 'off'
                                  ? 'bg-red-500 text-white'
                                  : 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        disabled && 'opacity-50 cursor-not-allowed'
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

export default TriStateSwitch
