'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DialogContent } from '@/components/ui/dialog'
import { forwardRef } from 'react'

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

export function MobileButtonGroup({ 
  children, 
  className,
  stackOnMobile = true 
}: MobileButtonGroupProps) {
  return (
    <div className={cn(
      'flex gap-2',
      stackOnMobile && 'flex-col sm:flex-row',
      className
    )}>
      {children}
    </div>
  )
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
    return (
      <Button
        ref={ref}
        className={cn(
          fullWidthOnMobile && 'w-full sm:w-auto',
          className
        )}
        {...props}
      />
    )
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

export const MobileDialogContent = forwardRef<
  React.ElementRef<typeof DialogContent>,
  MobileDialogContentProps
>(({ className, fullScreenOnMobile = true, children, ...props }, ref) => {
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
})
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

export function MobileFormGrid({ 
  children, 
  className,
  cols = 2 
}: MobileFormGridProps) {
  const colsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  }

  return (
    <div className={cn('grid gap-4', colsClass[cols], className)}>
      {children}
    </div>
  )
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

export function MobileActionBar({ 
  children, 
  className,
  fixed = false 
}: MobileActionBarProps) {
  if (fixed) {
    return (
      <div className={cn(
        'fixed bottom-0 left-0 right-0 z-50',
        'p-4 bg-background border-t',
        'safe-area-bottom',
        'sm:relative sm:p-0 sm:border-0 sm:bg-transparent',
        className
      )}>
        <div className="flex gap-2 flex-col sm:flex-row sm:justify-end">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'flex gap-2 flex-col sm:flex-row sm:justify-end pt-4',
      className
    )}>
      {children}
    </div>
  )
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

export function SafeAreaContainer({ 
  children, 
  className,
  top = false,
  bottom = true 
}: SafeAreaContainerProps) {
  return (
    <div className={cn(
      top && 'pt-[env(safe-area-inset-top)]',
      bottom && 'pb-[env(safe-area-inset-bottom)]',
      className
    )}>
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

export function TouchFriendlyItem({ 
  children, 
  className,
  onClick 
}: TouchFriendlyItemProps) {
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

const MobileOptimized = {
  MobileButtonGroup,
  MobileButton,
  MobileDialogContent,
  MobileFormGrid,
  MobileActionBar,
  SafeAreaContainer,
  TouchFriendlyItem
}

export default MobileOptimized
