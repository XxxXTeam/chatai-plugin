'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { Button } from '@/components/ui/button'
import { Loader2, Save, RefreshCw, ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export type EditorTabId = 'basic' | 'features' | 'bym' | 'events' | 'channel' | 'advanced'

export interface EditorTabConfig {
    id: EditorTabId
    label: string
    icon: ReactNode
    mobileLabel?: string // 移动端简短标签
}

interface GroupEditorShellProps {
    // 标题信息
    title: string
    subtitle?: string
    // 状态
    loading?: boolean
    saving?: boolean
    // 回调
    onSave: () => void
    onRefresh?: () => void
    onBack?: () => void
    // Tab 相关
    tabs: EditorTabConfig[]
    activeTab: EditorTabId
    onTabChange: (tab: EditorTabId) => void
    // 内容
    children: ReactNode
    // 样式
    className?: string
}

/**
 * 群组编辑外壳组件
 * 为群组编辑和群管理面板提供统一的页面框架
 */
export function GroupEditorShell({
    title,
    subtitle,
    loading = false,
    saving = false,
    onSave,
    onRefresh,
    onBack,
    tabs,
    activeTab,
    onTabChange,
    children,
    className
}: GroupEditorShellProps) {
    const isMobile = useIsMobile()

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className={cn('flex flex-col h-full', className)}>
            {/* 头部 */}
            <header className="shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex items-center justify-between h-14">
                        {/* 左侧：标题信息 */}
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                            {onBack && (
                                <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9" onClick={onBack}>
                                    <ArrowLeft className="h-5 w-5" />
                                </Button>
                            )}
                            <div className="min-w-0">
                                <h1 className="text-lg sm:text-xl font-semibold truncate">{title}</h1>
                                {subtitle && (
                                    <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                                )}
                            </div>
                        </div>

                        {/* 右侧：操作按钮 */}
                        <div className="flex items-center gap-2 shrink-0">
                            {onRefresh && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onRefresh}
                                    disabled={saving}
                                    className="h-9 w-9"
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                            )}
                            <Button onClick={onSave} disabled={saving} size="sm" className="h-9">
                                {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                                <span className="hidden sm:inline">保存</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* 主内容区 - 桌面端双栏：侧边Tab + 内容 */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-7xl mx-auto px-4 py-4 pb-20 sm:pb-6">
                    {!isMobile ? (
                        <div className="flex gap-6">
                            {/* 桌面端侧边Tab导航 */}
                            <nav className="w-48 shrink-0">
                                <div className="sticky top-4 space-y-1">
                                    {tabs.map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => onTabChange(tab.id)}
                                            className={cn(
                                                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all',
                                                activeTab === tab.id
                                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                            )}
                                        >
                                            {tab.icon}
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </nav>
                            {/* 桌面端内容区 */}
                            <div className="flex-1 min-w-0">
                                <Card>
                                    <CardContent className="p-6">
                                        {children}
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    ) : (
                        /* 移动端单栏 */
                        <Card>
                            <CardContent className="p-4">
                                {children}
                            </CardContent>
                        </Card>
                    )}
                </div>
            </main>

            {/* 移动端底部导航 */}
            {isMobile && (
                <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t safe-area-pb">
                    <div className={cn(
                        'grid h-14',
                        tabs.length <= 5 ? `grid-cols-${tabs.length}` : 'grid-cols-5'
                    )}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                className={cn(
                                    'flex flex-col items-center justify-center gap-0.5 transition-colors',
                                    activeTab === tab.id
                                        ? 'text-primary'
                                        : 'text-muted-foreground'
                                )}
                            >
                                {tab.icon}
                                <span className="text-[10px] font-medium">
                                    {tab.mobileLabel || tab.label}
                                </span>
                            </button>
                        ))}
                    </div>
                </nav>
            )}
        </div>
    )
}
