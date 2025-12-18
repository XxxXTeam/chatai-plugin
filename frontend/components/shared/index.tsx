'use client'

/**
 * 统一组件库
 * 整合所有通用UI组件，减少重复代码
 */

import { forwardRef, type ReactNode, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { DialogContent } from '@/components/ui/dialog'
import { 
  Plus, Trash2, Loader2, Search, X, ChevronDown, ChevronUp,
  type LucideIcon 
} from 'lucide-react'
import { toast } from 'sonner'

// ==================== 类型定义 ====================

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>

// ==================== 页面布局组件 ====================

interface PageHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  actions?: ReactNode
  className?: string
}

/**
 * 页面头部组件
 * 包含标题、描述、图标和操作按钮
 */
export function PageHeader({ 
  title, 
  description, 
  icon: Icon, 
  actions,
  className 
}: PageHeaderProps) {
  return (
    <div className={cn(
      'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2',
      className
    )}>
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10 shadow-sm">
            <Icon className="h-6 w-6 text-primary" />
          </div>
        )}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}

/**
 * 页面容器组件
 */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-6', className)}>{children}</div>
}

// ==================== 卡片组件 ====================

interface SectionCardProps {
  title: string
  description?: string
  icon?: LucideIcon
  children: ReactNode
  actions?: ReactNode
  className?: string
  collapsible?: boolean
  defaultCollapsed?: boolean
}

/**
 * 通用卡片区块组件
 * 支持图标、标题、描述、操作按钮和可折叠功能
 */
export function SectionCard({ 
  title, 
  description, 
  icon: Icon,
  children, 
  actions,
  className,
  collapsible = false,
  defaultCollapsed = false
}: SectionCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <Card className={cn('', className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div 
            className={cn(
              'flex items-center gap-3',
              collapsible && 'cursor-pointer'
            )}
            onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
          >
            {Icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
            )}
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {title}
                {collapsible && (
                  collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />
                )}
              </CardTitle>
              {description && (
                <CardDescription className="mt-0.5">{description}</CardDescription>
              )}
            </div>
          </div>
          {actions}
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-4">
          {children}
        </CardContent>
      )}
    </Card>
  )
}

// ==================== 表单组件 ====================

interface FormRowProps {
  label: string
  description?: string
  children: ReactNode
  className?: string
  required?: boolean
  error?: string
}

/**
 * 表单行组件
 * 标签和控件横向排列，移动端自动堆叠
 */
export function FormRow({ label, description, children, className, required, error }: FormRowProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4', className)}>
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
        {error && (
          <p className="text-xs text-destructive mt-0.5">{error}</p>
        )}
      </div>
      <div className="shrink-0 w-full sm:w-auto">{children}</div>
    </div>
  )
}

interface FormGridProps {
  children: ReactNode
  cols?: 1 | 2 | 3 | 4
  className?: string
}

/**
 * 表单网格组件
 * 响应式多列布局
 */
export function FormGrid({ children, cols = 2, className }: FormGridProps) {
  const colsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[cols]
  
  return (
    <div className={cn('grid gap-4', colsClass, className)}>
      {children}
    </div>
  )
}

interface FormFieldProps {
  label: string
  children: ReactNode
  description?: string
  required?: boolean
  error?: string
  className?: string
}

/**
 * 表单字段组件
 * 标签在上，控件在下
 */
export function FormField({ label, children, description, required, error, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {description && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}

// ==================== 加载状态组件 ====================

interface LoadingSkeletonProps {
  type?: 'cards' | 'table' | 'form' | 'list'
  count?: number
}

/**
 * 通用加载骨架屏
 */
export function LoadingSkeleton({ type = 'cards', count = 3 }: LoadingSkeletonProps) {
  if (type === 'table') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="rounded-md border">
          <div className="p-4 space-y-3">
            {[...Array(count)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (type === 'form') {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(count)].map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (type === 'list') {
    return (
      <div className="space-y-3">
        {[...Array(count)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  // cards (default)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(count)].map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ==================== 空状态组件 ====================

interface EmptyStateProps {
  icon?: ReactNode
  title?: string
  description?: string
  action?: ReactNode
}

/**
 * 空状态组件
 */
export function EmptyState({ 
  icon, 
  title = '暂无数据', 
  description,
  action 
}: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
        <p className="text-muted-foreground font-medium">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  )
}

// ==================== 移动端优化组件 ====================

interface MobileButtonGroupProps {
  children: ReactNode
  className?: string
  stackOnMobile?: boolean
}

/**
 * 移动端按钮组
 * 小屏自动堆叠
 */
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

type MobileButtonProps = ButtonProps & {
  fullWidthOnMobile?: boolean
}

/**
 * 移动端按钮
 * 小屏自动全宽
 */
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

type MobileDialogContentProps = React.ComponentPropsWithoutRef<typeof DialogContent> & {
  fullScreenOnMobile?: boolean
}

/**
 * 移动端对话框
 * 小屏优化尺寸
 */
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

// ==================== 搜索和筛选组件 ====================

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/**
 * 搜索输入框
 */
export function SearchInput({ value, onChange, placeholder = '搜索...', className }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

interface FilterBadgesProps {
  filters: { key: string; label: string; active: boolean }[]
  onToggle: (key: string) => void
  className?: string
}

/**
 * 筛选标签组
 */
export function FilterBadges({ filters, onToggle, className }: FilterBadgesProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {filters.map(({ key, label, active }) => (
        <Badge
          key={key}
          variant={active ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => onToggle(key)}
        >
          {label}
        </Badge>
      ))}
    </div>
  )
}

// ==================== 动态列表组件 ====================

interface DynamicListProps<T> {
  items: T[]
  onChange: (items: T[]) => void
  createItem: () => T
  renderItem: (item: T, index: number, onChange: (item: T) => void) => ReactNode
  addButtonText?: string
  disabled?: boolean
  className?: string
  emptyText?: string
}

/**
 * 动态列表组件
 * 支持添加、删除、编辑项目
 */
export function DynamicList<T>({ 
  items = [], 
  onChange, 
  createItem,
  renderItem,
  addButtonText = '添加',
  disabled = false,
  className,
  emptyText = '暂无项目'
}: DynamicListProps<T>) {
  const handleAdd = () => {
    onChange([...items, createItem()])
  }

  const handleRemove = (index: number) => {
    const newItems = [...items]
    newItems.splice(index, 1)
    onChange(newItems)
  }

  const handleItemChange = (index: number, item: T) => {
    const newItems = [...items]
    newItems[index] = item
    onChange(newItems)
  }

  return (
    <div className={cn('space-y-3', className)}>
      {items.length === 0 && !disabled && (
        <p className="text-sm text-muted-foreground text-center py-4">{emptyText}</p>
      )}
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="flex-1">
            {renderItem(item, index, (newItem) => handleItemChange(index, newItem))}
          </div>
          {!disabled && (
            <Button 
              type="button" 
              variant="ghost" 
              size="icon"
              className="mt-1 text-destructive hover:text-destructive shrink-0"
              onClick={() => handleRemove(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button 
          type="button" 
          variant="outline" 
          size="sm"
          onClick={handleAdd}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          {addButtonText}
        </Button>
      )}
    </div>
  )
}

// ==================== 状态指示器组件 ====================

interface StatusIndicatorProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'loading'
  label?: string
  className?: string
}

/**
 * 状态指示器
 */
export function StatusIndicator({ status, label, className }: StatusIndicatorProps) {
  const statusConfig = {
    success: { color: 'bg-green-500', text: label || '成功' },
    error: { color: 'bg-red-500', text: label || '错误' },
    warning: { color: 'bg-yellow-500', text: label || '警告' },
    info: { color: 'bg-blue-500', text: label || '信息' },
    loading: { color: 'bg-gray-400 animate-pulse', text: label || '加载中' },
  }

  const config = statusConfig[status]

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('w-2 h-2 rounded-full', config.color)} />
      <span className="text-sm text-muted-foreground">{config.text}</span>
    </div>
  )
}

// ==================== 确认对话框Hook ====================

interface UseConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'destructive'
}

/**
 * 确认对话框Hook
 */
export function useConfirm() {
  const confirm = useCallback(async ({ 
    message,
  }: UseConfirmOptions): Promise<boolean> => {
    return window.confirm(message)
  }, [])

  return { confirm }
}

// ==================== 加载按钮组件 ====================

type LoadingButtonProps = ButtonProps & {
  loading?: boolean
  loadingText?: string
}

/**
 * 加载按钮
 */
export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ loading, loadingText, children, disabled, ...props }, ref) => {
    return (
      <Button ref={ref} disabled={disabled || loading} {...props}>
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {loadingText || children}
          </>
        ) : (
          children
        )}
      </Button>
    )
  }
)
LoadingButton.displayName = 'LoadingButton'

// ==================== 复制按钮组件 ====================

interface CopyButtonProps {
  text: string
  className?: string
  onCopied?: () => void
}

/**
 * 复制按钮
 */
export function CopyButton({ text, className, onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('已复制')
      onCopied?.()
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error(err)
      toast.error('复制失败')
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={handleCopy}
    >
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

// ==================== 切换开关行组件 ====================

interface SwitchRowProps {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * 切换开关行
 */
export function SwitchRow({ 
  label, 
  description, 
  checked, 
  onCheckedChange, 
  disabled,
  className 
}: SwitchRowProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  )
}

// ==================== 导出 ====================

export default {
  PageHeader,
  PageContainer,
  SectionCard,
  FormRow,
  FormGrid,
  FormField,
  LoadingSkeleton,
  EmptyState,
  MobileButtonGroup,
  MobileButton,
  MobileDialogContent,
  SearchInput,
  FilterBadges,
  DynamicList,
  StatusIndicator,
  LoadingButton,
  CopyButton,
  SwitchRow,
}
