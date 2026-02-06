'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useTabStore } from '@/lib/store'
import { getNavItemByPath } from '@/lib/nav-config'
import { useResponsive } from '@/lib/hooks'
import { X, MoreHorizontal, Trash2 } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * PageTabs - Browser-like tab bar for quick page switching
 * activeTab is always derived from pathname (not persisted) to avoid hydration issues.
 */
export function PageTabs() {
    const pathname = usePathname()
    const router = useRouter()
    const { tabs, addTab, removeTab, setActiveTab, clearOtherTabs, clearTabs } = useTabStore()
    const { isMobile, mounted } = useResponsive()
    const scrollRef = useRef<HTMLDivElement>(null)
    const activeTabRef = useRef<HTMLDivElement>(null)
    const lastPathRef = useRef<string>('')

    // Derive active tab from current URL - always in sync
    const activeTab = pathname || '/'

    // Auto-add tab on route change (only after mount, only when path actually changes)
    useEffect(() => {
        if (!mounted || !pathname || pathname === lastPathRef.current) return
        lastPathRef.current = pathname

        const navItem = getNavItemByPath(pathname)
        if (navItem) {
            addTab({
                path: pathname,
                label: navItem.label,
                icon: navItem.icon,
                closable: pathname !== '/'
            })
        } else if (pathname !== '/') {
            const segments = pathname.split('/').filter(Boolean)
            const label = segments[segments.length - 1] || pathname
            addTab({ path: pathname, label, closable: true })
        }
        setActiveTab(pathname)
    }, [pathname, mounted]) // eslint-disable-line react-hooks/exhaustive-deps

    // Scroll active tab into view
    useEffect(() => {
        if (mounted && activeTabRef.current) {
            activeTabRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            })
        }
    }, [activeTab, mounted])

    // Navigate to a tab
    const navigateToTab = useCallback((path: string) => {
        if (path === pathname) return
        router.push(path)
    }, [pathname, router])

    // Close tab and navigate if needed
    const handleCloseTab = useCallback((path: string) => {
        const tabIndex = tabs.findIndex(t => t.path === path)
        const isActiveTab = path === activeTab

        removeTab(path)

        // If closing the active tab, navigate to an adjacent tab
        if (isActiveTab) {
            const remainingTabs = tabs.filter(t => t.path !== path)
            const nextTab = remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)] || remainingTabs[0]
            if (nextTab) {
                router.push(nextTab.path)
            }
        }
    }, [tabs, activeTab, removeTab, router])

    if (!mounted) return null
    if (isMobile && tabs.length <= 1) return null

    return (
        <div className={cn(
            'flex items-center border-b border-border/40 bg-background/80 backdrop-blur-sm',
            isMobile ? 'h-9' : 'h-10'
        )}>
            <div
                ref={scrollRef}
                className="flex-1 flex items-center overflow-x-auto scrollbar-none"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {tabs.map(tab => {
                    const isActive = tab.path === activeTab
                    return (
                        <div
                            key={tab.path}
                            ref={isActive ? activeTabRef : undefined}
                            role="tab"
                            aria-selected={isActive}
                            className={cn(
                                'group relative flex items-center gap-1.5 shrink-0 cursor-pointer transition-all duration-150 select-none',
                                isMobile
                                    ? 'px-3 h-9 text-[11px]'
                                    : 'px-3.5 h-10 text-xs',
                                isActive
                                    ? 'text-foreground bg-background'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                            )}
                            onClick={() => navigateToTab(tab.path)}
                        >
                            {/* Active indicator */}
                            {isActive && (
                                <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full" />
                            )}

                            <span className={cn(
                                'truncate font-medium',
                                isMobile ? 'max-w-[80px]' : 'max-w-[120px]'
                            )}>
                                {tab.label}
                            </span>

                            {/* Desktop close button */}
                            {tab.closable && !isMobile && (
                                <button
                                    className={cn(
                                        'ml-0.5 p-0.5 rounded-sm transition-all',
                                        'opacity-0 group-hover:opacity-100',
                                        isActive && 'opacity-60',
                                        'hover:bg-muted-foreground/20 hover:opacity-100'
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleCloseTab(tab.path)
                                    }}
                                    aria-label={`关闭 ${tab.label}`}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}

                            {/* Mobile close - only on active tab */}
                            {tab.closable && isMobile && isActive && (
                                <button
                                    className="ml-0.5 p-0.5 rounded-sm opacity-60"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleCloseTab(tab.path)
                                    }}
                                >
                                    <X className="h-2.5 w-2.5" />
                                </button>
                            )}

                            {/* Separator */}
                            {!isActive && (
                                <div className="absolute right-0 top-2 bottom-2 w-px bg-border/30" />
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Actions dropdown */}
            {tabs.length > 1 && !isMobile && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="flex items-center justify-center h-10 w-9 shrink-0 border-l border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                            <MoreHorizontal className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuItem onClick={() => clearOtherTabs(activeTab)}>
                            <X className="mr-2 h-3.5 w-3.5" />
                            关闭其他
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={clearTabs} className="text-destructive focus:text-destructive">
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            关闭所有
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    )
}
