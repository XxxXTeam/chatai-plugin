'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DialogContent } from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { forwardRef, ReactNode } from 'react'
import { useResponsive } from '@/lib/hooks'
import { ChevronRight, type LucideIcon } from 'lucide-react'

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>

/**
 * 移动端优化的按钮组
 * 在小屏幕上自动变为全宽堆叠布局
 */
interface MobileButtonGroupProps {
    children: React.ReactNode
    className?: string
    stackOnMobile?: boolean
}

export function MobileButtonGroup({ children, className, stackOnMobile = true }: MobileButtonGroupProps) {
    return <div className={cn('flex gap-2', stackOnMobile && 'flex-col sm:flex-row', className)}>{children}</div>
}

/**
 * 移动端优化的按钮
 * 在小屏幕上自动变为全宽
 */
type MobileButtonProps = ButtonProps & {
    fullWidthOnMobile?: boolean
}

export const MobileButton = forwardRef<HTMLButtonElement, MobileButtonProps>(
    ({ className, fullWidthOnMobile = true, ...props }, ref) => {
        return <Button ref={ref} className={cn(fullWidthOnMobile && 'w-full sm:w-auto', className)} {...props} />
    }
)
MobileButton.displayName = 'MobileButton'

/**
 * 移动端优化的对话框内容
 * 在小屏幕上全屏显示
 */
type MobileDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogContent> & {
    fullScreenOnMobile?: boolean
}

export const MobileDialogContent = forwardRef<React.ElementRef<typeof DialogContent>, MobileDialogContentProps>(
    ({ className, fullScreenOnMobile = true, children, ...props }, ref) => {
        return (
            <DialogContent
                ref={ref}
                className={cn(
                    fullScreenOnMobile && [
                        'w-[95vw] max-w-lg',
                        'max-h-[90vh] sm:max-h-[85vh]',
                        'overflow-hidden flex flex-col'
                    ],
                    className
                )}
                {...props}
            >
                {children}
            </DialogContent>
        )
    }
)
MobileDialogContent.displayName = 'MobileDialogContent'

/**
 * 移动端优化的表单布局
 * 响应式网格布局
 */
interface MobileFormGridProps {
    children: React.ReactNode
    className?: string
    cols?: 1 | 2 | 3
}

export function MobileFormGrid({ children, className, cols = 2 }: MobileFormGridProps) {
    const colsClass = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
    }

    return <div className={cn('grid gap-4', colsClass[cols], className)}>{children}</div>
}

/**
 * 移动端优化的操作栏
 * 底部固定或内联显示
 */
interface MobileActionBarProps {
    children: React.ReactNode
    className?: string
    fixed?: boolean
}

export function MobileActionBar({ children, className, fixed = false }: MobileActionBarProps) {
    const { isMobile } = useResponsive()

    if (fixed && isMobile) {
        return (
            <div
                className={cn(
                    'fixed bottom-0 left-0 right-0 z-40',
                    'p-3 bg-background/95 backdrop-blur-lg border-t border-border/50',
                    'pb-[calc(12px+env(safe-area-inset-bottom,0px))]',
                    className
                )}
            >
                <div className="flex gap-2 flex-col">{children}</div>
            </div>
        )
    }

    return <div className={cn('flex gap-2 flex-col sm:flex-row sm:justify-end pt-4', className)}>{children}</div>
}

/**
 * 安全区域内边距容器
 * 处理刘海屏和底部手势条
 */
interface SafeAreaContainerProps {
    children: React.ReactNode
    className?: string
    top?: boolean
    bottom?: boolean
}

export function SafeAreaContainer({ children, className, top = false, bottom = true }: SafeAreaContainerProps) {
    return (
        <div
            className={cn(
                top && 'pt-[env(safe-area-inset-top)]',
                bottom && 'pb-[env(safe-area-inset-bottom)]',
                className
            )}
        >
            {children}
        </div>
    )
}

/**
 * 触摸友好的列表项
 * 增大点击区域
 */
interface TouchFriendlyItemProps {
    children: React.ReactNode
    className?: string
    onClick?: () => void
}

export function TouchFriendlyItem({ children, className, onClick }: TouchFriendlyItemProps) {
    return (
        <div
            className={cn(
                'min-h-[44px] flex items-center',
                'active:bg-muted/50 transition-colors',
                onClick && 'cursor-pointer',
                className
            )}
            onClick={onClick}
        >
            {children}
        </div>
    )
}

/**
 * 移动端优化的卡片组件
 */
interface MobileCardProps {
    title?: string
    icon?: LucideIcon
    children: ReactNode
    className?: string
    onClick?: () => void
    showArrow?: boolean
}

export function MobileCard({ title, icon: Icon, children, className, onClick, showArrow }: MobileCardProps) {
    const { isMobile } = useResponsive()

    return (
        <Card
            className={cn(
                'transition-all duration-200',
                onClick && 'cursor-pointer active:scale-[0.99]',
                isMobile ? 'rounded-xl' : 'rounded-lg',
                className
            )}
            onClick={onClick}
        >
            {title && (
                <CardHeader className={cn('pb-2', isMobile ? 'p-3' : 'p-4')}>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
                        {title}
                        {showArrow && onClick && <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />}
                    </CardTitle>
                </CardHeader>
            )}
            <CardContent className={cn(isMobile ? 'p-3 pt-0' : 'p-4 pt-0', !title && (isMobile ? 'p-3' : 'p-4'))}>
                {children}
            </CardContent>
        </Card>
    )
}

/**
 * 响应式内容包装器
 */
interface ResponsiveWrapperProps {
    children: ReactNode
    mobileContent?: ReactNode
    className?: string
}

export function ResponsiveWrapper({ children, mobileContent, className }: ResponsiveWrapperProps) {
    const { isMobile } = useResponsive()

    return <div className={className}>{isMobile && mobileContent ? mobileContent : children}</div>
}

/**
 * 移动端优化的列表项
 */
interface MobileListItemProps {
    icon?: LucideIcon
    title: string
    description?: string
    trailing?: ReactNode
    onClick?: () => void
    className?: string
}

export function MobileListItem({ icon: Icon, title, description, trailing, onClick, className }: MobileListItemProps) {
    return (
        <div
            className={cn(
                'flex items-center gap-3 p-3 sm:p-4',
                'border-b border-border/30 last:border-b-0',
                onClick && 'cursor-pointer active:bg-muted/50 transition-colors',
                className
            )}
            onClick={onClick}
        >
            {Icon && (
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{title}</div>
                {description && <div className="text-xs text-muted-foreground truncate mt-0.5">{description}</div>}
            </div>
            {trailing && <div className="flex-shrink-0">{trailing}</div>}
            {onClick && !trailing && <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </div>
    )
}

/**
 * 移动端分组标题
 */
interface MobileSectionHeaderProps {
    title: string
    action?: ReactNode
    className?: string
}

export function MobileSectionHeader({ title, action, className }: MobileSectionHeaderProps) {
    return (
        <div className={cn('flex items-center justify-between px-1 py-2', className)}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
            {action}
        </div>
    )
}

/**
 * 移动端空状态组件
 */
interface MobileEmptyStateProps {
    icon?: LucideIcon
    title: string
    description?: string
    action?: ReactNode
    className?: string
}

export function MobileEmptyState({ icon: Icon, title, description, action, className }: MobileEmptyStateProps) {
    return (
        <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
            {Icon && (
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <Icon className="h-8 w-8 text-muted-foreground/50" />
                </div>
            )}
            <h3 className="text-base font-semibold text-foreground/80 mb-1">{title}</h3>
            {description && <p className="text-sm text-muted-foreground max-w-xs mb-4">{description}</p>}
            {action}
        </div>
    )
}

const MobileOptimized = {
    MobileButtonGroup,
    MobileButton,
    MobileDialogContent,
    MobileFormGrid,
    MobileActionBar,
    SafeAreaContainer,
    TouchFriendlyItem,
    MobileCard,
    ResponsiveWrapper,
    MobileListItem,
    MobileSectionHeader,
    MobileEmptyState
}

export default MobileOptimized
