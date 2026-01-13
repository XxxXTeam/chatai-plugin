'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { type LucideIcon } from 'lucide-react'

interface PageHeaderProps {
    title: string
    description?: string
    icon?: LucideIcon
    actions?: ReactNode
    className?: string
}

export function PageHeader({ title, description, icon: Icon, actions, className }: PageHeaderProps) {
    return (
        <div
            className={cn(
                'flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 sm:pb-6 animate-fade-in',
                className
            )}
        >
            <div className="flex items-center gap-3 sm:gap-4">
                {Icon && (
                    <div className="flex h-10 w-10 sm:h-14 sm:w-14 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 shadow-sm glass-card group flex-shrink-0">
                        <Icon className="h-5 w-5 sm:h-7 sm:w-7 text-primary group-hover:scale-110 transition-transform duration-300" />
                    </div>
                )}
                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 truncate">
                        {title}
                    </h1>
                    {description && (
                        <p className="text-muted-foreground/80 text-xs sm:text-sm font-medium line-clamp-1">
                            {description}
                        </p>
                    )}
                </div>
            </div>
            {actions && (
                <div className="flex items-center gap-2 flex-shrink-0 overflow-x-auto pb-1 -mb-1">{actions}</div>
            )}
        </div>
    )
}

// 页面容器组件
interface PageContainerProps {
    children: ReactNode
    className?: string
}

export function PageContainer({ children, className }: PageContainerProps) {
    return <div className={cn('space-y-6', className)}>{children}</div>
}

// 内容区块组件
interface ContentSectionProps {
    title?: string
    description?: string
    children: ReactNode
    className?: string
}

export function ContentSection({ title, description, children, className }: ContentSectionProps) {
    return (
        <div className={cn('space-y-4', className)}>
            {(title || description) && (
                <div>
                    {title && <h2 className="text-lg font-semibold">{title}</h2>}
                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                </div>
            )}
            {children}
        </div>
    )
}
