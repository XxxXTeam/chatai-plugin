/**
 * 统一API响应格式
 * 规范化HTTP状态码和响应结构
 */
export const HttpStatus = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
}
export const ErrorCode = {
    SUCCESS: 0,
    UNKNOWN_ERROR: -1,
    VALIDATION_ERROR: 1001,
    AUTH_REQUIRED: 1002,
    AUTH_INVALID: 1003,
    AUTH_EXPIRED: 1004,
    PERMISSION_DENIED: 1005,
    RESOURCE_NOT_FOUND: 2001,
    RESOURCE_EXISTS: 2002,
    RESOURCE_LOCKED: 2003,
    CHANNEL_ERROR: 3001,
    CHANNEL_UNAVAILABLE: 3002,
    CHANNEL_QUOTA_EXCEEDED: 3003,
    RATE_LIMIT_EXCEEDED: 4001,
    CONFIG_ERROR: 5001,
    EXTERNAL_API_ERROR: 6001
}

// 错误码对应的中文提示
export const ErrorMessages = {
    [ErrorCode.SUCCESS]: '操作成功',
    [ErrorCode.UNKNOWN_ERROR]: '未知错误',
    [ErrorCode.VALIDATION_ERROR]: '参数验证失败',
    [ErrorCode.AUTH_REQUIRED]: '需要登录认证',
    [ErrorCode.AUTH_INVALID]: '认证信息无效',
    [ErrorCode.AUTH_EXPIRED]: '认证已过期',
    [ErrorCode.PERMISSION_DENIED]: '权限不足',
    [ErrorCode.RESOURCE_NOT_FOUND]: '资源不存在',
    [ErrorCode.RESOURCE_EXISTS]: '资源已存在',
    [ErrorCode.RESOURCE_LOCKED]: '资源被锁定',
    [ErrorCode.CHANNEL_ERROR]: '渠道错误',
    [ErrorCode.CHANNEL_UNAVAILABLE]: '渠道不可用',
    [ErrorCode.CHANNEL_QUOTA_EXCEEDED]: '渠道配额已用尽',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求频率过高',
    [ErrorCode.CONFIG_ERROR]: '配置错误',
    [ErrorCode.EXTERNAL_API_ERROR]: '外部API调用失败'
}

export class ApiResponse {
    constructor(code, data, message, meta = null) {
        this.code = code
        this.data = data
        this.message = message
        if (meta) {
            this.meta = meta
        }
    }

    /**
     * 成功响应
     */
    static ok(data, message = '操作成功') {
        return new ApiResponse(ErrorCode.SUCCESS, data, message)
    }

    /**
     * 创建成功响应
     */
    static created(data, message = '创建成功') {
        return new ApiResponse(ErrorCode.SUCCESS, data, message)
    }

    /**
     * 分页数据响应
     */
    static paginated(items, pagination) {
        return new ApiResponse(ErrorCode.SUCCESS, items, '获取成功', {
            pagination: {
                page: pagination.page,
                pageSize: pagination.pageSize,
                total: pagination.total,
                totalPages: Math.ceil(pagination.total / pagination.pageSize)
            }
        })
    }

    /**
     * 错误响应
     */
    static error(code, message, errors = null) {
        const msg = message || ErrorMessages[code] || '操作失败'
        const response = new ApiResponse(code, null, msg)
        if (errors) {
            response.errors = errors
        }
        return response
    }

    /**
     * 参数验证错误
     */
    static validationError(errors, message = '参数验证失败') {
        return ApiResponse.error(ErrorCode.VALIDATION_ERROR, message, errors)
    }

    /**
     * 认证错误
     */
    static unauthorized(message = '需要登录认证') {
        return ApiResponse.error(ErrorCode.AUTH_REQUIRED, message)
    }

    /**
     * 权限错误
     */
    static forbidden(message = '权限不足') {
        return ApiResponse.error(ErrorCode.PERMISSION_DENIED, message)
    }

    /**
     * 资源不存在
     */
    static notFound(resource = '资源') {
        return ApiResponse.error(ErrorCode.RESOURCE_NOT_FOUND, `${resource}不存在`)
    }

    /**
     * 服务器错误
     */
    static serverError(message = '服务器内部错误') {
        return ApiResponse.error(ErrorCode.UNKNOWN_ERROR, message)
    }
}

/**
 * Express响应助手 - 扩展res对象
 */
export function responseHelper(req, res, next) {
    // 成功响应
    res.ok = (data, message) => {
        res.status(HttpStatus.OK).json(ApiResponse.ok(data, message))
    }

    // 创建成功
    res.created = (data, message) => {
        res.status(HttpStatus.CREATED).json(ApiResponse.created(data, message))
    }

    // 分页响应
    res.paginated = (items, pagination) => {
        res.status(HttpStatus.OK).json(ApiResponse.paginated(items, pagination))
    }

    // 参数错误
    res.badRequest = (message, errors) => {
        res.status(HttpStatus.BAD_REQUEST).json(ApiResponse.validationError(errors, message))
    }

    // 未授权
    res.unauthorized = (message) => {
        res.status(HttpStatus.UNAUTHORIZED).json(ApiResponse.unauthorized(message))
    }

    // 禁止访问
    res.forbidden = (message) => {
        res.status(HttpStatus.FORBIDDEN).json(ApiResponse.forbidden(message))
    }

    // 资源不存在
    res.notFound = (resource) => {
        res.status(HttpStatus.NOT_FOUND).json(ApiResponse.notFound(resource))
    }

    // 冲突
    res.conflict = (message) => {
        res.status(HttpStatus.CONFLICT).json(ApiResponse.error(ErrorCode.RESOURCE_EXISTS, message))
    }

    // 请求过多
    res.tooManyRequests = (message) => {
        res.status(HttpStatus.TOO_MANY_REQUESTS).json(ApiResponse.error(ErrorCode.RATE_LIMIT_EXCEEDED, message))
    }

    // 服务器错误
    res.serverError = (message, error) => {
        if (error) {
            logger?.error?.('[API Error]', error)
        }
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(ApiResponse.serverError(message))
    }

    // 自定义错误
    res.fail = (httpStatus, code, message, errors) => {
        res.status(httpStatus).json(ApiResponse.error(code, message, errors))
    }

    next()
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(err, req, res, next) {
    logger?.error?.('[Global Error Handler]', err)

    if (res.headersSent) {
        return next(err)
    }

    // 处理特定类型的错误
    if (err.name === 'ValidationError') {
        return res.status(HttpStatus.BAD_REQUEST).json(
            ApiResponse.validationError(err.details, err.message)
        )
    }

    if (err.name === 'UnauthorizedError' || err.status === 401) {
        return res.status(HttpStatus.UNAUTHORIZED).json(
            ApiResponse.unauthorized(err.message)
        )
    }

    if (err.name === 'ForbiddenError' || err.status === 403) {
        return res.status(HttpStatus.FORBIDDEN).json(
            ApiResponse.forbidden(err.message)
        )
    }

    if (err.name === 'NotFoundError' || err.status === 404) {
        return res.status(HttpStatus.NOT_FOUND).json(
            ApiResponse.notFound()
        )
    }

    // 默认服务器错误
    const isDev = process.env.NODE_ENV === 'development'
    res.status(err.status || HttpStatus.INTERNAL_SERVER_ERROR).json(
        ApiResponse.serverError(isDev ? err.message : '服务器内部错误')
    )
}

/**
 * 请求验证中间件工厂
 */
export function validate(schema) {
    return (req, res, next) => {
        const errors = {}
        
        // 验证body
        if (schema.body) {
            const bodyErrors = validateObject(req.body, schema.body)
            if (Object.keys(bodyErrors).length > 0) {
                errors.body = bodyErrors
            }
        }

        // 验证params
        if (schema.params) {
            const paramsErrors = validateObject(req.params, schema.params)
            if (Object.keys(paramsErrors).length > 0) {
                errors.params = paramsErrors
            }
        }

        // 验证query
        if (schema.query) {
            const queryErrors = validateObject(req.query, schema.query)
            if (Object.keys(queryErrors).length > 0) {
                errors.query = queryErrors
            }
        }

        if (Object.keys(errors).length > 0) {
            return res.badRequest?.('参数验证失败', errors) 
                || res.status(400).json(ApiResponse.validationError(errors))
        }

        next()
    }
}

/**
 * 简单对象验证
 */
function validateObject(obj, schema) {
    const errors = {}
    
    for (const [field, rules] of Object.entries(schema)) {
        const value = obj?.[field]

        // 必填检查
        if (rules.required && (value === undefined || value === null || value === '')) {
            errors[field] = `${rules.label || field} 不能为空`
            continue
        }

        if (value === undefined || value === null) continue

        // 类型检查
        if (rules.type) {
            const actualType = Array.isArray(value) ? 'array' : typeof value
            if (actualType !== rules.type) {
                errors[field] = `${rules.label || field} 类型错误，期望 ${rules.type}`
                continue
            }
        }

        // 最小长度
        if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
            errors[field] = `${rules.label || field} 长度不能小于 ${rules.minLength}`
        }

        // 最大长度
        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
            errors[field] = `${rules.label || field} 长度不能大于 ${rules.maxLength}`
        }

        // 最小值
        if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
            errors[field] = `${rules.label || field} 不能小于 ${rules.min}`
        }

        // 最大值
        if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
            errors[field] = `${rules.label || field} 不能大于 ${rules.max}`
        }

        // 正则验证
        if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
            errors[field] = rules.patternMessage || `${rules.label || field} 格式不正确`
        }

        // 枚举验证
        if (rules.enum && !rules.enum.includes(value)) {
            errors[field] = `${rules.label || field} 只能是 ${rules.enum.join('、')} 之一`
        }

        // 自定义验证
        if (rules.validate && typeof rules.validate === 'function') {
            const result = rules.validate(value, obj)
            if (result !== true) {
                errors[field] = result || `${rules.label || field} 验证失败`
            }
        }
    }

    return errors
}

// 向后兼容的ChaiteResponse
export const ChaiteResponse = {
    ok: (data) => ApiResponse.ok(data),
    fail: (data, msg) => ApiResponse.error(ErrorCode.UNKNOWN_ERROR, msg)
}

export default ApiResponse
