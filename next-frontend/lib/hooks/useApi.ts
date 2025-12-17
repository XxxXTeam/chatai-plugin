'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'

// API响应类型
interface ApiResponse<T> {
  code: number
  data: T
  message: string
  meta?: {
    pagination?: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
}

// API错误类型
interface ApiError {
  code: number
  message: string
  errors?: Record<string, string>
}

// 错误码到中文的映射
const errorMessages: Record<number, string> = {
  1001: '参数验证失败',
  1002: '需要登录认证',
  1003: '认证信息无效',
  1004: '认证已过期，请重新登录',
  1005: '权限不足',
  2001: '资源不存在',
  2002: '资源已存在',
  3001: '渠道错误',
  3002: '渠道不可用',
  3003: '渠道配额已用尽',
  4001: '请求频率过高，请稍后再试',
  6001: '外部API调用失败',
}

// Hook配置
interface UseApiOptions<T> {
  // 初始数据
  initialData?: T
  // 是否自动执行
  immediate?: boolean
  // 成功提示
  successMessage?: string
  // 是否显示错误提示
  showError?: boolean
  // 重试次数
  retryCount?: number
  // 重试延迟（毫秒）
  retryDelay?: number
  // 防抖延迟（毫秒）
  debounceMs?: number
  // 依赖项（变化时重新请求）
  deps?: unknown[]
  // 成功回调
  onSuccess?: (data: T) => void
  // 错误回调
  onError?: (error: ApiError) => void
}

/**
 * 通用API请求Hook
 * 支持加载状态、错误处理、重试、防抖等功能
 */
export function useApi<T, P extends unknown[] = []>(
  apiFunc: (...args: P) => Promise<ApiResponse<T>>,
  options: UseApiOptions<T> = {}
) {
  const {
    initialData,
    immediate = false,
    successMessage,
    showError = true,
    retryCount = 0,
    retryDelay = 1000,
    debounceMs = 0,
    deps = [],
    onSuccess,
    onError,
  } = options

  const [data, setData] = useState<T | undefined>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const retriesRef = useRef(0)
  const debounceTimerRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const mountedRef = useRef(true)

  // 解析错误信息
  const parseError = useCallback((err: unknown): ApiError => {
    if (err && typeof err === 'object') {
      const e = err as { response?: { data?: ApiError }; message?: string }
      if (e.response?.data) {
        return e.response.data
      }
      if (e.message) {
        return { code: -1, message: e.message }
      }
    }
    return { code: -1, message: '请求失败' }
  }, [])

  // 获取错误提示文本
  const getErrorMessage = useCallback((err: ApiError): string => {
    return errorMessages[err.code] || err.message || '操作失败'
  }, [])

  // 执行请求
  const execute = useCallback(
    async (...args: P): Promise<T | undefined> => {
      // 清除防抖定时器
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      const doRequest = async (): Promise<T | undefined> => {
        if (!mountedRef.current) return undefined

        setLoading(true)
        setError(null)

        try {
          const response = await apiFunc(...args)
          
          if (!mountedRef.current) return undefined

          // 检查业务错误码
          if (response.code !== 0) {
            throw { response: { data: response } }
          }

          setData(response.data)
          retriesRef.current = 0

          if (successMessage) {
            toast.success(successMessage)
          }

          onSuccess?.(response.data)
          return response.data
        } catch (err) {
          if (!mountedRef.current) return undefined

          const apiError = parseError(err)
          
          // 重试逻辑
          if (retriesRef.current < retryCount) {
            retriesRef.current++
            await new Promise(resolve => setTimeout(resolve, retryDelay * retriesRef.current))
            return doRequest()
          }

          setError(apiError)
          
          if (showError) {
            toast.error(getErrorMessage(apiError))
          }

          onError?.(apiError)
          return undefined
        } finally {
          if (mountedRef.current) {
            setLoading(false)
          }
        }
      }

      // 防抖处理
      if (debounceMs > 0) {
        return new Promise((resolve) => {
          debounceTimerRef.current = setTimeout(async () => {
            const result = await doRequest()
            resolve(result)
          }, debounceMs)
        })
      }

      return doRequest()
    },
    [apiFunc, successMessage, showError, retryCount, retryDelay, debounceMs, parseError, getErrorMessage, onSuccess, onError]
  )

  // 重置状态
  const reset = useCallback(() => {
    setData(initialData)
    setError(null)
    setLoading(false)
    retriesRef.current = 0
  }, [initialData])

  // 立即执行
  useEffect(() => {
    if (immediate) {
      // @ts-expect-error - 立即执行时使用空参数
      execute()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, ...deps])

  // 组件卸载清理
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return {
    data,
    loading,
    error,
    execute,
    reset,
    setData,
  }
}

/**
 * 列表数据Hook（带分页）
 */
export function useList<T>(
  apiFunc: (params?: { page?: number; pageSize?: number }) => Promise<ApiResponse<T[]>>,
  options: UseApiOptions<T[]> & { pageSize?: number } = {}
) {
  const { pageSize = 20, ...restOptions } = options
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const { data, loading, error, execute, reset: baseReset, setData } = useApi(apiFunc, {
    initialData: [],
    ...restOptions,
    onSuccess: (responseData) => {
      // 从meta中获取分页信息（如果有）
      restOptions.onSuccess?.(responseData)
    },
  })

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    const nextPage = page + 1
    const result = await execute({ page: nextPage, pageSize })
    if (result) {
      setData(prev => [...(prev || []), ...result])
      setPage(nextPage)
      setHasMore(result.length >= pageSize)
    }
  }, [loading, hasMore, page, pageSize, execute, setData])

  const refresh = useCallback(async () => {
    setPage(1)
    setHasMore(true)
    return execute({ page: 1, pageSize })
  }, [execute, pageSize])

  const reset = useCallback(() => {
    baseReset()
    setPage(1)
    setTotal(0)
    setHasMore(true)
  }, [baseReset])

  return {
    data: data || [],
    loading,
    error,
    page,
    total,
    hasMore,
    loadMore,
    refresh,
    reset,
  }
}

/**
 * 表单提交Hook
 */
export function useSubmit<T, P extends unknown[] = [unknown]>(
  apiFunc: (...args: P) => Promise<ApiResponse<T>>,
  options: Omit<UseApiOptions<T>, 'immediate'> = {}
) {
  const { successMessage = '保存成功', ...restOptions } = options
  
  return useApi(apiFunc, {
    successMessage,
    ...restOptions,
  })
}

/**
 * 删除操作Hook
 */
export function useDelete<T>(
  apiFunc: (id: string) => Promise<ApiResponse<T>>,
  options: Omit<UseApiOptions<T>, 'immediate'> = {}
) {
  const { successMessage = '删除成功', ...restOptions } = options
  
  return useApi(apiFunc, {
    successMessage,
    ...restOptions,
  })
}

export default useApi
