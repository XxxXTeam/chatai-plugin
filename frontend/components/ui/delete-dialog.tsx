'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react'

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  itemName?: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
  variant?: 'default' | 'danger'
}

export function DeleteDialog({
  open,
  onOpenChange,
  title = '确认删除',
  description,
  itemName,
  onConfirm,
  loading = false,
  variant = 'danger',
}: DeleteDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false)
  
  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      console.error('Delete failed:', error)
    } finally {
      setIsDeleting(false)
    }
  }
  
  const isLoading = loading || isDeleting
  
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={cn(
        'sm:max-w-md overflow-hidden',
        'bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl'
      )}>
        {/* 顶部警告图标区域 */}
        <div className="flex flex-col items-center pt-2 pb-4">
          <div className={cn(
            'relative flex h-16 w-16 items-center justify-center rounded-full',
            variant === 'danger' 
              ? 'bg-gradient-to-br from-red-500/20 to-red-600/20' 
              : 'bg-gradient-to-br from-amber-500/20 to-amber-600/20'
          )}>
            {/* 外圈动画 */}
            <div className={cn(
              'absolute inset-0 rounded-full animate-ping opacity-20',
              variant === 'danger' ? 'bg-red-500' : 'bg-amber-500'
            )} style={{ animationDuration: '2s' }} />
            
            {/* 中圈 */}
            <div className={cn(
              'absolute inset-2 rounded-full',
              variant === 'danger' 
                ? 'bg-gradient-to-br from-red-500/30 to-red-600/30' 
                : 'bg-gradient-to-br from-amber-500/30 to-amber-600/30'
            )} />
            
            {/* 图标 */}
            <AlertTriangle className={cn(
              'h-7 w-7 relative z-10',
              variant === 'danger' ? 'text-red-500' : 'text-amber-500'
            )} />
          </div>
        </div>
        
        <AlertDialogHeader className="text-center space-y-3">
          <AlertDialogTitle className="text-xl font-semibold">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {description || (
              <>
                此操作不可撤销。
                {itemName && (
                  <>
                    <br />
                    <span className="mt-2 inline-block">
                      确定要删除 <span className="font-medium text-foreground">「{itemName}」</span> 吗？
                    </span>
                  </>
                )}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <AlertDialogFooter className="mt-6 sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="flex-1 sm:flex-none"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isLoading}
            className={cn(
              'flex-1 sm:flex-none gap-2',
              'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
              'shadow-lg shadow-red-500/25 hover:shadow-red-500/40',
              'transition-all duration-300'
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                删除中...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                确认删除
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// 批量删除对话框
interface BatchDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  itemType?: string
  onConfirm: () => void | Promise<void>
  loading?: boolean
}

export function BatchDeleteDialog({
  open,
  onOpenChange,
  count,
  itemType = '项目',
  onConfirm,
  loading = false,
}: BatchDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false)
  
  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (error) {
      console.error('Batch delete failed:', error)
    } finally {
      setIsDeleting(false)
    }
  }
  
  const isLoading = loading || isDeleting
  
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={cn(
        'sm:max-w-md overflow-hidden',
        'bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl'
      )}>
        {/* 顶部警告图标区域 */}
        <div className="flex flex-col items-center pt-2 pb-4">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-red-500/20 to-red-600/20">
            <div 
              className="absolute inset-0 rounded-full animate-ping opacity-20 bg-red-500"
              style={{ animationDuration: '2s' }} 
            />
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-red-500/30 to-red-600/30" />
            <AlertTriangle className="h-7 w-7 relative z-10 text-red-500" />
          </div>
          
          {/* 数量徽章 */}
          <div className="absolute top-14 right-[calc(50%-2rem)] transform translate-x-1/2">
            <div className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-2 text-xs font-bold text-white shadow-lg shadow-red-500/50">
              {count}
            </div>
          </div>
        </div>
        
        <AlertDialogHeader className="text-center space-y-3">
          <AlertDialogTitle className="text-xl font-semibold">
            批量删除确认
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            您即将删除 <span className="font-semibold text-red-500">{count}</span> 个{itemType}。
            <br />
            <span className="text-destructive font-medium">此操作不可撤销！</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <AlertDialogFooter className="mt-6 sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="flex-1 sm:flex-none"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isLoading}
            className={cn(
              'flex-1 sm:flex-none gap-2',
              'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
              'shadow-lg shadow-red-500/25 hover:shadow-red-500/40',
              'transition-all duration-300'
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                删除中...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                删除全部 ({count})
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
