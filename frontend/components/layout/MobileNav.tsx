'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Settings, Bot, MessageSquare, MoreHorizontal } from 'lucide-react'
import { useUiStore } from '@/lib/store'

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
        href: '/conversations',
        label: '对话',
        icon: MessageSquare,
        matchPaths: ['/conversations', '/history']
    },
    {
        href: '/settings',
        label: '设置',
        icon: Settings,
        matchPaths: ['/settings', '/presets', '/scope']
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

    return (
        <nav className="mobile-nav lg:hidden">
            <div className="flex items-center justify-around px-2">
                {navItems.map(item => {
                    const active = isActive(pathname, item)
                    const Icon = item.icon

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn('mobile-nav-item flex-1', active && 'active')}
                        >
                            <div className={cn('p-1.5 rounded-lg transition-colors', active && 'bg-primary/10')}>
                                <Icon
                                    className={cn(
                                        'h-5 w-5 transition-colors',
                                        active ? 'text-primary' : 'text-muted-foreground'
                                    )}
                                />
                            </div>
                            <span
                                className={cn(
                                    'text-[10px] font-medium',
                                    active ? 'text-primary' : 'text-muted-foreground'
                                )}
                            >
                                {item.label}
                            </span>
                        </Link>
                    )
                })}

                {/* 更多按钮 - 打开侧边栏 */}
                <button onClick={toggleSidebar} className="mobile-nav-item flex-1">
                    <div className="p-1.5 rounded-lg">
                        <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground">更多</span>
                </button>
            </div>
        </nav>
    )
}
