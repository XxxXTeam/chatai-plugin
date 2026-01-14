'use client'

import { ReactNode } from 'react'
import {
    breakpoints as bp,
    useResponsive as useResp,
    useMediaQuery as useMQ,
    useIsMobile as useIM,
    useIsTablet as useIT,
    useIsDesktop as useID,
    useIsTouchDevice as useITD,
    useResponsiveValue as useRV,
    useSafeArea as useSA,
    useOrientation as useO,
    useVirtualKeyboard as useVK,
    useScrollLock as useSL,
    useDeviceType as useDT
} from './hooks/useResponsive'
import type { Breakpoint as BP } from './hooks/useResponsive'

// Re-export all hooks
export const breakpoints = bp
export const useResponsive = useResp
export const useMediaQuery = useMQ
export const useIsMobile = useIM
export const useIsTablet = useIT
export const useIsDesktop = useID
export const useIsTouchDevice = useITD
export const useResponsiveValue = useRV
export const useSafeArea = useSA
export const useOrientation = useO
export const useVirtualKeyboard = useVK
export const useScrollLock = useSL
export const useDeviceType = useDT
export type Breakpoint = BP

/**
 * 窗口尺寸Hook
 */
export function useWindowSize() {
    const { width, height } = useResp()
    return { width, height }
}

/**
 * 响应式CSS类名工具
 */
export function responsiveClass(classes: { base?: string; mobile?: string; tablet?: string; desktop?: string }) {
    return [classes.base, classes.mobile, classes.tablet, classes.desktop].filter(Boolean).join(' ')
}

/**
 * 条件渲染组件 - 仅移动端显示
 */
export function MobileOnly({ children }: { children: ReactNode }) {
    const isMobile = useIM()
    if (!isMobile) return null
    return <>{children}</>
}

/**
 * 条件渲染组件 - 仅桌面端显示
 */
export function DesktopOnly({ children }: { children: ReactNode }) {
    const isDesktop = useID()
    if (!isDesktop) return null
    return <>{children}</>
}

/**
 * 条件渲染组件 - 平板及以上显示
 */
export function TabletUp({ children }: { children: ReactNode }) {
    const isMobile = useIM()
    if (isMobile) return null
    return <>{children}</>
}

/**
 * 条件渲染组件 - 仅平板显示
 */
export function TabletOnly({ children }: { children: ReactNode }) {
    const isTablet = useIT()
    if (!isTablet) return null
    return <>{children}</>
}
