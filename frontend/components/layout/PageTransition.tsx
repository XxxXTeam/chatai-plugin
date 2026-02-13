'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useResponsive } from '@/lib/hooks'

/**
 * @description 页面过渡动画组件
 * @功能 基于路由变化自动触发平滑的淡入/滑入动画，支持移动端和桌面端差异化动效
 * - 桌面端：淡入 + 轻微上移
 * - 移动端：淡入 + 横向滑入（根据导航方向判断左/右）
 * - 支持 reduced-motion 偏好
 * - 直接操作 DOM 避免不必要的 React 重渲染
 * - GPU 加速渲染，避免动画卡顿
 */

interface PageTransitionProps {
    children: ReactNode
    className?: string
}

/* 导航路径权重表 - 用于判断导航方向（前进/后退） */
const NAV_ORDER: Record<string, number> = {
    '/': 0,
    '/settings': 10,
    '/settings/system': 11,
    '/settings/context': 12,
    '/channels': 20,
    '/presets': 30,
    '/scope': 35,
    '/settings/proxy': 13,
    '/settings/links': 14,
    '/tools': 40,
    '/mcp': 45,
    '/imagegen': 50,
    '/knowledge': 55,
    '/memory': 60,
    '/game': 65,
    '/stats': 70,
    '/history/usage': 75,
    '/conversations': 80,
    '/history': 85,
    '/users': 90,
    '/groups': 95
}

function getNavWeight(path: string): number {
    if (NAV_ORDER[path] !== undefined) return NAV_ORDER[path]
    /* 前缀匹配 - 子路由继承父权重 */
    for (const [prefix, weight] of Object.entries(NAV_ORDER)) {
        if (prefix !== '/' && path.startsWith(prefix + '/')) {
            return weight + 0.5
        }
    }
    return 50
}

export function PageTransition({ children, className }: PageTransitionProps) {
    const pathname = usePathname()
    const { isMobile } = useResponsive()
    const prevPathRef = useRef<string>(pathname)
    const containerRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number>(0)

    /* 同步 isMobile 到 ref，放在 effect 中避免 render 期间写 ref */
    const isMobileRef = useRef(isMobile)
    useEffect(() => {
        isMobileRef.current = isMobile
    }, [isMobile])

    /* 路由变化时通过 DOM 操作触发过渡动画，避免 setState 导致的额外渲染 */
    useEffect(() => {
        const el = containerRef.current
        if (!el || pathname === prevPathRef.current) return

        /* 检测是否偏好减少动画 */
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            prevPathRef.current = pathname
            return
        }

        const prevWeight = getNavWeight(prevPathRef.current)
        const newWeight = getNavWeight(pathname)
        const isForward = newWeight >= prevWeight
        prevPathRef.current = pathname

        /* 计算入场初始位置 */
        const mobile = isMobileRef.current
        const translateX = mobile ? (isForward ? '12px' : '-12px') : '0px'
        const translateY = mobile ? '0px' : '8px'

        /* 阶段1：设置初始位置（无过渡） */
        el.style.transition = 'none'
        el.style.opacity = '0'
        el.style.transform = `translate3d(${translateX}, ${translateY}, 0)`
        el.style.willChange = 'opacity, transform'

        /* 阶段2：下一帧启动过渡动画 */
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = requestAnimationFrame(() => {
                el.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                el.style.opacity = '1'
                el.style.transform = 'translate3d(0, 0, 0)'
            })
        })

        /* 过渡结束后清理 */
        const onEnd = () => {
            el.style.transition = ''
            el.style.opacity = ''
            el.style.transform = ''
            el.style.willChange = ''
        }
        el.addEventListener('transitionend', onEnd, { once: true })

        return () => {
            cancelAnimationFrame(rafRef.current)
            el.removeEventListener('transitionend', onEnd)
        }
    }, [pathname])

    /* 组件卸载时清理 rAF */
    useEffect(() => {
        return () => cancelAnimationFrame(rafRef.current)
    }, [])

    return (
        <div
            ref={containerRef}
            className={cn('page-transition-container', className)}
        >
            {children}
        </div>
    )
}
