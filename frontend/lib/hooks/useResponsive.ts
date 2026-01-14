'use client'

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react'

// 断点定义
export const breakpoints = {
    xs: 480,
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536
}

export type Breakpoint = keyof typeof breakpoints

// 默认服务端渲染值 - 假设桌面端以避免布局闪烁
const DEFAULT_WIDTH = 1024
const DEFAULT_HEIGHT = 768

// 订阅窗口大小变化
function subscribeToWindowSize(callback: () => void) {
    window.addEventListener('resize', callback)
    window.addEventListener('orientationchange', callback)
    return () => {
        window.removeEventListener('resize', callback)
        window.removeEventListener('orientationchange', callback)
    }
}

function getWindowWidth() {
    return typeof window !== 'undefined' ? window.innerWidth : DEFAULT_WIDTH
}

function getWindowHeight() {
    return typeof window !== 'undefined' ? window.innerHeight : DEFAULT_HEIGHT
}

function getServerSnapshot() {
    return DEFAULT_WIDTH
}

function getServerHeightSnapshot() {
    return DEFAULT_HEIGHT
}

/**
 * 响应式断点hook - 使用 useSyncExternalStore 解决SSR水合问题
 * 返回当前屏幕尺寸信息
 */
export function useResponsive() {
    const width = useSyncExternalStore(subscribeToWindowSize, getWindowWidth, getServerSnapshot)
    const height = useSyncExternalStore(subscribeToWindowSize, getWindowHeight, getServerHeightSnapshot)

    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const isMobile = width < breakpoints.md
    const isTablet = width >= breakpoints.md && width < breakpoints.lg
    const isDesktop = width >= breakpoints.lg
    const isSmallMobile = width < breakpoints.xs
    const isLargeDesktop = width >= breakpoints.xl

    const isBelow = useCallback((bp: Breakpoint) => width < breakpoints[bp], [width])
    const isAbove = useCallback((bp: Breakpoint) => width >= breakpoints[bp], [width])
    const isBetween = useCallback(
        (minBp: Breakpoint, maxBp: Breakpoint) => width >= breakpoints[minBp] && width < breakpoints[maxBp],
        [width]
    )

    // 获取当前断点名称
    const getCurrentBreakpoint = useCallback((): Breakpoint => {
        if (width < breakpoints.xs) return 'xs'
        if (width < breakpoints.sm) return 'sm'
        if (width < breakpoints.md) return 'md'
        if (width < breakpoints.lg) return 'lg'
        if (width < breakpoints.xl) return 'xl'
        return '2xl'
    }, [width])

    return {
        width,
        height,
        mounted,
        isMobile,
        isTablet,
        isDesktop,
        isSmallMobile,
        isLargeDesktop,
        isBelow,
        isAbove,
        isBetween,
        breakpoint: getCurrentBreakpoint(),
        // 方向
        isLandscape: width > height,
        isPortrait: width <= height
    }
}

/**
 * 媒体查询hook - 使用 useSyncExternalStore 解决SSR水合问题
 */
export function useMediaQuery(query: string): boolean {
    const subscribe = useCallback(
        (callback: () => void) => {
            const mediaQuery = window.matchMedia(query)
            mediaQuery.addEventListener('change', callback)
            return () => mediaQuery.removeEventListener('change', callback)
        },
        [query]
    )

    const getSnapshot = useCallback(() => {
        return window.matchMedia(query).matches
    }, [query])

    const getServerSnapshot = useCallback(() => {
        // 服务端默认返回桌面端状态
        return false
    }, [])

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * 便捷的移动端检测hook
 */
export function useIsMobile(): boolean {
    return useMediaQuery(`(max-width: ${breakpoints.md - 1}px)`)
}

/**
 * 便捷的平板检测hook
 */
export function useIsTablet(): boolean {
    return useMediaQuery(`(min-width: ${breakpoints.md}px) and (max-width: ${breakpoints.lg - 1}px)`)
}

/**
 * 便捷的桌面端检测hook
 */
export function useIsDesktop(): boolean {
    return useMediaQuery(`(min-width: ${breakpoints.lg}px)`)
}

/**
 * 触摸设备检测 - 使用 useSyncExternalStore
 */
export function useIsTouchDevice(): boolean {
    const subscribe = useCallback((callback: () => void) => {
        // 触摸能力不会改变，但我们仍然需要订阅函数
        return () => {}
    }, [])

    const getSnapshot = useCallback(() => {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0
    }, [])

    const getServerSnapshot = useCallback(() => false, [])

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * 虚拟键盘检测hook
 */
export function useVirtualKeyboard() {
    const [isOpen, setIsOpen] = useState(false)
    const [keyboardHeight, setKeyboardHeight] = useState(0)

    useEffect(() => {
        if (typeof window === 'undefined') return

        // 使用 visualViewport API 检测虚拟键盘
        const viewport = window.visualViewport
        if (!viewport) return

        const initialHeight = viewport.height

        const handleResize = () => {
            const currentHeight = viewport.height
            const heightDiff = initialHeight - currentHeight
            const keyboardOpen = heightDiff > 100 // 阈值100px

            setIsOpen(keyboardOpen)
            setKeyboardHeight(keyboardOpen ? heightDiff : 0)
        }

        viewport.addEventListener('resize', handleResize)
        return () => viewport.removeEventListener('resize', handleResize)
    }, [])

    return { isOpen, keyboardHeight }
}

/**
 * 屏幕方向hook
 */
export function useOrientation(): 'portrait' | 'landscape' {
    const subscribe = useCallback((callback: () => void) => {
        window.addEventListener('resize', callback)
        window.addEventListener('orientationchange', callback)
        return () => {
            window.removeEventListener('resize', callback)
            window.removeEventListener('orientationchange', callback)
        }
    }, [])

    const getSnapshot = useCallback(() => {
        return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
    }, [])

    const getServerSnapshot = useCallback(() => 'portrait' as const, [])

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * 滚动锁定hook
 */
export function useScrollLock(lock: boolean) {
    useEffect(() => {
        if (!lock) return

        const originalStyle = window.getComputedStyle(document.body).overflow
        const scrollY = window.scrollY

        document.body.style.overflow = 'hidden'
        document.body.style.position = 'fixed'
        document.body.style.top = `-${scrollY}px`
        document.body.style.width = '100%'

        return () => {
            document.body.style.overflow = originalStyle
            document.body.style.position = ''
            document.body.style.top = ''
            document.body.style.width = ''
            window.scrollTo(0, scrollY)
        }
    }, [lock])
}

/**
 * 安全区域padding
 */
export function useSafeArea() {
    const [safeArea, setSafeArea] = useState({ top: 0, right: 0, bottom: 0, left: 0 })

    useEffect(() => {
        if (typeof window === 'undefined') return

        const updateSafeArea = () => {
            const style = getComputedStyle(document.documentElement)
            setSafeArea({
                top: parseInt(style.getPropertyValue('env(safe-area-inset-top)') || '0') || 0,
                right: parseInt(style.getPropertyValue('env(safe-area-inset-right)') || '0') || 0,
                bottom: parseInt(style.getPropertyValue('env(safe-area-inset-bottom)') || '0') || 0,
                left: parseInt(style.getPropertyValue('env(safe-area-inset-left)') || '0') || 0
            })
        }

        updateSafeArea()
        window.addEventListener('resize', updateSafeArea)
        return () => window.removeEventListener('resize', updateSafeArea)
    }, [])

    return safeArea
}

/**
 * 响应式值选择器
 */
export function useResponsiveValue<T>(values: { mobile?: T; tablet?: T; desktop: T }): T {
    const { isMobile, isTablet } = useResponsive()

    if (isMobile && values.mobile !== undefined) return values.mobile
    if (isTablet && values.tablet !== undefined) return values.tablet
    return values.desktop
}

/**
 * 获取当前设备类型
 */
export function useDeviceType(): 'mobile' | 'tablet' | 'desktop' {
    const { isMobile, isTablet } = useResponsive()
    if (isMobile) return 'mobile'
    if (isTablet) return 'tablet'
    return 'desktop'
}

export default useResponsive
