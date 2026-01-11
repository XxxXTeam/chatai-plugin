'use client'

import { useState, useEffect, useCallback } from 'react'

// 断点定义
export const breakpoints = {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536
}

export type Breakpoint = keyof typeof breakpoints

/**
 * 响应式断点hook
 * 返回当前屏幕尺寸信息
 */
export function useResponsive() {
    const [windowSize, setWindowSize] = useState({
        width: typeof window !== 'undefined' ? window.innerWidth : 1024,
        height: typeof window !== 'undefined' ? window.innerHeight : 768
    })

    useEffect(() => {
        const handleResize = () => {
            setWindowSize({
                width: window.innerWidth,
                height: window.innerHeight
            })
        }

        // 初始化
        handleResize()

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    const isMobile = windowSize.width < breakpoints.md
    const isTablet = windowSize.width >= breakpoints.md && windowSize.width < breakpoints.lg
    const isDesktop = windowSize.width >= breakpoints.lg

    const isBelow = useCallback((bp: Breakpoint) => windowSize.width < breakpoints[bp], [windowSize.width])
    const isAbove = useCallback((bp: Breakpoint) => windowSize.width >= breakpoints[bp], [windowSize.width])

    return {
        width: windowSize.width,
        height: windowSize.height,
        isMobile,
        isTablet,
        isDesktop,
        isBelow,
        isAbove,
        breakpoint: isMobile ? 'sm' : isTablet ? 'md' : ('lg' as Breakpoint)
    }
}

/**
 * 媒体查询hook
 */
export function useMediaQuery(query: string): boolean {
    const getMatches = (q: string): boolean => {
        if (typeof window === 'undefined') return false
        return window.matchMedia(q).matches
    }

    const [matches, setMatches] = useState(() => getMatches(query))

    useEffect(() => {
        const media = window.matchMedia(query)
        const listener = () => setMatches(media.matches)
        media.addEventListener('change', listener)
        return () => media.removeEventListener('change', listener)
    }, [query])

    return matches
}

/**
 * 触摸设备检测
 */
export function useIsTouchDevice(): boolean {
    const [isTouch] = useState(() => {
        if (typeof window === 'undefined') return false
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0
    })

    return isTouch
}

/**
 * 安全区域padding
 */
export function useSafeArea() {
    const [safeArea] = useState(() => {
        if (typeof window === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 }
        const style = getComputedStyle(document.documentElement)
        return {
            top: parseInt(style.getPropertyValue('--sat') || '0'),
            right: parseInt(style.getPropertyValue('--sar') || '0'),
            bottom: parseInt(style.getPropertyValue('--sab') || '0'),
            left: parseInt(style.getPropertyValue('--sal') || '0')
        }
    })

    return safeArea
}

export default useResponsive
