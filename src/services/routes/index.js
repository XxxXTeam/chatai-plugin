/**
 * 路由模块索引
 * 统一导出所有路由创建函数
 */

export { createPresetRoutes, createPresetsConfigRoutes } from './presetRoutes.js'

/**
 * 使用示例：
 * 
 * import { createPresetRoutes, createPresetsConfigRoutes } from './routes/index.js'
 * 
 * // 在 WebServer 的 setupRoutes 中使用：
 * this.app.use('/api/preset', createPresetRoutes(this.authMiddleware.bind(this)))
 * this.app.use('/api/presets', createPresetsConfigRoutes(this.authMiddleware.bind(this)))
 * 
 * 这样可以将原来分散在 webServer.js 中的路由代码模块化，
 * 减少主文件的代码量，提高可维护性。
 */
