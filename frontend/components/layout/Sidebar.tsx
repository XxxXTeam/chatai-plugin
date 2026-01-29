'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
    LayoutDashboard,
    Settings,
    MessageSquare,
    Users,
    Plug,
    Bot,
    Wrench,
    History,
    Palette,
    UsersRound,
    ChevronDown,
    UserCog,
    Brain,
    BookOpen,
    Cpu,
    Database,
    BarChart3,
    Wand2,
    Globe,
    Activity,
    FileText,
    Server,
    Link as LinkIcon,
    type LucideIcon
} from 'lucide-react'
import { useUiStore } from '@/lib/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface NavItem {
    href: string
    label: string
    icon?: LucideIcon
    tourId?: string
}

interface NavGroup {
    id: string
    label: string
    icon: LucideIcon
    items: NavItem[]
    tourId?: string
}

// 合并后的分组导航结构
const navGroups: NavGroup[] = [
    {
        id: 'overview',
        label: '仪表盘',
        icon: LayoutDashboard,
        items: [{ href: '/', label: '仪表盘', icon: LayoutDashboard }]
    },
    {
        id: 'config',
        label: '配置中心',
        icon: Settings,
        tourId: 'config',
        items: [
            { href: '/settings', label: '基础设置', icon: Settings, tourId: 'settings' },
            { href: '/settings/system', label: '系统配置', icon: Server },
            { href: '/settings/context', label: '上下文配置', icon: FileText },
            { href: '/channels', label: '渠道管理', icon: Plug, tourId: 'channels' },
            { href: '/presets', label: '预设管理', icon: Palette, tourId: 'presets' },
            { href: '/scope', label: '人设管理', icon: UserCog },
            { href: '/settings/proxy', label: '代理设置', icon: Globe },
            { href: '/settings/links', label: '登录链接', icon: LinkIcon }
        ]
    },
    {
        id: 'ai',
        label: 'AI扩展',
        icon: Cpu,
        tourId: 'ai',
        items: [
            { href: '/tools', label: '工具配置', icon: Wrench },
            { href: '/mcp', label: 'MCP服务', icon: Bot },
            { href: '/imagegen', label: '绘图预设', icon: Wand2 },
            { href: '/knowledge', label: '知识库', icon: BookOpen },
            { href: '/memory', label: '记忆管理', icon: Brain }
        ]
    },
    {
        id: 'data',
        label: '数据记录',
        icon: Database,
        tourId: 'data',
        items: [
            { href: '/stats', label: '使用统计', icon: BarChart3 },
            { href: '/history/usage', label: '调用统计', icon: Activity },
            { href: '/conversations', label: '对话历史', icon: MessageSquare },
            { href: '/history', label: '工具调用', icon: History }
        ]
    },
    {
        id: 'users',
        label: '用户管理',
        icon: Users,
        tourId: 'users',
        items: [
            { href: '/users', label: '用户管理', icon: Users },
            { href: '/groups', label: '群组管理', icon: UsersRound, tourId: 'groups' }
        ]
    }
]

// 判断单个导航项是否激活（精确匹配优先）
function isItemActive(itemHref: string, pathname: string, allItems: NavItem[]): boolean {
    // 精确匹配
    if (pathname === itemHref) return true
    const hasMoreSpecificMatch = allItems.some(
        other =>
            other.href !== itemHref &&
            other.href.startsWith(itemHref + '/') &&
            (pathname === other.href || pathname.startsWith(other.href + '/'))
    )
    if (hasMoreSpecificMatch) return false
    // 前缀匹配
    return itemHref !== '/' && pathname.startsWith(itemHref + '/')
}

// 判断分组是否有激活项
function isGroupActive(group: NavGroup, pathname: string): boolean {
    return group.items.some(item => isItemActive(item.href, pathname, group.items))
}

// 导航分组组件
function NavGroupItem({
    group,
    pathname,
    onNavClick,
    isOpen,
    onToggle
}: {
    group: NavGroup
    pathname: string
    onNavClick?: () => void
    isOpen: boolean
    onToggle: () => void
}) {
    const hasActiveItem = isGroupActive(group, pathname)
    const Icon = group.icon

    // 单项分组直接渲染链接
    if (group.items.length === 1) {
        const item = group.items[0]
        const isActive = pathname === item.href
        const ItemIcon = item.icon || Icon

        return (
            <Link
                href={item.href}
                className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden group/item',
                    isActive
                        ? 'text-primary-foreground shadow-lg shadow-primary/25'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:shadow-sm'
                )}
                onClick={onNavClick}
            >
                {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary to-primary/80 opacity-100 transition-opacity" />
                )}
                <div
                    className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300 relative z-10',
                        isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-muted/50 group-hover/item:bg-background group-hover/item:scale-110'
                    )}
                >
                    <ItemIcon className="h-4 w-4" />
                </div>
                <span className="relative z-10">{item.label}</span>
            </Link>
        )
    }

    return (
        <Collapsible open={isOpen} onOpenChange={onToggle}>
            <CollapsibleTrigger className="w-full group/trigger">
                <div
                    className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 w-full relative overflow-hidden',
                        hasActiveItem
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                    )}
                    {...(group.tourId ? { 'data-tour': group.tourId } : {})}
                >
                    {hasActiveItem && <div className="absolute inset-0 bg-primary/5 opacity-100 transition-opacity" />}
                    <div
                        className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300 relative z-10',
                            hasActiveItem
                                ? 'bg-primary/10 text-primary shadow-sm'
                                : 'bg-muted/50 group-hover/trigger:bg-background group-hover/trigger:scale-110'
                        )}
                    >
                        <Icon className="h-4 w-4" />
                    </div>
                    <span className="flex-1 text-left relative z-10">{group.label}</span>
                    <ChevronDown
                        className={cn(
                            'h-4 w-4 transition-transform duration-300 text-muted-foreground/70 group-hover/trigger:text-foreground relative z-10',
                            isOpen && 'rotate-180'
                        )}
                    />
                </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 ml-6 pl-3 border-l-2 border-border/40 space-y-0.5">
                {group.items.map(item => {
                    const isActive = isItemActive(item.href, pathname, group.items)
                    const ItemIcon = item.icon

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150',
                                isActive
                                    ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            )}
                            onClick={onNavClick}
                            {...(item.tourId ? { 'data-tour': item.tourId } : {})}
                        >
                            {ItemIcon && <ItemIcon className="h-4 w-4" />}
                            <span>{item.label}</span>
                        </Link>
                    )
                })}
            </CollapsibleContent>
        </Collapsible>
    )
}

// 导航内容
function NavContent({ pathname, onNavClick }: { pathname: string; onNavClick?: () => void }) {
    const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
        const initial = new Set<string>()
        navGroups.forEach(group => {
            if (isGroupActive(group, pathname)) {
                initial.add(group.id)
            }
        })
        return initial
    })

    const toggleGroup = (id: string) => {
        setOpenGroups(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    return (
        <nav className="p-4 space-y-2">
            {navGroups.map(group => (
                <NavGroupItem
                    key={group.id}
                    group={group}
                    pathname={pathname}
                    onNavClick={onNavClick}
                    isOpen={openGroups.has(group.id)}
                    onToggle={() => toggleGroup(group.id)}
                />
            ))}
        </nav>
    )
}

export function Sidebar() {
    const pathname = usePathname()
    const { sidebarOpen, setSidebarOpen } = useUiStore()

    return (
        <>
            {/* Desktop Sidebar */}
            <aside className="hidden lg:block w-64 glass-sidebar h-screen sticky top-0 transition-all duration-300" data-tour="sidebar">
                <div className="flex h-16 items-center px-6 border-b border-border/40 backdrop-blur-md bg-background/20">
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/20 group-hover:shadow-primary/40 group-hover:scale-110 transition-all duration-300">
                            <Bot className="h-5 w-5 text-primary-foreground" />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-bold text-lg leading-tight tracking-tight">ChatAI</span>
                            <span className="text-[10px] text-muted-foreground leading-tight uppercase tracking-wider font-semibold">
                                Assistant
                            </span>
                        </div>
                    </Link>
                </div>
                <ScrollArea className="h-[calc(100vh-4rem)]">
                    <NavContent pathname={pathname} />
                </ScrollArea>
            </aside>

            {/* Mobile Sheet */}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetContent side="left" className="w-72 p-0 glass-sidebar border-r-0">
                    <SheetHeader className="h-16 flex flex-row items-center px-6 border-b border-border/40 bg-background/20">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md mr-3">
                            <Bot className="h-5 w-5 text-primary-foreground" />
                        </div>
                        <SheetTitle className="font-bold text-lg">ChatAI</SheetTitle>
                    </SheetHeader>
                    <ScrollArea className="h-[calc(100vh-4rem)]">
                        <NavContent pathname={pathname} onNavClick={() => setSidebarOpen(false)} />
                    </ScrollArea>
                </SheetContent>
            </Sheet>
        </>
    )
}
