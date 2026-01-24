/**
 * Skills 模块导出
 *
 * 提供 Skills 配置和加载器的统一导出接口
 */

export { skillsConfig, default as SkillsConfig } from './SkillsConfig.js'
export { skillsLoader, default as SkillsLoader } from './SkillsLoader.js'

/**
 * 初始化 Skills 模块
 * @param {string} pluginRoot - 插件根目录
 */
export async function initSkillsModule(pluginRoot) {
    const { skillsConfig } = await import('./SkillsConfig.js')
    const { skillsLoader } = await import('./SkillsLoader.js')

    await skillsConfig.init(pluginRoot)
    await skillsLoader.init(pluginRoot)

    return {
        config: skillsConfig,
        loader: skillsLoader
    }
}
