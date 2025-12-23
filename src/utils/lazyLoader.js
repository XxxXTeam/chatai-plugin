/**
 * 懒加载服务工具
 * 延迟加载服务直到首次使用，提高启动速度
 */

const serviceCache = new Map()
const loadingPromises = new Map()

/**
 * 创建懒加载服务代理
 * @param {Function} loader - 异步加载函数
 * @param {string} serviceName - 服务名称（用于缓存key）
 * @returns {Proxy} 代理对象
 */
export function createLazyService(loader, serviceName) {
    let instance = null
    let loading = false

    const handler = {
        get(target, prop) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                return undefined
            }
            
            if (!instance) {
                if (serviceCache.has(serviceName)) {
                    instance = serviceCache.get(serviceName)
                }
            }

            if (instance) {
                const value = instance[prop]
                return typeof value === 'function' ? value.bind(instance) : value
            }

            return async (...args) => {
                if (!instance) {
                    if (loadingPromises.has(serviceName)) {
                        instance = await loadingPromises.get(serviceName)
                    } else {
                        const loadPromise = loader()
                        loadingPromises.set(serviceName, loadPromise)
                        instance = await loadPromise
                        serviceCache.set(serviceName, instance)
                        loadingPromises.delete(serviceName)
                    }
                }
                const method = instance[prop]
                if (typeof method === 'function') {
                    return method.apply(instance, args)
                }
                return method
            }
        }
    }

    return new Proxy({}, handler)
}

/**
 * 懒加载模块
 * @param {string} modulePath - 模块路径
 * @param {string} exportName - 导出名称
 * @returns {Promise<any>}
 */
export async function lazyImport(modulePath, exportName = 'default') {
    const cacheKey = `${modulePath}:${exportName}`
    
    if (serviceCache.has(cacheKey)) {
        return serviceCache.get(cacheKey)
    }

    if (loadingPromises.has(cacheKey)) {
        return loadingPromises.get(cacheKey)
    }

    const loadPromise = (async () => {
        const module = await import(modulePath)
        const exported = exportName === 'default' ? module.default : module[exportName]
        serviceCache.set(cacheKey, exported)
        return exported
    })()

    loadingPromises.set(cacheKey, loadPromise)
    
    try {
        const result = await loadPromise
        loadingPromises.delete(cacheKey)
        return result
    } catch (err) {
        loadingPromises.delete(cacheKey)
        throw err
    }
}

/**
 * 预热服务（后台加载）
 * @param {Array<{loader: Function, name: string}>} services 
 */
export function preloadServices(services) {
    setTimeout(() => {
        for (const { loader, name } of services) {
            if (!serviceCache.has(name)) {
                loader().then(instance => {
                    serviceCache.set(name, instance)
                }).catch(() => {})
            }
        }
    }, 100)
}

/**
 * 清除服务缓存
 * @param {string} serviceName - 服务名称，不传则清除所有
 */
export function clearServiceCache(serviceName = null) {
    if (serviceName) {
        serviceCache.delete(serviceName)
    } else {
        serviceCache.clear()
    }
}

/**
 * 获取已缓存的服务列表
 */
export function getCachedServices() {
    return Array.from(serviceCache.keys())
}
