'use client'

import { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FormSectionProps {
    title?: string
    description?: string
    children: ReactNode
    className?: string
}

/**
 * 表单区域组件
 * 用于组织相关的表单字段
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
    return (
        <div className={cn('space-y-4', className)}>
            {(title || description) && (
                <div className="space-y-1">
                    {title && <h3 className="text-sm font-medium">{title}</h3>}
                    {description && (
                        <p className="text-xs text-muted-foreground">{description}</p>
                    )}
                </div>
            )}
            <div className="space-y-4">{children}</div>
        </div>
    )
}

interface FormRowProps {
    children: ReactNode
    cols?: 1 | 2 | 3 | 4
    className?: string
}

/**
 * 表单行组件
 * 用于水平排列多个表单字段
 */
export function FormRow({ children, cols = 2, className }: FormRowProps) {
    const gridClass = {
        1: 'grid-cols-1',
        2: 'sm:grid-cols-2',
        3: 'sm:grid-cols-3',
        4: 'sm:grid-cols-4'
    }[cols]

    return (
        <div className={cn('grid gap-4', gridClass, className)}>
            {children}
        </div>
    )
}

interface FormFieldProps {
    label: string
    hint?: string
    error?: string
    required?: boolean
    children: ReactNode
    className?: string
}

/**
 * 表单字段组件
 * 包含标签、输入控件、提示和错误信息
 */
export function FormField({
    label,
    hint,
    error,
    required,
    children,
    className
}: FormFieldProps) {
    return (
        <div className={cn('space-y-2', className)}>
            <Label className="flex items-center gap-1">
                {label}
                {required && <span className="text-destructive">*</span>}
            </Label>
            {children}
            {hint && !error && (
                <p className="text-xs text-muted-foreground">{hint}</p>
            )}
            {error && (
                <p className="text-xs text-destructive">{error}</p>
            )}
        </div>
    )
}

interface FormDividerProps {
    label?: string
}

/**
 * 表单分隔线
 */
export function FormDivider({ label }: FormDividerProps) {
    if (label) {
        return (
            <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                        {label}
                    </span>
                </div>
            </div>
        )
    }
    return <div className="border-t my-4" />
}

interface FormGroupProps {
    title: string
    icon?: ReactNode
    collapsible?: boolean
    defaultOpen?: boolean
    children: ReactNode
    className?: string
}

/**
 * 表单分组组件
 * 带标题的表单字段分组
 */
export function FormGroup({
    title,
    icon,
    children,
    className
}: FormGroupProps) {
    return (
        <div className={cn('space-y-3', className)}>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                {icon}
                <span>{title}</span>
            </div>
            <div className="pl-6 space-y-3 border-l-2 border-muted">
                {children}
            </div>
        </div>
    )
}
