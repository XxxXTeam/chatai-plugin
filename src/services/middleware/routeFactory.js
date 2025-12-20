import { ApiResponse, HttpStatus, ErrorCode } from './ApiResponse.js'

/**
 * @param {Function} fn - 异步处理函数
 * @returns {Function} Express中间件
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next)
    }
}

/**
 * 创建标准CRUD路由
 * @param {Object} options - 配置选项
 * @param {Object} options.service - 服务实例
 * @param {string} options.resourceName - 资源名称
 * @param {Object} options.validators - 验证器配置
 * @returns {Object} 路由处理函数集合
 */
export function createCrudRoutes(options) {
    const { service, resourceName = '资源', validators = {} } = options

    return {
        /**
         * 获取列表
         */
        list: asyncHandler(async (req, res) => {
            const { page = 1, pageSize = 20, ...filters } = req.query
            
            let result
            if (typeof service.getAll === 'function') {
                result = await service.getAll(filters)
            } else if (typeof service.list === 'function') {
                result = await service.list(filters)
            } else {
                throw new Error(`${resourceName}服务未实现list方法`)
            }

            // 如果是数组，直接返回
            if (Array.isArray(result)) {
                return res.ok?.(result) || res.json(ApiResponse.ok(result))
            }

            // 如果包含分页信息
            if (result.items && result.total !== undefined) {
                return res.paginated?.(result.items, {
                    page: Number(page),
                    pageSize: Number(pageSize),
                    total: result.total
                }) || res.json(ApiResponse.paginated(result.items, {
                    page: Number(page),
                    pageSize: Number(pageSize),
                    total: result.total
                }))
            }

            res.ok?.(result) || res.json(ApiResponse.ok(result))
        }),

        /**
         * 获取单个
         */
        get: asyncHandler(async (req, res) => {
            const { id } = req.params
            
            const result = await service.get(id)
            if (!result) {
                return res.notFound?.(resourceName) || 
                    res.status(HttpStatus.NOT_FOUND).json(ApiResponse.notFound(resourceName))
            }

            res.ok?.(result) || res.json(ApiResponse.ok(result))
        }),

        /**
         * 创建
         */
        create: asyncHandler(async (req, res) => {
            // 验证
            if (validators.create) {
                const errors = validators.create(req.body)
                if (errors && Object.keys(errors).length > 0) {
                    return res.badRequest?.('参数验证失败', errors) ||
                        res.status(HttpStatus.BAD_REQUEST).json(ApiResponse.validationError(errors))
                }
            }

            const result = await service.create(req.body)
            res.created?.(result, `${resourceName}创建成功`) || 
                res.status(HttpStatus.CREATED).json(ApiResponse.created(result, `${resourceName}创建成功`))
        }),

        /**
         * 更新
         */
        update: asyncHandler(async (req, res) => {
            const { id } = req.params

            // 检查资源是否存在
            const existing = await service.get(id)
            if (!existing) {
                return res.notFound?.(resourceName) ||
                    res.status(HttpStatus.NOT_FOUND).json(ApiResponse.notFound(resourceName))
            }

            // 验证
            if (validators.update) {
                const errors = validators.update(req.body)
                if (errors && Object.keys(errors).length > 0) {
                    return res.badRequest?.('参数验证失败', errors) ||
                        res.status(HttpStatus.BAD_REQUEST).json(ApiResponse.validationError(errors))
                }
            }

            const result = await service.update(id, req.body)
            res.ok?.(result, `${resourceName}更新成功`) || res.json(ApiResponse.ok(result, `${resourceName}更新成功`))
        }),

        /**
         * 删除
         */
        delete: asyncHandler(async (req, res) => {
            const { id } = req.params

            // 检查资源是否存在
            const existing = await service.get(id)
            if (!existing) {
                return res.notFound?.(resourceName) ||
                    res.status(HttpStatus.NOT_FOUND).json(ApiResponse.notFound(resourceName))
            }

            await service.delete(id)
            res.ok?.(null, `${resourceName}删除成功`) || res.json(ApiResponse.ok(null, `${resourceName}删除成功`))
        }),

        /**
         * 批量删除
         */
        batchDelete: asyncHandler(async (req, res) => {
            const { ids } = req.body
            
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.badRequest?.('请提供要删除的ID列表') ||
                    res.status(HttpStatus.BAD_REQUEST).json(
                        ApiResponse.validationError({ ids: '请提供要删除的ID列表' })
                    )
            }

            let deleted = 0
            for (const id of ids) {
                try {
                    await service.delete(id)
                    deleted++
                } catch (e) {
                    // 忽略单个删除失败
                }
            }

            res.ok?.({ deleted, total: ids.length }, `成功删除 ${deleted} 个${resourceName}`) ||
                res.json(ApiResponse.ok({ deleted, total: ids.length }, `成功删除 ${deleted} 个${resourceName}`))
        })
    }
}

/**
 * @param {Object} options - 配置选项
 * @param {Function} options.getter - 获取配置函数
 * @param {Function} options.setter - 设置配置函数
 * @param {string} options.configName - 配置名称
 * @param {Function} options.validator - 验证函数
 * @returns {Object} 路由处理函数集合
 */
export function createConfigRoutes(options) {
    const { getter, setter, configName = '配置', validator } = options

    return {
        get: asyncHandler(async (req, res) => {
            const config = await getter()
            res.ok?.(config) || res.json(ApiResponse.ok(config))
        }),

        set: asyncHandler(async (req, res) => {
            if (validator) {
                const errors = validator(req.body)
                if (errors && Object.keys(errors).length > 0) {
                    return res.badRequest?.('参数验证失败', errors) ||
                        res.status(HttpStatus.BAD_REQUEST).json(ApiResponse.validationError(errors))
                }
            }

            await setter(req.body)
            res.ok?.(req.body, `${configName}保存成功`) || res.json(ApiResponse.ok(req.body, `${configName}保存成功`))
        })
    }
}

/**
 * @param {Object} router - Express Router实例
 * @param {string} basePath - 基础路径
 * @param {Object} routes - createCrudRoutes返回的路由处理函数
 * @param {Object} options - 配置选项
 * @param {Function} options.authMiddleware - 认证中间件
 * @param {Object} options.customRoutes - 自定义路由
 */
export function registerCrudRoutes(router, basePath, routes, options = {}) {
    const { authMiddleware, customRoutes = {} } = options
    const auth = authMiddleware ? [authMiddleware] : []

    // 标准CRUD路由
    router.get(`${basePath}`, ...auth, routes.list)
    router.get(`${basePath}/:id`, ...auth, routes.get)
    router.post(`${basePath}`, ...auth, routes.create)
    router.put(`${basePath}/:id`, ...auth, routes.update)
    router.delete(`${basePath}/:id`, ...auth, routes.delete)

    // 批量删除
    if (routes.batchDelete) {
        router.post(`${basePath}/batch-delete`, ...auth, routes.batchDelete)
    }

    // 自定义路由
    Object.entries(customRoutes).forEach(([path, handler]) => {
        if (typeof handler === 'function') {
            // 默认为POST
            router.post(`${basePath}${path}`, ...auth, asyncHandler(handler))
        } else if (handler.method && handler.handler) {
            const method = handler.method.toLowerCase()
            router[method](`${basePath}${path}`, ...auth, asyncHandler(handler.handler))
        }
    })
}

export default {
    asyncHandler,
    createCrudRoutes,
    createConfigRoutes,
    registerCrudRoutes
}
