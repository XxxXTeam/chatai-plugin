'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { configApi } from '@/lib/api'
import {
    ChevronRight,
    ChevronLeft,
    X,
    Sparkles,
    CheckCircle2,
    MousePointerClick
} from 'lucide-react'

export interface TourStep {
    target: string // CSS selector for the target element
    title: string
    description: string
    placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
    spotlightPadding?: number
    disableInteraction?: boolean
    onBeforeShow?: () => void
    onAfterShow?: () => void
}

interface OnboardingTourProps {
    steps: TourStep[]
    tourId: string // Unique ID for this tour (used in localStorage)
    onComplete?: () => void
    onSkip?: () => void
    forceShow?: boolean
}

interface SpotlightPosition {
    top: number
    left: number
    width: number
    height: number
}

interface TooltipPosition {
    top: number
    left: number
    placement: 'top' | 'bottom' | 'left' | 'right'
}

const STORAGE_KEY_PREFIX = 'chatai_tour_'
const SESSION_KEY_PREFIX = 'chatai_tour_session_'

// Helper to safely access localStorage (SSR-safe)
function getStorageValue(key: string): string | null {
    if (typeof window === 'undefined') return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

// Helper to safely access sessionStorage (SSR-safe)
function getSessionValue(key: string): string | null {
    if (typeof window === 'undefined') return null
    try {
        return sessionStorage.getItem(key)
    } catch {
        return null
    }
}

// Helper to set sessionStorage value
function setSessionValue(key: string, value: string): void {
    if (typeof window === 'undefined') return
    try {
        sessionStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

export function OnboardingTour({
    steps,
    tourId,
    onComplete,
    onSkip,
    forceShow = false
}: OnboardingTourProps) {
    const [isActive, setIsActive] = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const [spotlightPos, setSpotlightPos] = useState<SpotlightPosition | null>(null)
    const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null)
    const [mounted, setMounted] = useState(false)
    const tooltipRef = useRef<HTMLDivElement>(null)
    const resizeObserverRef = useRef<ResizeObserver | null>(null)
    const initializedRef = useRef(false)

    const storageKey = `${STORAGE_KEY_PREFIX}${tourId}`
    const sessionKey = `${SESSION_KEY_PREFIX}${tourId}`

    // Check if tour should be shown - runs once on mount
    useEffect(() => {
        // Prevent double initialization in StrictMode
        if (initializedRef.current) return
        initializedRef.current = true

        // Defer to next frame to ensure hydration is complete
        const frameId = requestAnimationFrame(() => {
            setMounted(true)
            
            if (forceShow) {
                setIsActive(true)
                return
            }

            // Check session first - if already initialized this session, don't show again
            const sessionInit = getSessionValue(sessionKey)
            if (sessionInit === 'initialized') {
                return
            }

            // Mark session as initialized immediately to prevent duplicate triggers
            setSessionValue(sessionKey, 'initialized')

            // Check tour status from API
            configApi.getTourStatus(tourId)
                .then((res: { data?: { completed?: boolean; skipped?: boolean } }) => {
                    const status = res?.data
                    if (status?.completed || status?.skipped) {
                        // Also sync to localStorage for faster subsequent checks
                        if (typeof window !== 'undefined') {
                            localStorage.setItem(storageKey, status.completed ? 'completed' : 'skipped')
                        }
                        return
                    }
                    // First time user - show tour after a short delay
                    setTimeout(() => {
                        setIsActive(true)
                    }, 300)
                })
                .catch(() => {
                    // API failed, fallback to localStorage
                    const tourStatus = getStorageValue(storageKey)
                    if (tourStatus === 'completed' || tourStatus === 'skipped') {
                        return
                    }
                    // Show tour if no status found
                    setTimeout(() => {
                        setIsActive(true)
                    }, 300)
                })
        })
        
        return () => cancelAnimationFrame(frameId)
    }, [forceShow, storageKey, sessionKey, tourId])

    // Calculate spotlight and tooltip positions
    const updatePositions = useCallback(() => {
        if (!isActive || currentStep >= steps.length) return

        const step = steps[currentStep]
        const targetElement = document.querySelector(step.target)

        if (!targetElement) {
            console.warn(`Tour target not found: ${step.target}`)
            return
        }

        const rect = targetElement.getBoundingClientRect()
        const padding = step.spotlightPadding ?? 8
        const scrollTop = window.scrollY
        const scrollLeft = window.scrollX

        // Update spotlight position
        setSpotlightPos({
            top: rect.top + scrollTop - padding,
            left: rect.left + scrollLeft - padding,
            width: rect.width + padding * 2,
            height: rect.height + padding * 2
        })

        // Calculate tooltip position
        const tooltipWidth = 320
        const tooltipHeight = 180
        const gap = 12
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        let placement = step.placement || 'auto'
        let tooltipTop = 0
        let tooltipLeft = 0

        if (placement === 'auto') {
            // Determine best placement based on available space
            const spaceTop = rect.top
            const spaceBottom = viewportHeight - rect.bottom
            const spaceRight = viewportWidth - rect.right

            if (spaceBottom >= tooltipHeight + gap) {
                placement = 'bottom'
            } else if (spaceTop >= tooltipHeight + gap) {
                placement = 'top'
            } else if (spaceRight >= tooltipWidth + gap) {
                placement = 'right'
            } else {
                placement = 'left'
            }
        }

        switch (placement) {
            case 'top':
                tooltipTop = rect.top + scrollTop - tooltipHeight - gap
                tooltipLeft = rect.left + scrollLeft + rect.width / 2 - tooltipWidth / 2
                break
            case 'bottom':
                tooltipTop = rect.bottom + scrollTop + gap
                tooltipLeft = rect.left + scrollLeft + rect.width / 2 - tooltipWidth / 2
                break
            case 'left':
                tooltipTop = rect.top + scrollTop + rect.height / 2 - tooltipHeight / 2
                tooltipLeft = rect.left + scrollLeft - tooltipWidth - gap
                break
            case 'right':
                tooltipTop = rect.top + scrollTop + rect.height / 2 - tooltipHeight / 2
                tooltipLeft = rect.right + scrollLeft + gap
                break
        }

        // Ensure tooltip stays within viewport
        tooltipLeft = Math.max(16, Math.min(tooltipLeft, viewportWidth - tooltipWidth - 16))
        tooltipTop = Math.max(16 + scrollTop, tooltipTop)

        setTooltipPos({ top: tooltipTop, left: tooltipLeft, placement })

        // Scroll target into view if needed
        const targetTop = rect.top
        const targetBottom = rect.bottom
        if (targetTop < 100 || targetBottom > viewportHeight - 100) {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }, [isActive, currentStep, steps])

    // Update positions on step change and window events
    useEffect(() => {
        if (!isActive) return

        // Use requestAnimationFrame for initial position calculation
        const frameId = requestAnimationFrame(() => updatePositions())

        const handleResize = () => updatePositions()
        const handleScroll = () => updatePositions()

        window.addEventListener('resize', handleResize)
        window.addEventListener('scroll', handleScroll, true)

        // Set up ResizeObserver for target element
        const step = steps[currentStep]
        const targetElement = document.querySelector(step?.target || '')
        if (targetElement) {
            resizeObserverRef.current = new ResizeObserver(updatePositions)
            resizeObserverRef.current.observe(targetElement)
        }

        return () => {
            cancelAnimationFrame(frameId)
            window.removeEventListener('resize', handleResize)
            window.removeEventListener('scroll', handleScroll, true)
            resizeObserverRef.current?.disconnect()
        }
    }, [isActive, currentStep, steps, updatePositions])

    // Call step callbacks
    useEffect(() => {
        if (!isActive || currentStep >= steps.length) return
        const step = steps[currentStep]
        step.onBeforeShow?.()
        const timer = setTimeout(() => step.onAfterShow?.(), 100)
        return () => clearTimeout(timer)
    }, [isActive, currentStep, steps])

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(currentStep + 1)
        } else {
            handleComplete()
        }
    }

    const handlePrev = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1)
        }
    }

    const handleComplete = () => {
        // Save to localStorage immediately for fast local check
        localStorage.setItem(storageKey, 'completed')
        setIsActive(false)
        // Sync to backend API
        configApi.completeTour(tourId).catch(() => {
            // Ignore API errors, localStorage is the fallback
        })
        onComplete?.()
    }

    const handleSkip = () => {
        // Save to localStorage immediately for fast local check
        localStorage.setItem(storageKey, 'skipped')
        setIsActive(false)
        // Sync to backend API
        configApi.skipTour(tourId).catch(() => {
            // Ignore API errors, localStorage is the fallback
        })
        onSkip?.()
    }

    if (!mounted || !isActive || steps.length === 0) return null

    const step = steps[currentStep]
    const progress = ((currentStep + 1) / steps.length) * 100

    // Calculate overlay regions (4 regions around spotlight)
    const pageHeight = typeof document !== 'undefined' ? Math.max(document.documentElement.scrollHeight, window.innerHeight) : '100vh'
    const pageWidth = typeof document !== 'undefined' ? Math.max(document.documentElement.scrollWidth, window.innerWidth) : '100vw'

    return createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-none" aria-modal="true" role="dialog">
            {/* Frosted glass overlay - 4 regions around spotlight */}
            {spotlightPos ? (
                <>
                    {/* Top region */}
                    <div
                        className="absolute left-0 right-0 top-0 bg-background/60 backdrop-blur-md pointer-events-auto"
                        style={{ height: spotlightPos.top }}
                    />
                    {/* Bottom region */}
                    <div
                        className="absolute left-0 right-0 bg-background/60 backdrop-blur-md pointer-events-auto"
                        style={{
                            top: spotlightPos.top + spotlightPos.height,
                            height: `calc(${typeof pageHeight === 'number' ? pageHeight + 'px' : pageHeight} - ${spotlightPos.top + spotlightPos.height}px)`
                        }}
                    />
                    {/* Left region */}
                    <div
                        className="absolute left-0 bg-background/60 backdrop-blur-md pointer-events-auto"
                        style={{
                            top: spotlightPos.top,
                            height: spotlightPos.height,
                            width: spotlightPos.left
                        }}
                    />
                    {/* Right region */}
                    <div
                        className="absolute bg-background/60 backdrop-blur-md pointer-events-auto"
                        style={{
                            top: spotlightPos.top,
                            left: spotlightPos.left + spotlightPos.width,
                            height: spotlightPos.height,
                            width: `calc(${typeof pageWidth === 'number' ? pageWidth + 'px' : pageWidth} - ${spotlightPos.left + spotlightPos.width}px)`
                        }}
                    />
                </>
            ) : (
                /* Full overlay when no spotlight */
                <div className="absolute inset-0 bg-background/60 backdrop-blur-md pointer-events-auto" />
            )}

            {/* Spotlight border glow */}
            {spotlightPos && (
                <div
                    className="absolute rounded-lg ring-2 ring-primary/80 shadow-lg shadow-primary/20 pointer-events-none"
                    style={{
                        top: spotlightPos.top,
                        left: spotlightPos.left,
                        width: spotlightPos.width,
                        height: spotlightPos.height
                    }}
                />
            )}

            {/* Tooltip */}
            {tooltipPos && (
                <div
                    ref={tooltipRef}
                    className="absolute z-10 animate-in fade-in-0 zoom-in-95 duration-200 pointer-events-auto"
                    style={{
                        top: tooltipPos.top,
                        left: tooltipPos.left,
                        width: 320
                    }}
                >
                    <Card className="shadow-2xl border-primary/20 bg-card/95 backdrop-blur-sm">
                        <CardContent className="p-4">
                            {/* Header */}
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-lg bg-primary/10">
                                        <Sparkles className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-sm">{step.title}</h4>
                                        <Badge variant="secondary" className="text-[10px] mt-0.5">
                                            {currentStep + 1} / {steps.length}
                                        </Badge>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 -mr-1 -mt-1"
                                    onClick={handleSkip}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>

                            {/* Progress bar */}
                            <div className="h-1 bg-muted rounded-full mb-3 overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>

                            {/* Description */}
                            <p className="text-sm text-muted-foreground mb-4 leading-relaxed whitespace-pre-line">
                                {step.description}
                            </p>

                            {/* Click hint */}
                            {!step.disableInteraction && (
                                <div className="flex items-center gap-1.5 text-xs text-primary mb-3">
                                    <MousePointerClick className="h-3.5 w-3.5" />
                                    <span>点击高亮区域可进行操作</span>
                                </div>
                            )}

                            {/* Navigation */}
                            <div className="flex items-center justify-between">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleSkip}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    跳过引导
                                </Button>
                                <div className="flex gap-2">
                                    {currentStep > 0 && (
                                        <Button variant="outline" size="sm" onClick={handlePrev}>
                                            <ChevronLeft className="h-4 w-4 mr-1" />
                                            上一步
                                        </Button>
                                    )}
                                    <Button size="sm" onClick={handleNext}>
                                        {currentStep === steps.length - 1 ? (
                                            <>
                                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                                完成
                                            </>
                                        ) : (
                                            <>
                                                下一步
                                                <ChevronRight className="h-4 w-4 ml-1" />
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Arrow pointer */}
                    <div
                        className={cn(
                            'absolute w-3 h-3 bg-card border rotate-45',
                            tooltipPos.placement === 'top' && 'bottom-[-6px] left-1/2 -translate-x-1/2 border-t-0 border-l-0',
                            tooltipPos.placement === 'bottom' && 'top-[-6px] left-1/2 -translate-x-1/2 border-b-0 border-r-0',
                            tooltipPos.placement === 'left' && 'right-[-6px] top-1/2 -translate-y-1/2 border-l-0 border-b-0',
                            tooltipPos.placement === 'right' && 'left-[-6px] top-1/2 -translate-y-1/2 border-r-0 border-t-0'
                        )}
                    />
                </div>
            )}
        </div>,
        document.body
    )
}

// Hook to manage tour state
export function useTour(tourId: string) {
    const [isCompleted, setIsCompleted] = useState(true)
    const initializedRef = useRef(false)

    useEffect(() => {
        if (initializedRef.current) return
        initializedRef.current = true
        
        // Check tour status from API
        configApi.getTourStatus(tourId)
            .then((res: { data?: { completed?: boolean; skipped?: boolean } }) => {
                const status = res?.data
                setIsCompleted(status?.completed || status?.skipped || false)
            })
            .catch(() => {
                // Fallback to localStorage
                const status = getStorageValue(`${STORAGE_KEY_PREFIX}${tourId}`)
                setIsCompleted(status === 'completed' || status === 'skipped')
            })
    }, [tourId])

    const resetTour = useCallback(() => {
        // Clear both localStorage and sessionStorage to allow re-showing
        if (typeof window !== 'undefined') {
            localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tourId}`)
            sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${tourId}`)
        }
        setIsCompleted(false)
        // Sync to backend API
        configApi.resetTour(tourId).catch(() => {
            // Ignore API errors
        })
    }, [tourId])

    const completeTour = useCallback(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`${STORAGE_KEY_PREFIX}${tourId}`, 'completed')
            setSessionValue(`${SESSION_KEY_PREFIX}${tourId}`, 'initialized')
        }
        setIsCompleted(true)
        // Sync to backend API
        configApi.completeTour(tourId).catch(() => {
            // Ignore API errors
        })
    }, [tourId])

    return { isCompleted, resetTour, completeTour }
}

export default OnboardingTour
