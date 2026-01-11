'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import Link from 'next/link'

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string
    value: string | number
    description?: string
    icon?: LucideIcon
    trend?: {
        value: number
        label?: string
    }
    href?: string
    gradient?: 'blue' | 'green' | 'amber' | 'purple' | 'cyan' | 'rose'
}

const gradientClasses = {
    blue: 'from-blue-500 to-indigo-600',
    green: 'from-emerald-500 to-green-600',
    amber: 'from-amber-500 to-orange-600',
    purple: 'from-purple-500 to-indigo-600',
    cyan: 'from-cyan-500 to-blue-600',
    rose: 'from-rose-500 to-pink-600'
}

const iconColorClasses = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    purple: 'text-purple-600 dark:text-purple-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
    rose: 'text-rose-600 dark:text-rose-400'
}

function StatCard({
    title,
    value,
    description,
    icon: Icon,
    trend,
    href,
    gradient = 'blue',
    className,
    ...props
}: StatCardProps) {
    const content = (
        <div
            className={cn(
                'group relative overflow-hidden rounded-xl border bg-card p-6',
                'hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300',
                'dark:border-border/50',
                className
            )}
            {...props}
        >
            {/* Top gradient bar */}
            <div className={cn('absolute top-0 left-0 right-0 h-1 bg-gradient-to-r', gradientClasses[gradient])} />

            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                {Icon && (
                    <div className="p-2 rounded-lg bg-muted/50 group-hover:scale-110 transition-transform">
                        <Icon className={cn('h-5 w-5', iconColorClasses[gradient])} />
                    </div>
                )}
            </div>

            {/* Value */}
            <div className="text-3xl font-bold tracking-tight mb-1">{value}</div>

            {/* Description or Trend */}
            <div className="flex items-center gap-2">
                {trend && (
                    <span
                        className={cn('text-sm font-medium', trend.value >= 0 ? 'text-emerald-600' : 'text-rose-600')}
                    >
                        {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
                    </span>
                )}
                {description && <span className="text-sm text-muted-foreground">{description}</span>}
            </div>
        </div>
    )

    if (href) {
        return <Link href={href}>{content}</Link>
    }

    return content
}

interface StatGridProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode
    columns?: 2 | 3 | 4
}

function StatGrid({ children, columns = 4, className, ...props }: StatGridProps) {
    const colClasses = {
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        4: 'grid-cols-2 lg:grid-cols-4'
    }

    return (
        <div className={cn('grid gap-4', colClasses[columns], className)} {...props}>
            {children}
        </div>
    )
}

export { StatCard, StatGrid }
export type { StatCardProps, StatGridProps }
