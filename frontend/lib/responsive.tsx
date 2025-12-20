'use client'

import { useState, useEffect, useCallback, ReactNode } from 'react'

/**
 * 响应式断点定义
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}

/**
 * 响应式状态Hook
 */
export function useResponsive() {
  const [state, setState] = useState({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
  })

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth
      setState({
        isMobile: width < breakpoints.md,
        isTablet: width >= breakpoints.md && width < breakpoints.lg,
        isDesktop: width >= breakpoints.lg,
        width,
      })
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return state
}

/**
 * 媒体查询Hook
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])

  return matches
}

export function useIsMobile() {
  return useMediaQuery(`(max-width: ${breakpoints.md - 1}px)`)
}

export function useIsTablet() {
  return useMediaQuery(`(min-width: ${breakpoints.md}px) and (max-width: ${breakpoints.lg - 1}px)`)
}

export function useIsDesktop() {
  return useMediaQuery(`(min-width: ${breakpoints.lg}px)`)
}

export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])
  return isTouch
}

/**
 * 响应式值选择
 */
export function useResponsiveValue<T>(values: { mobile?: T; tablet?: T; desktop: T }): T {
  const { isMobile, isTablet } = useResponsive()
  if (isMobile && values.mobile !== undefined) return values.mobile
  if (isTablet && values.tablet !== undefined) return values.tablet
  return values.desktop
}

/**
 * 安全区域Hook
 */
export function useSafeArea() {
  const [safeArea, setSafeArea] = useState({ top: 0, bottom: 0, left: 0, right: 0 })

  useEffect(() => {
    const computeStyle = getComputedStyle(document.documentElement)
    setSafeArea({
      top: parseInt(computeStyle.getPropertyValue('--sat') || '0'),
      bottom: parseInt(computeStyle.getPropertyValue('--sab') || '0'),
      left: parseInt(computeStyle.getPropertyValue('--sal') || '0'),
      right: parseInt(computeStyle.getPropertyValue('--sar') || '0'),
    })
  }, [])

  return safeArea
}

/**
 * 屏幕方向Hook
 */
export function useOrientation() {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')

  useEffect(() => {
    const handleChange = () => {
      setOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape')
    }
    handleChange()
    window.addEventListener('resize', handleChange)
    return () => window.removeEventListener('resize', handleChange)
  }, [])

  return orientation
}

/**
 * 虚拟键盘检测Hook
 */
export function useVirtualKeyboard() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const initialHeight = window.innerHeight
    const handleResize = () => {
      setIsOpen(window.innerHeight < initialHeight * 0.75)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isOpen
}

/**
 * 滚动锁定Hook
 */
export function useScrollLock(lock: boolean) {
  useEffect(() => {
    if (lock) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [lock])
}

/**
 * 窗口尺寸Hook
 */
export function useWindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return size
}

/**
 * 响应式CSS类名工具
 */
export function responsiveClass(classes: { base?: string; mobile?: string; tablet?: string; desktop?: string }) {
  return [classes.base, classes.mobile, classes.tablet, classes.desktop].filter(Boolean).join(' ')
}

/**
 * 条件渲染组件
 */
export function MobileOnly({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile()
  if (!isMobile) return null
  return <>{children}</>
}

export function DesktopOnly({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop()
  if (!isDesktop) return null
  return <>{children}</>
}

export function TabletUp({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile()
  if (isMobile) return null
  return <>{children}</>
}