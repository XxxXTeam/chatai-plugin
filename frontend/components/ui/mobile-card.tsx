'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface MobileCardProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string
    description?: string
    icon?: React.ReactNode
    badge?: React.ReactNode
    href?: string
    onClick?: () => void
    rightContent?: React.ReactNode
    showArrow?: boolean
}

export function MobileCard({
    title,
    description,
    icon,
    badge,
    href,
    onClick,
    rightContent,
    showArrow = true,
    className,
    children,
    ...props
}: MobileCardProps) {
    const content = (
        <div
            className={cn(
                'flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-card border border-border/50',
                'transition-all duration-200 active:scale-[0.98]',
                (href || onClick) && 'cursor-pointer hover:bg-accent/50 hover:border-border',
                className
            )}
            onClick={onClick}
            {...props}
        >
            {icon && <div className="flex-shrink-0 p-2 rounded-lg bg-muted/50">{icon}</div>}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-sm sm:text-base font-medium truncate">{title}</span>
                    {badge}
                </div>
                {description && (
                    <p className="text-xs sm:text-sm text-muted-foreground truncate mt-0.5">{description}</p>
                )}
                {children}
            </div>
            {rightContent}
            {showArrow && (href || onClick) && <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </div>
    )

    if (href) {
        return <Link href={href}>{content}</Link>
    }

    return content
}

interface MobileListProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string
    description?: string
}

export function MobileList({ title, description, className, children, ...props }: MobileListProps) {
    return (
        <div className={cn('space-y-2', className)} {...props}>
            {(title || description) && (
                <div className="px-1 mb-3">
                    {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
                    {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
                </div>
            )}
            <div className="space-y-2">{children}</div>
        </div>
    )
}

interface MobileActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: React.ReactNode
    variant?: 'default' | 'destructive' | 'outline'
}

export function MobileActionButton({
    icon,
    variant = 'default',
    className,
    children,
    ...props
}: MobileActionButtonProps) {
    return (
        <button
            className={cn(
                'flex items-center justify-center gap-2 w-full p-3 sm:p-4 rounded-xl',
                'text-sm sm:text-base font-medium transition-all duration-200',
                'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
                variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
                variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                variant === 'outline' && 'border border-border bg-background hover:bg-accent',
                className
            )}
            {...props}
        >
            {icon}
            {children}
        </button>
    )
}

interface MobileSectionProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string
    action?: React.ReactNode
}

export function MobileSection({ title, action, className, children, ...props }: MobileSectionProps) {
    return (
        <div className={cn('space-y-3', className)} {...props}>
            {(title || action) && (
                <div className="flex items-center justify-between px-1">
                    {title && <h2 className="text-base sm:text-lg font-semibold">{title}</h2>}
                    {action}
                </div>
            )}
            {children}
        </div>
    )
}
