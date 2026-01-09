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

// 错误码定义
export enum ErrorCode {
  // 通用错误 (0-999)
  SUCCESS = 0,
  UNKNOWN = -1,
  NETWORK_ERROR = -2,
  TIMEOUT = -3,
  CANCELLED = -4,
  
  // 参数验证错误 (1000-1999)
  VALIDATION_FAILED = 1001,
  AUTH_REQUIRED = 1002,
  AUTH_INVALID = 1003,
  AUTH_EXPIRED = 1004,
  PERMISSION_DENIED = 1005,
  INVALID_FORMAT = 1006,
  MISSING_FIELD = 1007,
  FIELD_TOO_LONG = 1008,
  FIELD_TOO_SHORT = 1009,
  INVALID_VALUE = 1010,
  
  // 资源错误 (2000-2999)
  NOT_FOUND = 2001,
  ALREADY_EXISTS = 2002,
  CONFLICT = 2003,
  LOCKED = 2004,
  DELETED = 2005,
  
  // 渠道错误 (3000-3999)
  CHANNEL_ERROR = 3001,
  CHANNEL_UNAVAILABLE = 3002,
  CHANNEL_QUOTA_EXCEEDED = 3003,
  CHANNEL_RATE_LIMITED = 3004,
  CHANNEL_AUTH_FAILED = 3005,
  MODEL_NOT_FOUND = 3006,
  MODEL_UNAVAILABLE = 3007,
  
  // 限流错误 (4000-4999)
  RATE_LIMITED = 4001,
  QUOTA_EXCEEDED = 4002,
  CONCURRENT_LIMIT = 4003,
  
  // 系统错误 (5000-5999)
  INTERNAL_ERROR = 5001,
  DATABASE_ERROR = 5002,
  CONFIG_ERROR = 5003,
  STORAGE_ERROR = 5004,
  
  // 外部服务错误 (6000-6999)
  EXTERNAL_API_ERROR = 6001,
  EXTERNAL_TIMEOUT = 6002,
  EXTERNAL_UNAVAILABLE = 6003,
  
  // 工具错误 (7000-7999)
  TOOL_EXECUTION_FAILED = 7001,
  TOOL_NOT_FOUND = 7002,
  TOOL_DISABLED = 7003,
  
  // MCP错误 (8000-8999)
  MCP_CONNECTION_FAILED = 8001,
  MCP_SERVER_ERROR = 8002,
  MCP_RESOURCE_NOT_FOUND = 8003,
}

// 错误码到中文的映射
const errorMessages: Record<number, string> = {
  // 通用
  [ErrorCode.SUCCESS]: '操作成功',
  [ErrorCode.UNKNOWN]: '未知错误',
  [ErrorCode.NETWORK_ERROR]: '网络连接失败，请检查网络',
  [ErrorCode.TIMEOUT]: '请求超时，请稍后重试',
  [ErrorCode.CANCELLED]: '请求已取消',
  
  // 参数验证
  [ErrorCode.VALIDATION_FAILED]: '参数验证失败，请检查输入',
  [ErrorCode.AUTH_REQUIRED]: '需要登录认证',
  [ErrorCode.AUTH_INVALID]: '认证信息无效',
  [ErrorCode.AUTH_EXPIRED]: '登录已过期，请重新登录',
  [ErrorCode.PERMISSION_DENIED]: '权限不足，无法执行此操作',
  [ErrorCode.INVALID_FORMAT]: '格式不正确',
  [ErrorCode.MISSING_FIELD]: '缺少必填字段',
  [ErrorCode.FIELD_TOO_LONG]: '字段内容过长',
  [ErrorCode.FIELD_TOO_SHORT]: '字段内容过短',
  [ErrorCode.INVALID_VALUE]: '值不在有效范围内',
  
  // 资源
  [ErrorCode.NOT_FOUND]: '资源不存在',
  [ErrorCode.ALREADY_EXISTS]: '资源已存在',
  [ErrorCode.CONFLICT]: '资源冲突，请刷新后重试',
  [ErrorCode.LOCKED]: '资源已锁定',
  [ErrorCode.DELETED]: '资源已删除',
  
  // 渠道
  [ErrorCode.CHANNEL_ERROR]: '渠道请求出错',
  [ErrorCode.CHANNEL_UNAVAILABLE]: '渠道暂不可用',
  [ErrorCode.CHANNEL_QUOTA_EXCEEDED]: '渠道配额已用尽',
  [ErrorCode.CHANNEL_RATE_LIMITED]: '渠道请求过于频繁',
  [ErrorCode.CHANNEL_AUTH_FAILED]: '渠道认证失败，请检查API Key',
  [ErrorCode.MODEL_NOT_FOUND]: '模型不存在',
  [ErrorCode.MODEL_UNAVAILABLE]: '模型暂不可用',
  
  // 限流
  [ErrorCode.RATE_LIMITED]: '请求频率过高，请稍后再试',
  [ErrorCode.QUOTA_EXCEEDED]: '使用配额已用尽',
  [ErrorCode.CONCURRENT_LIMIT]: '并发请求数超限',
  
  // 系统
  [ErrorCode.INTERNAL_ERROR]: '系统内部错误',
  [ErrorCode.DATABASE_ERROR]: '数据库操作失败',
  [ErrorCode.CONFIG_ERROR]: '配置错误',
  [ErrorCode.STORAGE_ERROR]: '存储操作失败',
  
  // 外部服务
  [ErrorCode.EXTERNAL_API_ERROR]: '外部API调用失败',
  [ErrorCode.EXTERNAL_TIMEOUT]: '外部服务响应超时',
  [ErrorCode.EXTERNAL_UNAVAILABLE]: '外部服务暂不可用',
  
  // 工具
  [ErrorCode.TOOL_EXECUTION_FAILED]: '工具执行失败',
  [ErrorCode.TOOL_NOT_FOUND]: '工具不存在',
  [ErrorCode.TOOL_DISABLED]: '工具已禁用',
  
  // MCP
  [ErrorCode.MCP_CONNECTION_FAILED]: 'MCP服务器连接失败',
  [ErrorCode.MCP_SERVER_ERROR]: 'MCP服务器错误',
  [ErrorCode.MCP_RESOURCE_NOT_FOUND]: 'MCP资源不存在',
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
