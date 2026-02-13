'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { navGroups } from '@/lib/nav-config'

/**
 * @description 路由预加载组件
 * @功能 提升页面切换速度的预加载策略：
 * - 空闲时预加载核心路由页面资源
 * - 监听导航链接的 hover/touchstart 事件实现即时预取
 * - 使用 requestIdleCallback 避免阻塞主线程
 * - 去重机制防止重复预加载
 */

/* 核心路由列表 - 首屏后空闲时优先预加载 */
const CORE_ROUTES = ['/', '/settings', '/channels', '/tools', '/stats']

/* 所有可导航路由 */
const ALL_ROUTES = navGroups.flatMap(g => g.items.map(i => i.href))

export function RoutePreloader() {
    const router = useRouter()
    const prefetchedRef = useRef<Set<string>>(new Set())

    /* 预取单个路由（去重） */
    const prefetchRoute = useCallback((href: string) => {
        if (prefetchedRef.current.has(href)) return
        prefetchedRef.current.add(href)
        try {
            router.prefetch(href)
        } catch {
            /* 静默处理预取失败 */
        }
    }, [router])

    /* 空闲时预加载核心路由 */
    useEffect(() => {
        const hasIdleCallback = typeof window !== 'undefined' && 'requestIdleCallback' in window

        const scheduleIdle = (cb: () => void, timeout: number): number => {
            if (hasIdleCallback) {
                return (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number })
                    .requestIdleCallback(cb, { timeout })
            }
            return window.setTimeout(cb, timeout) as unknown as number
        }

        const cancelIdle = (id: number) => {
            if (hasIdleCallback) {
                (window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id)
            } else {
                clearTimeout(id)
            }
        }

        const cleanupIds: number[] = []

        /* 第一阶段：空闲时预加载核心路由 */
        const id1 = scheduleIdle(() => {
            CORE_ROUTES.forEach(route => prefetchRoute(route))

            /* 第二阶段：更深度空闲时预加载剩余路由 */
            const id2 = scheduleIdle(() => {
                ALL_ROUTES.forEach(route => prefetchRoute(route))
            }, 8000)

            cleanupIds.push(id2)
        }, 3000)

        cleanupIds.push(id1)

        return () => {
            cleanupIds.forEach(id => cancelIdle(id))
        }
    }, [prefetchRoute])

    /* 监听导航链接的交互事件进行即时预取 */
    useEffect(() => {
        const handleInteraction = (e: Event) => {
            const target = (e.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
            if (!target) return

            const href = target.getAttribute('href')
            if (!href || href.startsWith('http') || href.startsWith('#')) return

            prefetchRoute(href)
        }

        /* hover 和 touchstart 时预取 */
        document.addEventListener('pointerenter', handleInteraction, { capture: true, passive: true })
        document.addEventListener('touchstart', handleInteraction, { capture: true, passive: true })
        /* 聚焦时也预取（键盘导航） */
        document.addEventListener('focusin', handleInteraction, { capture: true, passive: true })

        return () => {
            document.removeEventListener('pointerenter', handleInteraction, { capture: true })
            document.removeEventListener('touchstart', handleInteraction, { capture: true })
            document.removeEventListener('focusin', handleInteraction, { capture: true })
        }
    }, [prefetchRoute])

    /* 纯逻辑组件，不渲染任何 DOM */
    return null
}
