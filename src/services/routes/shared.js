/**
 * 路由模块共享工具
 */

import { databaseService } from '../storage/DatabaseService.js'

// 错误码定义
export const ErrorCodes = {
    // 通用错误 (0-999)
    SUCCESS: 0,
    UNKNOWN: -1,
    NETWORK_ERROR: -2,
    TIMEOUT: -3,
    CANCELLED: -4,
    
    // 参数验证错误 (1000-1999)
    VALIDATION_FAILED: 1001,
    AUTH_REQUIRED: 1002,
    AUTH_INVALID: 1003,
    AUTH_EXPIRED: 1004,
    PERMISSION_DENIED: 1005,
    INVALID_FORMAT: 1006,
    MISSING_FIELD: 1007,
    FIELD_TOO_LONG: 1008,
    FIELD_TOO_SHORT: 1009,
    INVALID_VALUE: 1010,
    
    // 资源错误 (2000-2999)
    NOT_FOUND: 2001,
    ALREADY_EXISTS: 2002,
    CONFLICT: 2003,
    LOCKED: 2004,
    DELETED: 2005,
    
    // 渠道错误 (3000-3999)
    CHANNEL_ERROR: 3001,
    CHANNEL_UNAVAILABLE: 3002,
    CHANNEL_QUOTA_EXCEEDED: 3003,
    CHANNEL_RATE_LIMITED: 3004,
    CHANNEL_AUTH_FAILED: 3005,
    MODEL_NOT_FOUND: 3006,
    MODEL_UNAVAILABLE: 3007,
    
    // 限流错误 (4000-4999)
    RATE_LIMITED: 4001,
    QUOTA_EXCEEDED: 4002,
    CONCURRENT_LIMIT: 4003,
    
    // 系统错误 (5000-5999)
    INTERNAL_ERROR: 5001,
    DATABASE_ERROR: 5002,
    CONFIG_ERROR: 5003,
    STORAGE_ERROR: 5004,
    
    // 外部服务错误 (6000-6999)
    EXTERNAL_API_ERROR: 6001,
    EXTERNAL_TIMEOUT: 6002,
    EXTERNAL_UNAVAILABLE: 6003,
    
    // 工具错误 (7000-7999)
    TOOL_EXECUTION_FAILED: 7001,
    TOOL_NOT_FOUND: 7002,
    TOOL_DISABLED: 7003,
    
    // MCP错误 (8000-8999)
    MCP_CONNECTION_FAILED: 8001,
    MCP_SERVER_ERROR: 8002,
    MCP_RESOURCE_NOT_FOUND: 8003,
}

// 错误消息映射
const errorMessages = {
    [ErrorCodes.SUCCESS]: '操作成功',
    [ErrorCodes.UNKNOWN]: '未知错误',
    [ErrorCodes.NETWORK_ERROR]: '网络连接失败',
    [ErrorCodes.VALIDATION_FAILED]: '参数验证失败',
    [ErrorCodes.AUTH_REQUIRED]: '需要登录认证',
    [ErrorCodes.AUTH_INVALID]: '认证信息无效',
    [ErrorCodes.AUTH_EXPIRED]: '登录已过期',
    [ErrorCodes.PERMISSION_DENIED]: '权限不足',
    [ErrorCodes.NOT_FOUND]: '资源不存在',
    [ErrorCodes.ALREADY_EXISTS]: '资源已存在',
    [ErrorCodes.CHANNEL_ERROR]: '渠道请求出错',
    [ErrorCodes.CHANNEL_UNAVAILABLE]: '渠道暂不可用',
    [ErrorCodes.RATE_LIMITED]: '请求频率过高',
    [ErrorCodes.INTERNAL_ERROR]: '系统内部错误',
    [ErrorCodes.EXTERNAL_API_ERROR]: '外部API调用失败',
    [ErrorCodes.TOOL_EXECUTION_FAILED]: '工具执行失败',
    [ErrorCodes.MCP_CONNECTION_FAILED]: 'MCP服务器连接失败',
}

// Response helper
export class ChaiteResponse {
    constructor(code, data, message) {
        this.code = code
        this.data = data
        this.message = message
    }

    static ok(data, message = 'ok') {
        return new ChaiteResponse(0, data, message)
    }

    static fail(data, msg, code = -1) {
        return new ChaiteResponse(code, data, msg)
    }

    static error(code, data = null, customMsg = null) {
        const message = customMsg || errorMessages[code] || '操作失败'
        return new ChaiteResponse(code, data, message)
    }
}

export class ApiResponse {
    static ok(data, message = 'ok') {
        return { code: 0, data, message }
    }
    static fail(data, msg, code = -1) {
        return { code, data, message: msg }
    }
    static error(code, data = null, customMsg = null) {
        const message = customMsg || errorMessages[code] || '操作失败'
        return { code, data, message }
    }
}

/**
 * 获取已初始化的数据库服务
 */
export function getDatabase() {
    if (!databaseService.initialized) {
        databaseService.init()
    }
    return databaseService
}

export default { ChaiteResponse, ApiResponse, getDatabase }
