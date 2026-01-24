'use client'

import { useState, ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Loader2,
    Save,
    Settings,
    Zap,
    Sparkles,
    BookOpen,
    RefreshCw,
    MessageSquare,
    Calendar,
    ArrowLeft
} from 'lucide-react'

export type TabId = 'basic' | 'features' | 'bym' | 'events' | 'channel' | 'advanced'

export interface TabConfig {
    id: TabId
    label: string
    icon: ReactNode
    content: ReactNode
    visible?: boolean
}

export interface GroupEditorLayoutProps {
    // 模式
    mode: 'admin' | 'global'
    // 群组信息
    groupId: string
    groupName?: string
    // 状态
    loading?: boolean
    saving?: boolean
    isModified?: boolean
    // 事件回调
    onSave: () => void
    onRefresh?: () => void
    onBack?: () => void
    // Tab配置
    tabs: TabConfig[]
    defaultTab?: TabId
    // 额外操作按钮
    extraActions?: ReactNode
    // 头部额外内容
    headerExtra?: ReactNode
    // 错误信息
    error?: string | null
}

/**
 * 群组编辑器统一布局组件
 * 提供标准化的 Tab 导航、工具栏和内容区域
 */
export function GroupEditorLayout({
    mode,
    groupId,
    groupName,
    loading = false,
    saving = false,
    isModified = false,
    onSave,
    onRefresh,
    onBack,
    tabs,
    defaultTab = 'basic',
    extraActions,
    headerExtra,
    error
}: GroupEditorLayoutProps) {
    const [activeTab, setActiveTab] = useState<TabId>(defaultTab)

    // 过滤可见的 Tab
    const visibleTabs = tabs.filter(tab => tab.visible !== false)

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* 头部工具栏 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <Button variant="ghost" size="icon" onClick={onBack}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    )}
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold">
                                {mode === 'admin' ? '群独立配置' : '群组设置'}
                            </h2>
                            {groupId && (
                                <Badge variant="outline" className="font-mono">
                                    {groupId}
                                </Badge>
                            )}
                            {isModified && (
                                <Badge variant="secondary" className="text-orange-600">
                                    未保存
                                </Badge>
                            )}
                        </div>
                        {groupName && (
                            <p className="text-sm text-muted-foreground">{groupName}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {headerExtra}
                    {extraActions}
                    {onRefresh && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onRefresh}
                            disabled={loading || saving}
                        >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            刷新
                        </Button>
                    )}
                    <Button
                        onClick={onSave}
                        disabled={saving || loading}
                        size="sm"
                    >
                        {saving ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4 mr-1" />
                        )}
                        保存
                    </Button>
                </div>
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    {error}
                </div>
            )}

            {/* 主内容区 */}
            <Card>
                <CardContent className="pt-6">
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
                        <TabsList className={`grid w-full mb-4 grid-cols-${Math.min(visibleTabs.length, 6)}`}>
                            {visibleTabs.map(tab => (
                                <TabsTrigger key={tab.id} value={tab.id}>
                                    <span className="hidden sm:inline mr-1">{tab.icon}</span>
                                    {tab.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        <ScrollArea className="h-[calc(100vh-280px)] sm:h-[65vh] pr-4 -mr-4">
                            {visibleTabs.map(tab => (
                                <TabsContent
                                    key={tab.id}
                                    value={tab.id}
                                    className="space-y-4 mt-0"
                                >
                                    {tab.content}
                                </TabsContent>
                            ))}
                        </ScrollArea>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    )
}

/**
 * 默认 Tab 配置生成器
 */
export function getDefaultTabs(contents: {
    basic?: ReactNode
    features?: ReactNode
    bym?: ReactNode
    events?: ReactNode
    channel?: ReactNode
    advanced?: ReactNode
}): TabConfig[] {
    return [
        {
            id: 'basic',
            label: '基础',
            icon: <Settings className="h-4 w-4" />,
            content: contents.basic,
            visible: !!contents.basic
        },
        {
            id: 'features',
            label: '功能',
            icon: <Zap className="h-4 w-4" />,
            content: contents.features,
            visible: !!contents.features
        },
        {
            id: 'bym',
            label: '伪人',
            icon: <Sparkles className="h-4 w-4" />,
            content: contents.bym,
            visible: !!contents.bym
        },
        {
            id: 'events',
            label: '事件',
            icon: <Calendar className="h-4 w-4" />,
            content: contents.events,
            visible: !!contents.events
        },
        {
            id: 'channel',
            label: '对话',
            icon: <MessageSquare className="h-4 w-4" />,
            content: contents.channel,
            visible: !!contents.channel
        },
        {
            id: 'advanced',
            label: '高级',
            icon: <BookOpen className="h-4 w-4" />,
            content: contents.advanced,
            visible: !!contents.advanced
        }
    ]
}

export default GroupEditorLayout
