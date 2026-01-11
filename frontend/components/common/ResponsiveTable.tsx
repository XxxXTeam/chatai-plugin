'use client'

import { ReactNode, useState } from 'react'
import { useResponsive } from '@/lib/hooks'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface Column<T> {
    key: string
    title: string
    // 在移动端隐藏
    hideOnMobile?: boolean
    // 在平板隐藏
    hideOnTablet?: boolean
    // 自定义渲染
    render?: (value: unknown, record: T, index: number) => ReactNode
    // 排序
    sortable?: boolean
    // 宽度
    width?: string | number
    // 对齐方式
    align?: 'left' | 'center' | 'right'
    // 移动端卡片视图中的显示优先级(1最高)
    mobilePriority?: number
}

export interface Action<T> {
    label: string
    icon?: ReactNode
    onClick: (record: T) => void
    // 是否危险操作（红色显示）
    danger?: boolean
    // 条件显示
    show?: (record: T) => boolean
}

interface ResponsiveTableProps<T> {
    columns: Column<T>[]
    data: T[]
    actions?: Action<T>[]
    // 唯一标识字段
    rowKey?: string | ((record: T) => string)
    // 加载状态
    loading?: boolean
    // 空状态显示
    emptyText?: string
    // 行点击
    onRowClick?: (record: T) => void
    // 选择功能
    selectable?: boolean
    selectedKeys?: string[]
    onSelectionChange?: (keys: string[]) => void
    // 卡片模式下的标题字段
    cardTitleKey?: string
    // 卡片模式下的描述字段
    cardDescKey?: string
}

/**
 * 响应式数据表格
 * 桌面端显示表格，移动端显示卡片列表
 */
export function ResponsiveTable<T extends Record<string, unknown>>({
    columns,
    data,
    actions = [],
    rowKey = 'id',
    loading = false,
    emptyText = '暂无数据',
    onRowClick,
    selectable: _selectable = false,
    selectedKeys: _selectedKeys = [],
    onSelectionChange: _onSelectionChange,
    cardTitleKey,
    cardDescKey
}: ResponsiveTableProps<T>) {
    const { isMobile, isTablet } = useResponsive()
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

    // 获取行的唯一标识
    const getRowKey = (record: T, index: number): string => {
        if (typeof rowKey === 'function') {
            return rowKey(record)
        }
        return String(record[rowKey] ?? index)
    }

    // 过滤显示的列
    const visibleColumns = columns.filter(col => {
        if (isMobile && col.hideOnMobile) return false
        if (isTablet && col.hideOnTablet) return false
        return true
    })

    // 移动端优先显示的字段
    const mobileColumns = [...columns]
        .filter(col => col.mobilePriority)
        .sort((a, b) => (a.mobilePriority || 99) - (b.mobilePriority || 99))
        .slice(0, 3)

    // 切换展开状态
    const toggleExpand = (key: string) => {
        setExpandedKeys(prev => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
    }

    // 渲染单元格内容
    const renderCell = (col: Column<T>, record: T, index: number) => {
        const value = record[col.key]
        if (col.render) {
            return col.render(value, record, index)
        }
        return String(value ?? '-')
    }

    // 渲染操作按钮
    const renderActions = (record: T) => {
        const visibleActions = actions.filter(action => !action.show || action.show(record))
        if (visibleActions.length === 0) return null

        if (visibleActions.length <= 2 && !isMobile) {
            return (
                <div className="flex gap-1">
                    {visibleActions.map((action, i) => (
                        <Button
                            key={i}
                            variant="ghost"
                            size="sm"
                            className={cn(action.danger && 'text-destructive hover:text-destructive')}
                            onClick={e => {
                                e.stopPropagation()
                                action.onClick(record)
                            }}
                        >
                            {action.icon}
                            <span className="ml-1">{action.label}</span>
                        </Button>
                    ))}
                </div>
            )
        }

        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={e => e.stopPropagation()}>
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {visibleActions.map((action, i) => (
                        <DropdownMenuItem
                            key={i}
                            className={cn(action.danger && 'text-destructive focus:text-destructive')}
                            onClick={() => action.onClick(record)}
                        >
                            {action.icon}
                            <span className="ml-2">{action.label}</span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        )
    }

    // 加载状态
    if (loading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
            </div>
        )
    }

    // 空状态
    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p>{emptyText}</p>
            </div>
        )
    }

    // 移动端卡片视图
    if (isMobile) {
        return (
            <div className="space-y-3">
                {data.map((record, index) => {
                    const key = getRowKey(record, index)
                    const isExpanded = expandedKeys.has(key)
                    const title = cardTitleKey ? String(record[cardTitleKey] || '') : undefined
                    const desc = cardDescKey ? String(record[cardDescKey] || '') : undefined

                    return (
                        <Card
                            key={key}
                            className={cn('transition-shadow', onRowClick && 'cursor-pointer hover:shadow-md')}
                            onClick={() => onRowClick?.(record)}
                        >
                            <CardContent className="p-4">
                                {/* 标题行 */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        {title && <div className="font-medium truncate">{title}</div>}
                                        {desc && <div className="text-sm text-muted-foreground truncate">{desc}</div>}
                                        {!title && !desc && mobileColumns.length > 0 && (
                                            <div className="space-y-1">
                                                {mobileColumns.map(col => (
                                                    <div key={col.key} className="flex items-center gap-2 text-sm">
                                                        <span className="text-muted-foreground">{col.title}:</span>
                                                        <span className="truncate">
                                                            {renderCell(col, record, index)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {renderActions(record)}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={e => {
                                                e.stopPropagation()
                                                toggleExpand(key)
                                            }}
                                        >
                                            {isExpanded ? (
                                                <ChevronUp className="h-4 w-4" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* 展开详情 */}
                                {isExpanded && (
                                    <div className="mt-3 pt-3 border-t space-y-2">
                                        {columns.map(col => (
                                            <div key={col.key} className="flex items-start gap-2 text-sm">
                                                <span className="text-muted-foreground whitespace-nowrap min-w-[80px]">
                                                    {col.title}:
                                                </span>
                                                <span className="flex-1">{renderCell(col, record, index)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )
                })}
            </div>
        )
    }

    // 桌面端表格视图
    return (
        <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-muted/50">
                    <tr>
                        {visibleColumns.map(col => (
                            <th
                                key={col.key}
                                className={cn(
                                    'px-4 py-3 text-left font-medium text-muted-foreground',
                                    col.align === 'center' && 'text-center',
                                    col.align === 'right' && 'text-right'
                                )}
                                style={{ width: col.width }}
                            >
                                {col.title}
                            </th>
                        ))}
                        {actions.length > 0 && (
                            <th className="px-4 py-3 text-right font-medium text-muted-foreground w-[100px]">操作</th>
                        )}
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {data.map((record, index) => {
                        const key = getRowKey(record, index)
                        return (
                            <tr
                                key={key}
                                className={cn('hover:bg-muted/30 transition-colors', onRowClick && 'cursor-pointer')}
                                onClick={() => onRowClick?.(record)}
                            >
                                {visibleColumns.map(col => (
                                    <td
                                        key={col.key}
                                        className={cn(
                                            'px-4 py-3',
                                            col.align === 'center' && 'text-center',
                                            col.align === 'right' && 'text-right'
                                        )}
                                    >
                                        {renderCell(col, record, index)}
                                    </td>
                                ))}
                                {actions.length > 0 && (
                                    <td className="px-4 py-3 text-right">{renderActions(record)}</td>
                                )}
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

export default ResponsiveTable
