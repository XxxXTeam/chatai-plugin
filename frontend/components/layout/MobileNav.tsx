'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Bot, MoreHorizontal, Wrench, BarChart3 } from 'lucide-react'
import { useUiStore } from '@/lib/store'
import { useResponsive } from '@/lib/hooks'

interface NavItem {
    href: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    matchPaths?: string[]
}

const navItems: NavItem[] = [
    {
        href: '/',
        label: '首页',
        icon: LayoutDashboard,
        matchPaths: ['/']
    },
    {
        href: '/channels',
        label: '渠道',
        icon: Bot,
        matchPaths: ['/channels']
    },
    {
        href: '/tools',
        label: '工具',
        icon: Wrench,
        matchPaths: ['/tools', '/mcp']
    },
    {
        href: '/stats',
        label: '统计',
        icon: BarChart3,
        matchPaths: ['/stats', '/history', '/conversations']
    }
]

function isActive(pathname: string, item: NavItem): boolean {
    if (item.matchPaths) {
        return item.matchPaths.some(p => (p === '/' ? pathname === '/' : pathname.startsWith(p)))
    }
    return pathname === item.href || pathname.startsWith(item.href + '/')
}

export function MobileNav() {
    const pathname = usePathname()
    const { toggleSidebar } = useUiStore()
    const { isMobile, mounted } = useResponsive()

    // 服务端渲染或桌面端不显示
    if (!mounted || !isMobile) {
        return null
    }

    return (
        <nav className="mobile-nav" role="navigation" aria-label="底部导航">
            <div className="flex items-center justify-around px-1 py-0.5">
                {navItems.map(item => {
                    const active = isActive(pathname, item)
                    const Icon = item.icon

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn('mobile-nav-item flex-1 touch-feedback', active && 'active')}
                            aria-current={active ? 'page' : undefined}
                        >
                            <div
                                className={cn(
                                    'p-1.5 rounded-xl transition-all duration-200',
                                    active ? 'bg-primary/10 scale-105' : 'hover:bg-muted/50'
                                )}
                            >
                                <Icon
                                    className={cn(
                                        'h-[18px] w-[18px] transition-colors',
                                        active ? 'text-primary' : 'text-muted-foreground'
                                    )}
                                />
                            </div>
                            <span
                                className={cn(
                                    'text-[9px] font-medium transition-colors',
                                    active ? 'text-primary' : 'text-muted-foreground'
                                )}
                            >
                                {item.label}
                            </span>
                        </Link>
                    )
                })}

                {/* 更多按钮 - 打开侧边栏 */}
                <button onClick={toggleSidebar} className="mobile-nav-item flex-1 touch-feedback" aria-label="打开菜单">
                    <div className="p-1.5 rounded-xl hover:bg-muted/50 transition-all duration-200">
                        <MoreHorizontal className="h-[18px] w-[18px] text-muted-foreground" />
                    </div>
                    <span className="text-[9px] font-medium text-muted-foreground">更多</span>
                </button>
            </div>
        </nav>
    )
}
