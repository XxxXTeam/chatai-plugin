'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export interface SSEEvent {
    event: string
    data: Record<string, unknown>
    timestamp: number
}

export interface SSEOptions {
    /** 是否自动重连 */
    autoReconnect?: boolean
    /** 重连延迟（毫秒） */
    reconnectDelay?: number
    /** 最大重连次数 */
    maxReconnectAttempts?: number
    /** 事件处理回调 */
    onEvent?: (event: SSEEvent) => void
    /** 连接成功回调 */
    onConnect?: () => void
    /** 连接关闭回调 */
    onDisconnect?: () => void
    /** 错误回调 */
    onError?: (error: Event) => void
}

export type SSEStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export function useSSE(endpoint: string, options: SSEOptions = {}) {
    const {
        autoReconnect = true,
        reconnectDelay = 3000,
        maxReconnectAttempts = 5,
        onEvent,
        onConnect,
        onDisconnect,
        onError
    } = options

    const [status, setStatus] = useState<SSEStatus>('disconnected')
    const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null)
    const [events, setEvents] = useState<SSEEvent[]>([])
    const [reconnectCount, setReconnectCount] = useState(0)

    const eventSourceRef = useRef<EventSource | null>(null)
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const connect = useCallback(() => {
        if (typeof window === 'undefined') return

        // 清理现有连接
        if (eventSourceRef.current) {
            eventSourceRef.current.close()
        }

        setStatus('connecting')

        const token = localStorage.getItem('chatai_token')
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || ''
        const url = token ? `${baseUrl}${endpoint}?token=${encodeURIComponent(token)}` : `${baseUrl}${endpoint}`

        const eventSource = new EventSource(url, { withCredentials: true })
        eventSourceRef.current = eventSource

        eventSource.onopen = () => {
            setStatus('connected')
            setReconnectCount(0)
            onConnect?.()
        }

        eventSource.onerror = error => {
            setStatus('error')
            onError?.(error)

            // 自动重连逻辑
            if (autoReconnect && reconnectCount < maxReconnectAttempts) {
                setStatus('reconnecting')
                reconnectTimeoutRef.current = setTimeout(
                    () => {
                        setReconnectCount(prev => prev + 1)
                        connect()
                    },
                    reconnectDelay * Math.pow(2, reconnectCount)
                ) // 指数退避
            }
        }

        // 处理通用消息
        eventSource.onmessage = event => {
            try {
                const data = JSON.parse(event.data)
                const sseEvent: SSEEvent = {
                    event: 'message',
                    data,
                    timestamp: Date.now()
                }
                setLastEvent(sseEvent)
                setEvents(prev => [...prev.slice(-99), sseEvent])
                onEvent?.(sseEvent)
            } catch (e) {
                // 忽略解析错误
            }
        }

        // 监听特定事件类型
        const eventTypes = [
            'connected',
            'heartbeat',
            'server-connecting',
            'server-connected',
            'server-reconnecting',
            'server-reconnected',
            'server-removed',
            'server-error',
            'tool-executed',
            'tool-toggled',
            'category-toggled',
            'tools-reloaded',
            'tools-enabled-all',
            'tools-disabled-all'
        ]

        eventTypes.forEach(eventType => {
            eventSource.addEventListener(eventType, event => {
                try {
                    const data = JSON.parse((event as MessageEvent).data)
                    const sseEvent: SSEEvent = {
                        event: eventType,
                        data,
                        timestamp: Date.now()
                    }
                    setLastEvent(sseEvent)
                    setEvents(prev => [...prev.slice(-99), sseEvent])
                    onEvent?.(sseEvent)
                } catch (e) {
                    // 忽略解析错误
                }
            })
        })
    }, [
        endpoint,
        autoReconnect,
        reconnectDelay,
        maxReconnectAttempts,
        reconnectCount,
        onConnect,
        onDisconnect,
        onError,
        onEvent
    ])

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = null
        }

        if (eventSourceRef.current) {
            eventSourceRef.current.close()
            eventSourceRef.current = null
        }

        setStatus('disconnected')
        onDisconnect?.()
    }, [onDisconnect])

    const clearEvents = useCallback(() => {
        setEvents([])
        setLastEvent(null)
    }, [])

    // 自动连接
    useEffect(() => {
        connect()
        return () => disconnect()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint])

    return {
        status,
        lastEvent,
        events,
        reconnectCount,
        connect,
        disconnect,
        clearEvents,
        isConnected: status === 'connected'
    }
}

/**
 * 专门用于 Skills Agent SSE 的钩子
 */
export function useSkillsSSE(options: Omit<SSEOptions, 'endpoint'> = {}) {
    return useSSE('/api/skills/sse', options)
}

export default useSSE
