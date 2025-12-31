/**
 * 路由模块共享工具
 */

import { databaseService } from '../storage/DatabaseService.js'

// Response helper
export class ChaiteResponse {
    constructor(code, data, message) {
        this.code = code
        this.data = data
        this.message = message
    }

    static ok(data) {
        return new ChaiteResponse(0, data, 'ok')
    }

    static fail(data, msg) {
        return new ChaiteResponse(-1, data, msg)
    }
}

// 简化版响应助手
export class ApiResponse {
    static ok(data) {
        return { code: 0, data, message: 'ok' }
    }
    static fail(data, msg) {
        return { code: -1, data, message: msg }
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
