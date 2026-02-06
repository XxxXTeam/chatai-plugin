'use client'

import { useState, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/hooks/useResponsive'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
    Loader2,
    Save,
    RefreshCw,
    Menu,
    ArrowLeft,
    Settings,
    Zap,
    Sparkles,
    MessageSquare,
    Calendar,
    BookOpen,
    Server
} from 'lucide-react'

export type AdminTabId = 'basic' | 'features' | 'bym' | 'events' | 'channel' | 'advanced'

export interface AdminTabConfig {
    id: AdminTabId
    label: string
    icon: ReactNode
    mobileLabel?: string // 移动端简短标签
}

// 默认的 Tab 配置
export const defaultAdminTabs: AdminTabConfig[] = [
    { id: 'basic', label: '基础设置', icon: <Settings className="h-4 w-4" />, mobileLabel: '基础' },
    { id: 'features', label: '功能开关', icon: <Zap className="h-4 w-4" />, mobileLabel: '功能' },
    { id: 'bym', label: '伪人模式', icon: <Sparkles className="h-4 w-4" />, mobileLabel: '伪人' },
    { id: 'events', label: '事件处理', icon: <Calendar className="h-4 w-4" />, mobileLabel: '事件' },
    { id: 'channel', label: '对话设置', icon: <MessageSquare className="h-4 w-4" />, mobileLabel: '对话' },
    { id: 'advanced', label: '高级配置', icon: <BookOpen className="h-4 w-4" />, mobileLabel: '高级' }
]

interface GroupAdminShellProps {
    // 群组信息
    groupId: string
    groupName?: string
    // 状态
    loading?: boolean
    saving?: boolean
    needLogin?: boolean
    // 回调
    onSave: () => void
    onRefresh?: () => void
    onLogout?: () => void
    // Tab 相关
    tabs?: AdminTabConfig[]
    activeTab: AdminTabId
    onTabChange: (tab: AdminTabId) => void
    // 内容
    children: ReactNode
    // 登录组件
    loginComponent?: ReactNode
}

/**
 * 群管理面板外壳组件
 * 为群内管理员提供统一的页面框架
 * 支持移动端底部导航和桌面端侧边/顶部导航
 */
export function GroupAdminShell({
    groupId,
    groupName,
    loading = false,
    saving = false,
    needLogin = false,
    onSave,
    onRefresh,
    onLogout,
    tabs = defaultAdminTabs,
    activeTab,
    onTabChange,
    children,
    loginComponent
}: GroupAdminShellProps) {
    const isMobile = useIsMobile()
    const [menuOpen, setMenuOpen] = useState(false)

    // 登录界面
    if (needLogin && loginComponent) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-muted">
                {loginComponent}
            </div>
        )
    }

    // 加载中
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background">
            {/* 顶部头部 */}
            <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex items-center justify-between h-14">
                        {/* 左侧：群组信息 */}
                        <div className="flex items-center gap-3 min-w-0">
                            {isMobile && (
                                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                                    <SheetTrigger asChild>
                                        <Button variant="ghost" size="icon" className="shrink-0">
                                            <Menu className="h-5 w-5" />
                                        </Button>
                                    </SheetTrigger>
                                    <SheetContent side="left" className="w-64">
                                        <SheetHeader>
                                            <SheetTitle>菜单</SheetTitle>
                                        </SheetHeader>
                                        <nav className="mt-4 space-y-1">
                                            {tabs.map(tab => (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => {
                                                        onTabChange(tab.id)
                                                        setMenuOpen(false)
                                                    }}
                                                    className={cn(
                                                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                                                        activeTab === tab.id
                                                            ? 'bg-primary text-primary-foreground'
                                                            : 'hover:bg-muted'
                                                    )}
                                                >
                                                    {tab.icon}
                                                    <span>{tab.label}</span>
                                                </button>
                                            ))}
                                        </nav>
                                        {onLogout && (
                                            <div className="absolute bottom-4 left-4 right-4">
                                                <Button 
                                                    variant="outline" 
                                                    className="w-full" 
                                                    onClick={onLogout}
                                                >
                                                    退出登录
                                                </Button>
                                            </div>
                                        )}
                                    </SheetContent>
                                </Sheet>
                            )}
                            <div className="min-w-0">
                                <h1 className="font-semibold truncate">
                                    {groupName || `群 ${groupId}`}
                                </h1>
                                <p className="text-xs text-muted-foreground font-mono">
                                    #{groupId}
                                </p>
                            </div>
                        </div>

                        {/* 右侧：操作按钮 */}
                        <div className="flex items-center gap-2">
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
                            <Button
                                onClick={onSave}
                                disabled={saving}
                                size="sm"
                                className="h-9"
                            >
                                {saving ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                ) : (
                                    <Save className="h-4 w-4 mr-1.5" />
                                )}
                                <span className="hidden sm:inline">保存</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* 主内容区 */}
            <main className="max-w-7xl mx-auto px-4 py-4 pb-20 sm:pb-4">
                {!isMobile ? (
                    /* 桌面端双栏：侧边Tab + 内容 */
                    <div className="flex gap-6">
                        <nav className="w-48 shrink-0">
                            <div className="sticky top-20 space-y-1">
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
            </main>

            {/* 移动端底部导航 */}
            {isMobile && (
                <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t safe-area-pb">
                    <div className="grid grid-cols-5 h-14">
                        {tabs.slice(0, 5).map(tab => (
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

interface AdminLoginCardProps {
    onLogin: (code: string) => void
    loading?: boolean
    error?: string
}

/**
 * 群管理面板登录卡片
 */
export function AdminLoginCard({ onLogin, loading, error }: AdminLoginCardProps) {
    const [code, setCode] = useState('')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (code.trim()) {
            onLogin(code.trim().toUpperCase())
        }
    }

    return (
        <Card className="w-full max-w-sm">
            <CardContent className="p-6">
                <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Server className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold">群管理面板</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        请输入登录码访问群组配置
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <input
                            type="text"
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            placeholder="输入登录码"
                            className="w-full h-11 px-4 rounded-lg border bg-background text-center font-mono text-lg tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/20"
                            autoComplete="off"
                            autoFocus
                        />
                    </div>
                    {error && (
                        <p className="text-sm text-destructive text-center">{error}</p>
                    )}
                    <Button type="submit" className="w-full h-11" disabled={loading || !code.trim()}>
                        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        登录
                    </Button>
                </form>

                <p className="text-xs text-muted-foreground text-center mt-4">
                    在群内发送 #ai群管理 获取登录码
                </p>
            </CardContent>
        </Card>
    )
}
