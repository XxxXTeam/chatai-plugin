'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
    MoreHorizontal, 
    Trash2, 
    Edit, 
    Eye, 
    Play,
    ChevronRight
} from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

interface MobileCardListProps<T> {
    items: T[]
    renderItem: (item: T, index: number) => ReactNode
    emptyIcon?: ReactNode
    emptyTitle?: string
    emptyDescription?: string
    className?: string
}

/**
 * 移动端友好的卡片列表组件
 * 在移动端显示为单列全宽卡片，桌面端显示为网格
 */
export function MobileCardList<T>({
    items,
    renderItem,
    emptyIcon,
    emptyTitle = '暂无数据',
    emptyDescription,
    className
}: MobileCardListProps<T>) {
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                {emptyIcon && (
                    <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-4 opacity-50">
                        {emptyIcon}
                    </div>
                )}
                <h3 className="text-lg font-semibold mb-2">{emptyTitle}</h3>
                {emptyDescription && (
                    <p className="text-sm text-muted-foreground max-w-sm">{emptyDescription}</p>
                )}
            </div>
        )
    }

    return (
        <div className={cn(
            'grid gap-3',
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
            className
        )}>
            {items.map((item, index) => renderItem(item, index))}
        </div>
    )
}

interface MobileListItemProps {
    title: string
    subtitle?: string
    description?: string
    icon?: ReactNode
    badge?: ReactNode
    tags?: { label: string; variant?: 'default' | 'secondary' | 'outline' | 'destructive' }[]
    actions?: {
        label: string
        icon?: ReactNode
        onClick: () => void
        variant?: 'default' | 'destructive'
    }[]
    onClick?: () => void
    active?: boolean
    className?: string
}

/**
 * 移动端友好的列表项组件
 * 支持标题、副标题、描述、图标、标签和操作菜单
 */
export function MobileListItem({
    title,
    subtitle,
    description,
    icon,
    badge,
    tags,
    actions,
    onClick,
    active,
    className
}: MobileListItemProps) {
    const isMobile = useIsMobile()

    return (
        <div
            className={cn(
                'p-4 border rounded-lg transition-all',
                onClick && 'cursor-pointer hover:shadow-md hover:border-primary/30',
                active && 'border-primary bg-primary/5',
                className
            )}
            onClick={onClick}
        >
            <div className="flex items-start gap-3">
                {icon && (
                    <div className="flex-shrink-0 w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                        {icon}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium truncate">{title}</h4>
                        {badge}
                    </div>
                    {subtitle && (
                        <p className="text-xs text-muted-foreground font-mono">{subtitle}</p>
                    )}
                    {description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{description}</p>
                    )}
                    {tags && tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {tags.map((tag, i) => (
                                <Badge key={i} variant={tag.variant || 'secondary'} className="text-xs">
                                    {tag.label}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
                {actions && actions.length > 0 && (
                    <div className="flex-shrink-0">
                        {isMobile || actions.length > 2 ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {actions.map((action, i) => (
                                        <DropdownMenuItem
                                            key={i}
                                            onClick={e => {
                                                e.stopPropagation()
                                                action.onClick()
                                            }}
                                            className={action.variant === 'destructive' ? 'text-destructive' : undefined}
                                        >
                                            {action.icon}
                                            <span className="ml-2">{action.label}</span>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                {actions.map((action, i) => (
                                    <Button
                                        key={i}
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            'h-8 w-8',
                                            action.variant === 'destructive' && 'text-destructive hover:text-destructive'
                                        )}
                                        onClick={action.onClick}
                                    >
                                        {action.icon}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {onClick && !actions && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
            </div>
        </div>
    )
}

interface MobilePageHeaderProps {
    title: string
    description?: string
    icon?: ReactNode
    actions?: ReactNode
    stats?: { label: string; value: string | number; icon?: ReactNode }[]
    className?: string
}

/**
 * 移动端友好的页面头部组件
 */
export function MobilePageHeader({
    title,
    description,
    icon,
    actions,
    stats,
    className
}: MobilePageHeaderProps) {
    return (
        <div className={cn('space-y-4', className)}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    {icon && (
                        <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                            {icon}
                        </div>
                    )}
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                        {description && (
                            <p className="text-muted-foreground text-sm mt-0.5">{description}</p>
                        )}
                    </div>
                </div>
                {actions && (
                    <div className="flex items-center gap-2 flex-wrap">{actions}</div>
                )}
            </div>
            {stats && stats.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {stats.map((stat, i) => (
                        <Card key={i} className="p-3">
                            <div className="flex items-center gap-2">
                                {stat.icon && <div className="text-muted-foreground">{stat.icon}</div>}
                                <div>
                                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                                    <p className="text-lg font-semibold">{stat.value}</p>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}

interface MobileSearchBarProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    onSearch?: () => void
    filters?: ReactNode
    className?: string
}

/**
 * 移动端友好的搜索栏组件
 */
export function MobileSearchBar({
    value,
    onChange,
    placeholder = '搜索...',
    onSearch,
    filters,
    className
}: MobileSearchBarProps) {
    return (
        <div className={cn(
            'flex flex-col sm:flex-row gap-2 p-3 bg-card border rounded-lg',
            className
        )}>
            <div className="relative flex-1">
                <input
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full h-9 pl-9 pr-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={e => e.key === 'Enter' && onSearch?.()}
                />
                <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>
            {filters && (
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    {filters}
                </div>
            )}
        </div>
    )
}

interface MobileBottomSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
    description?: string
    children: ReactNode
    className?: string
}

/**
 * 移动端底部抽屉组件（用于替代某些场景下的 Dialog）
 */
export function MobileBottomSheet({
    open,
    onOpenChange,
    title,
    description,
    children,
    className
}: MobileBottomSheetProps) {
    const isMobile = useIsMobile()

    if (!open) return null

    // 在桌面端使用普通样式，移动端使用底部抽屉样式
    return (
        <>
            {/* 遮罩 */}
            <div 
                className="fixed inset-0 bg-black/50 z-50 animate-in fade-in"
                onClick={() => onOpenChange(false)}
            />
            {/* 内容 */}
            <div className={cn(
                'fixed z-50 bg-background',
                isMobile 
                    ? 'inset-x-0 bottom-0 rounded-t-xl max-h-[85vh] animate-in slide-in-from-bottom'
                    : 'inset-0 m-auto w-full max-w-lg h-fit max-h-[85vh] rounded-lg animate-in zoom-in-95',
                className
            )}>
                {/* 拖动指示器（仅移动端） */}
                {isMobile && (
                    <div className="flex justify-center py-2">
                        <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
                    </div>
                )}
                {/* 标题 */}
                {(title || description) && (
                    <div className="px-4 pb-2 border-b">
                        {title && <h3 className="text-lg font-semibold">{title}</h3>}
                        {description && <p className="text-sm text-muted-foreground">{description}</p>}
                    </div>
                )}
                {/* 内容区 */}
                <div className="overflow-y-auto p-4 max-h-[calc(85vh-80px)]">
                    {children}
                </div>
            </div>
        </>
    )
}
