'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { type LucideIcon } from 'lucide-react'
import { useResponsive } from '@/lib/hooks'

interface PageHeaderProps {
    title: string
    description?: string
    icon?: LucideIcon
    actions?: ReactNode
    className?: string
}

export function PageHeader({ title, description, icon: Icon, actions, className }: PageHeaderProps) {
    const { isMobile } = useResponsive()

    return (
        <div
            className={cn(
                'flex flex-col gap-2 sm:gap-4 pb-3 sm:pb-6 animate-fade-in',
                !isMobile && 'sm:flex-row sm:items-center sm:justify-between',
                className
            )}
        >
            <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
                {Icon && (
                    <div
                        className={cn(
                            'flex items-center justify-center rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 shadow-sm glass-card group flex-shrink-0',
                            isMobile ? 'h-9 w-9' : 'h-10 w-10 sm:h-14 sm:w-14 sm:rounded-2xl'
                        )}
                    >
                        <Icon
                            className={cn(
                                'text-primary group-hover:scale-110 transition-transform duration-300',
                                isMobile ? 'h-4.5 w-4.5' : 'h-5 w-5 sm:h-7 sm:w-7'
                            )}
                        />
                    </div>
                )}
                <div className="space-y-0 sm:space-y-1 min-w-0 flex-1">
                    <h1
                        className={cn(
                            'font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 truncate',
                            isMobile ? 'text-lg' : 'text-xl sm:text-2xl md:text-3xl'
                        )}
                    >
                        {title}
                    </h1>
                    {description && (
                        <p
                            className={cn(
                                'text-muted-foreground/80 font-medium line-clamp-1',
                                isMobile ? 'text-[11px]' : 'text-xs sm:text-sm'
                            )}
                        >
                            {description}
                        </p>
                    )}
                </div>
            </div>
            {actions && (
                <div
                    className={cn(
                        'flex items-center gap-2 flex-shrink-0',
                        isMobile ? 'mt-2 overflow-x-auto -mx-1 px-1 pb-1' : 'overflow-x-auto pb-1 -mb-1'
                    )}
                >
                    {actions}
                </div>
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
