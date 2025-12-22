import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
/**
 * 作用域管理器 - 管理用户和群组的独立配置
 * 支持为不同用户和群组设置独立的Prompt和Preset
 * 
 * 支持五层作用域：
 * 1. 用户全局作用域 (user_scopes) - 用户在所有场景的默认设置
 * 2. 群组作用域 (group_scopes) - 特定群组的默认设置
 * 3. 群用户作用域 (group_user_scopes) - 特定群组中特定用户的设置
 * 4. 私聊作用域 (private_scopes) - 用户在私聊场景的独立设置
 * 5. 频道作用域 (channel_scopes) - 频道/子频道的设置（预留）
 * 
 * 群聊优先级：群用户 > 群组 > 用户全局 > 默认
 * 私聊优先级：私聊 > 用户全局 > 默认
 */
export class ScopeManager {
  constructor(databaseService) {
    this.db = databaseService
    this.initialized = false
  }

  /**
   * 初始化数据库表
   */
  async init() {
    if (this.initialized) return
    
    try {
      // 创建用户作用域表
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS user_scopes (
          userId TEXT PRIMARY KEY,
          systemPrompt TEXT,
          presetId TEXT,
          settings TEXT,
          createdAt INTEGER,
          updatedAt INTEGER
        )
      `)

      // 创建群组作用域表
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS group_scopes (
          groupId TEXT PRIMARY KEY,
          systemPrompt TEXT,
          presetId TEXT,
          settings TEXT,
          createdAt INTEGER,
          updatedAt INTEGER
        )
      `)

      // 创建群用户组合作用域表（支持群内用户独立人格）
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS group_user_scopes (
          groupId TEXT NOT NULL,
          userId TEXT NOT NULL,
          systemPrompt TEXT,
          presetId TEXT,
          settings TEXT,
          createdAt INTEGER,
          updatedAt INTEGER,
          PRIMARY KEY (groupId, userId)
        )
      `)

      // 创建私聊作用域表（用户在私聊场景的独立设置）
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS private_scopes (
          userId TEXT PRIMARY KEY,
          systemPrompt TEXT,
          presetId TEXT,
          settings TEXT,
          createdAt INTEGER,
          updatedAt INTEGER
        )
      `)

      // 创建频道作用域表（预留，用于QQ频道等场景）
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS channel_scopes (
          channelId TEXT PRIMARY KEY,
          guildId TEXT,
          systemPrompt TEXT,
          presetId TEXT,
          settings TEXT,
          createdAt INTEGER,
          updatedAt INTEGER
        )
      `)

      this.initialized = true
      logger.debug('[ScopeManager] 初始化完成')
    } catch (error) {
      logger.error('[ScopeManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 获取用户配置
   * @param {string} userId 用户ID
   * @returns {Promise<Object|null>} 用户配置
   */
  async getUserSettings(userId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('SELECT * FROM user_scopes WHERE userId = ?')
      const row = stmt.get(userId)
      
      if (!row) return null
      
      return {
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    } catch (error) {
      logger.error(`[ScopeManager] 获取用户配置失败 (${userId}):`, error)
      return null
    }
  }

  /**
   * 设置用户配置
   * @param {string} userId 用户ID
   * @param {Object} settings 配置
   * @returns {Promise<boolean>} 是否成功
   */
  async setUserSettings(userId, settings) {
    await this.init()
    
    try {
      const now = Date.now()
      const { systemPrompt, presetId, ...otherSettings } = settings
      
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO user_scopes 
        (userId, systemPrompt, presetId, settings, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, COALESCE((SELECT createdAt FROM user_scopes WHERE userId = ?), ?), ?)
      `)
      const finalPrompt = systemPrompt === undefined ? null : systemPrompt
      stmt.run(
        userId,
        finalPrompt,
        presetId || null,
        JSON.stringify(otherSettings),
        userId,
        now,
        now
      )
      
      logger.debug(`[ScopeManager] 用户配置已更新: ${userId}${systemPrompt === '' ? ' (空人设)' : ''}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 设置用户配置失败 (${userId}):`, error)
      return false
    }
  }

  /**
   * 获取群组配置
   * @param {string} groupId 群组ID
   * @returns {Promise<Object|null>} 群组配置
   */
  async getGroupSettings(groupId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('SELECT * FROM group_scopes WHERE groupId = ?')
      const row = stmt.get(groupId)
      
      if (!row) return null
      
      return {
        groupId: row.groupId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    } catch (error) {
      logger.error(`[ScopeManager] 获取群组配置失败 (${groupId}):`, error)
      return null
    }
  }

  /**
   * 设置群组配置
   * @param {string} groupId 群组ID
   * @param {Object} settings 配置
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupSettings(groupId, settings) {
    await this.init()
    
    try {
      const now = Date.now()
      const { systemPrompt, presetId, ...otherSettings } = settings
      
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO group_scopes 
        (groupId, systemPrompt, presetId, settings, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, COALESCE((SELECT createdAt FROM group_scopes WHERE groupId = ?), ?), ?)
      `)
      
      // 支持空人设：区分 undefined 和 空字符串
      const finalPrompt = systemPrompt === undefined ? null : systemPrompt
      stmt.run(
        groupId,
        finalPrompt,
        presetId || null,
        JSON.stringify(otherSettings),
        groupId,
        now,
        now
      )
      
      logger.debug(`[ScopeManager] 群组配置已更新: ${groupId}${systemPrompt === '' ? ' (空人设)' : ''}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 设置群组配置失败 (${groupId}):`, error)
      return false
    }
  }

  /**
   * 获取用户自定义Prompt
   * @param {string} userId 用户ID
   * @returns {Promise<string|null>} Prompt文本
   */
  async getUserPrompt(userId) {
    const settings = await this.getUserSettings(userId)
    return settings?.systemPrompt || null
  }

  /**
   * 设置用户Prompt
   * @param {string} userId 用户ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setUserPrompt(userId, prompt) {
    const existingSettings = await this.getUserSettings(userId) || {}
    return await this.setUserSettings(userId, {
      ...existingSettings,
      systemPrompt: prompt
    })
  }

  /**
   * 获取群组自定义Prompt
   * @param {string} groupId 群组ID
   * @returns {Promise<string|null>} Prompt文本
   */
  async getGroupPrompt(groupId) {
    const settings = await this.getGroupSettings(groupId)
    return settings?.systemPrompt || null
  }

  /**
   * 设置群组Prompt
   * @param {string} groupId 群组ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupPrompt(groupId, prompt) {
    const existingSettings = await this.getGroupSettings(groupId) || {}
    return await this.setGroupSettings(groupId, {
      ...existingSettings,
      systemPrompt: prompt
    })
  }

  /**
   * 删除用户配置
   * @param {string} userId 用户ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteUserSettings(userId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('DELETE FROM user_scopes WHERE userId = ?')
      stmt.run(userId)
      logger.debug(`[ScopeManager] 用户配置已删除: ${userId}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 删除用户配置失败 (${userId}):`, error)
      return false
    }
  }

  /**
   * 删除群组配置
   * @param {string} groupId 群组ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteGroupSettings(groupId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('DELETE FROM group_scopes WHERE groupId = ?')
      stmt.run(groupId)
      logger.debug(`[ScopeManager] 群组配置已删除: ${groupId}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 删除群组配置失败 (${groupId}):`, error)
      return false
    }
  }

  /**
   * 获取所有用户配置列表
   * @returns {Promise<Array>} 用户配置列表
   */
  async listUserSettings() {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('SELECT * FROM user_scopes ORDER BY updatedAt DESC')
      const rows = stmt.all()
      
      return rows.map(row => ({
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    } catch (error) {
      logger.error('[ScopeManager] 获取用户配置列表失败:', error)
      return []
    }
  }

  /**
   * 获取所有群组配置列表
   * @returns {Promise<Array>} 群组配置列表
   */
  async listGroupSettings() {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('SELECT * FROM group_scopes ORDER BY updatedAt DESC')
      const rows = stmt.all()
      
      return rows.map(row => ({
        groupId: row.groupId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    } catch (error) {
      logger.error('[ScopeManager] 获取群组配置列表失败:', error)
      return []
    }
  }

  /**
   * 构建合并后的系统Prompt
   * @param {string} basePrompt 基础Prompt
   * @param {string|null} groupId 群组ID（可选）
   * @param {string} userId 用户ID
   * @returns {Promise<string>} 合并后的Prompt
   */
  async buildMergedPrompt(basePrompt, groupId, userId) {
    let mergedPrompt = basePrompt || ''
    const segments = []

    // 1. 添加群组Prompt（如果在群聊中）
    if (groupId) {
      const groupPrompt = await this.getGroupPrompt(groupId)
      if (groupPrompt) {
        segments.push(`[群组设定]\n${groupPrompt}`)
      }

      // 2. 添加群用户组合Prompt（群内用户独立人格）
      const groupUserPrompt = await this.getGroupUserPrompt(groupId, userId)
      if (groupUserPrompt) {
        segments.push(`[群内用户设定]\n${groupUserPrompt}`)
      }
    }

    // 3. 添加用户全局Prompt
    const userPrompt = await this.getUserPrompt(userId)
    if (userPrompt) {
      segments.push(`[用户设定]\n${userPrompt}`)
    }

    if (segments.length > 0) {
      mergedPrompt += '\n\n' + segments.join('\n\n')
    }

    return mergedPrompt
  }
  /**
   * 获取群用户组合配置
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID
   * @returns {Promise<Object|null>} 配置
   */
  async getGroupUserSettings(groupId, userId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare(
        'SELECT * FROM group_user_scopes WHERE groupId = ? AND userId = ?'
      )
      const row = stmt.get(groupId, userId)
      
      if (!row) return null
      
      return {
        groupId: row.groupId,
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    } catch (error) {
      logger.error(`[ScopeManager] 获取群用户配置失败 (${groupId}:${userId}):`, error)
      return null
    }
  }

  /**
   * 设置群用户组合配置
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID
   * @param {Object} settings 配置
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupUserSettings(groupId, userId, settings) {
    await this.init()
    
    try {
      const now = Date.now()
      const { systemPrompt, presetId, ...otherSettings } = settings
      
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO group_user_scopes 
        (groupId, userId, systemPrompt, presetId, settings, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, 
          COALESCE((SELECT createdAt FROM group_user_scopes WHERE groupId = ? AND userId = ?), ?), 
          ?)
      `)
      
      // 支持空人设：区分 undefined 和 空字符串
      const finalPrompt = systemPrompt === undefined ? null : systemPrompt
      stmt.run(
        groupId,
        userId,
        finalPrompt,
        presetId || null,
        JSON.stringify(otherSettings),
        groupId,
        userId,
        now,
        now
      )
      
      logger.debug(`[ScopeManager] 群用户配置已更新: ${groupId}:${userId}${systemPrompt === '' ? ' (空人设)' : ''}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 设置群用户配置失败 (${groupId}:${userId}):`, error)
      return false
    }
  }

  /**
   * 获取群用户组合Prompt
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID
   * @returns {Promise<string|null>} Prompt文本
   */
  async getGroupUserPrompt(groupId, userId) {
    const settings = await this.getGroupUserSettings(groupId, userId)
    return settings?.systemPrompt || null
  }

  /**
   * 设置群用户组合Prompt
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupUserPrompt(groupId, userId, prompt) {
    const existingSettings = await this.getGroupUserSettings(groupId, userId) || {}
    return await this.setGroupUserSettings(groupId, userId, {
      ...existingSettings,
      systemPrompt: prompt
    })
  }

  /**
   * 删除群用户组合配置
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteGroupUserSettings(groupId, userId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare(
        'DELETE FROM group_user_scopes WHERE groupId = ? AND userId = ?'
      )
      stmt.run(groupId, userId)
      logger.debug(`[ScopeManager] 群用户配置已删除: ${groupId}:${userId}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 删除群用户配置失败 (${groupId}:${userId}):`, error)
      return false
    }
  }

  /**
   * 获取群组内所有用户配置
   * @param {string} groupId 群组ID
   * @returns {Promise<Array>} 配置列表
   */
  async listGroupUserSettings(groupId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare(
        'SELECT * FROM group_user_scopes WHERE groupId = ? ORDER BY updatedAt DESC'
      )
      const rows = stmt.all(groupId)
      
      return rows.map(row => ({
        groupId: row.groupId,
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    } catch (error) {
      logger.error(`[ScopeManager] 获取群用户配置列表失败 (${groupId}):`, error)
      return []
    }
  }

  /**
   * 获取所有群用户组合配置
   * @returns {Promise<Array>} 配置列表
   */
  async listAllGroupUserSettings() {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare(
        'SELECT * FROM group_user_scopes ORDER BY updatedAt DESC'
      )
      const rows = stmt.all()
      
      return rows.map(row => ({
        groupId: row.groupId,
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    } catch (error) {
      logger.error('[ScopeManager] 获取所有群用户配置失败:', error)
      return []
    }
  }
 
  /**
   * 获取私聊配置
   * @param {string} userId 用户ID
   * @returns {Promise<Object|null>} 私聊配置
   */
  async getPrivateSettings(userId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('SELECT * FROM private_scopes WHERE userId = ?')
      const row = stmt.get(userId)
      
      if (!row) return null
      
      return {
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    } catch (error) {
      logger.error(`[ScopeManager] 获取私聊配置失败 (${userId}):`, error)
      return null
    }
  }

  /**
   * 设置私聊配置
   * @param {string} userId 用户ID
   * @param {Object} settings 配置
   * @returns {Promise<boolean>} 是否成功
   */
  async setPrivateSettings(userId, settings) {
    await this.init()
    
    try {
      const now = Date.now()
      const { systemPrompt, presetId, ...otherSettings } = settings
      
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO private_scopes 
        (userId, systemPrompt, presetId, settings, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, COALESCE((SELECT createdAt FROM private_scopes WHERE userId = ?), ?), ?)
      `)
      
      // 支持空人设：区分 undefined 和 空字符串
      const finalPrompt = systemPrompt === undefined ? null : systemPrompt
      stmt.run(
        userId,
        finalPrompt,
        presetId || null,
        JSON.stringify(otherSettings),
        userId,
        now,
        now
      )
      
      logger.debug(`[ScopeManager] 私聊配置已更新: ${userId}${systemPrompt === '' ? ' (空人设)' : ''}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 设置私聊配置失败 (${userId}):`, error)
      return false
    }
  }

  /**
   * 删除私聊配置
   * @param {string} userId 用户ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deletePrivateSettings(userId) {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('DELETE FROM private_scopes WHERE userId = ?')
      stmt.run(userId)
      logger.debug(`[ScopeManager] 私聊配置已删除: ${userId}`)
      return true
    } catch (error) {
      logger.error(`[ScopeManager] 删除私聊配置失败 (${userId}):`, error)
      return false
    }
  }

  /**
   * 获取所有私聊配置列表
   * @returns {Promise<Array>} 私聊配置列表
   */
  async listPrivateSettings() {
    await this.init()
    
    try {
      const stmt = this.db.db.prepare('SELECT * FROM private_scopes ORDER BY updatedAt DESC')
      const rows = stmt.all()
      
      return rows.map(row => ({
        userId: row.userId,
        systemPrompt: row.systemPrompt,
        presetId: row.presetId,
        settings: row.settings ? JSON.parse(row.settings) : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
    } catch (error) {
      logger.error('[ScopeManager] 获取私聊配置列表失败:', error)
      return []
    }
  }

  /**
   * 获取私聊Prompt
   * @param {string} userId 用户ID
   * @returns {Promise<string|null>} Prompt文本
   */
  async getPrivatePrompt(userId) {
    const settings = await this.getPrivateSettings(userId)
    return settings?.systemPrompt || null
  }

  /**
   * 设置私聊Prompt
   * @param {string} userId 用户ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setPrivatePrompt(userId, prompt) {
    const existingSettings = await this.getPrivateSettings(userId) || {}
    return await this.setPrivateSettings(userId, {
      ...existingSettings,
      systemPrompt: prompt
    })
  }

  /**
   * 获取有效的作用域配置（按优先级查找）
   * @param {string|null} groupId 群组ID（null 表示私聊）
   * @param {string} userId 用户ID
   * @param {Object} options 选项
   * @param {boolean} options.isPrivate 是否为私聊场景
   * @returns {Promise<Object>} 有效配置
   */
  async getEffectiveSettings(groupId, userId, options = {}) {
    await this.init()
    
    const isPrivate = options.isPrivate || !groupId
    
    // 从配置读取优先级顺序
    const { default: config } = await import('../../../config/config.js')
    // 根据场景选择不同的优先级
    const defaultPriority = isPrivate 
      ? ['private', 'user', 'default']
      : ['group_user', 'group', 'user', 'default']
    const priorityOrder = config.get('personality.priority') || defaultPriority
    
    let effectivePrompt = null
    let effectivePresetId = null
    let source = 'default'

    // 预加载所有可能的配置
    const settingsCache = {}
    if (groupId && !isPrivate) {
      settingsCache.group = await this.getGroupSettings(groupId)
      settingsCache.group_user = await this.getGroupUserSettings(groupId, userId)
    }
    if (isPrivate) {
      settingsCache.private = await this.getPrivateSettings(userId)
    }
    settingsCache.user = await this.getUserSettings(userId)
    
    // 输出调试日志（仅debug级别）
    const scene = isPrivate ? '私聊' : '群聊'
    logger.debug(`[ScopeManager] 查询人格配置 [${scene}]: groupId=${groupId}, userId=${userId}, 优先级: ${priorityOrder.join(' > ')}`)

    // 按优先级顺序查找
    for (const level of priorityOrder) {
      if (effectivePrompt && effectivePresetId) break // 都找到了就停止
      
      let settings = null
      switch (level) {
        case 'group_user':
          if (groupId && !isPrivate) settings = settingsCache.group_user
          break
        case 'group':
          if (groupId && !isPrivate) settings = settingsCache.group
          break
        case 'private':
          if (isPrivate) settings = settingsCache.private
          break
        case 'user':
          settings = settingsCache.user
          break
        case 'default':
          // default 由外部处理，这里跳过
          continue
      }
      
      if (settings) {
        // 支持空人设：区分"未设置"(null/undefined)和"设置为空"("")
        // 当 systemPrompt 是空字符串时，表示用户明确设置了空人设
        if (effectivePrompt === null && settings.systemPrompt !== undefined && settings.systemPrompt !== null) {
          effectivePrompt = settings.systemPrompt  // 可以是空字符串
          source = level
          logger.debug(`[ScopeManager] 使用 ${level} 的 systemPrompt${settings.systemPrompt === '' ? ' (空人设)' : ''}`)
        }
        if (!effectivePresetId && settings.presetId) {
          effectivePresetId = settings.presetId
          if (source === 'default') source = level
        }
      }
    }

    // 空字符串也算有独立人设（用户明确设置为空）
    const hasIndependentPrompt = effectivePrompt !== null && effectivePrompt !== undefined
    logger.debug(`[ScopeManager] 最终生效来源: ${source}, hasPrompt=${hasIndependentPrompt}, isEmpty=${effectivePrompt === ''}`)

    return {
      systemPrompt: effectivePrompt,
      presetId: effectivePresetId,
      source,
      // 标记是否有独立人设（包括空字符串）
      hasIndependentPrompt,
      // 返回优先级信息
      priorityOrder
    }
  }

  /**
   * 获取独立人设Prompt（如果设置了自定义人设，则直接使用，不拼接默认人设）
   * @param {string|null} groupId 群组ID
   * @param {string} userId 用户ID
   * @param {string} defaultPrompt 默认Prompt（仅在没有设置独立人设时使用）
   * @returns {Promise<{prompt: string, source: string, isIndependent: boolean, priorityOrder: string[]}>}
   */
  async getIndependentPrompt(groupId, userId, defaultPrompt = '') {
    await this.init()
    
    const effective = await this.getEffectiveSettings(groupId, userId)
    
    // 如果设置了独立人设，直接使用，不拼接默认
    if (effective.hasIndependentPrompt) {
      return {
        prompt: effective.systemPrompt,
        source: effective.source,
        isIndependent: true,
        priorityOrder: effective.priorityOrder
      }
    }
    
    // 没有设置独立人设，使用默认Prompt
    return {
      prompt: defaultPrompt,
      source: 'default',
      isIndependent: false,
      priorityOrder: effective.priorityOrder
    }
  }

  /**
   * 获取作用域统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    await this.init()
    
    try {
      const userCount = this.db.db.prepare('SELECT COUNT(*) as count FROM user_scopes').get()
      const groupCount = this.db.db.prepare('SELECT COUNT(*) as count FROM group_scopes').get()
      const groupUserCount = this.db.db.prepare('SELECT COUNT(*) as count FROM group_user_scopes').get()
      const privateCount = this.db.db.prepare('SELECT COUNT(*) as count FROM private_scopes').get()
      
      return {
        userScopes: userCount?.count || 0,
        groupScopes: groupCount?.count || 0,
        groupUserScopes: groupUserCount?.count || 0,
        privateScopes: privateCount?.count || 0,
        total: (userCount?.count || 0) + (groupCount?.count || 0) + (groupUserCount?.count || 0) + (privateCount?.count || 0)
      }
    } catch (error) {
      logger.error('[ScopeManager] 获取统计信息失败:', error)
      return { userScopes: 0, groupScopes: 0, groupUserScopes: 0, privateScopes: 0, total: 0 }
    }
  }

  /**
   * 批量删除作用域配置
   * @param {string} type 类型: 'user' | 'group' | 'group_user' | 'private'
   * @param {string[]} ids 要删除的ID列表
   * @returns {Promise<{success: number, failed: number}>}
   */
  async batchDelete(type, ids) {
    await this.init()
    
    let success = 0
    let failed = 0
    
    for (const id of ids) {
      try {
        let result = false
        switch (type) {
          case 'user':
            result = await this.deleteUserSettings(id)
            break
          case 'group':
            result = await this.deleteGroupSettings(id)
            break
          case 'group_user':
            // group_user 格式为 "groupId:userId"
            const [groupId, userId] = id.split(':')
            if (groupId && userId) {
              result = await this.deleteGroupUserSettings(groupId, userId)
            }
            break
          case 'private':
            result = await this.deletePrivateSettings(id)
            break
        }
        if (result) success++
        else failed++
      } catch {
        failed++
      }
    }
    
    return { success, failed }
  }

  /**
   * 复制作用域配置
   * @param {string} type 类型
   * @param {string} sourceId 源ID
   * @param {string} targetId 目标ID
   * @returns {Promise<boolean>}
   */
  async copySettings(type, sourceId, targetId) {
    await this.init()
    
    try {
      let settings = null
      switch (type) {
        case 'user':
          settings = await this.getUserSettings(sourceId)
          if (settings) {
            delete settings.userId
            return await this.setUserSettings(targetId, settings)
          }
          break
        case 'group':
          settings = await this.getGroupSettings(sourceId)
          if (settings) {
            delete settings.groupId
            return await this.setGroupSettings(targetId, settings)
          }
          break
      }
      return false
    } catch (error) {
      logger.error(`[ScopeManager] 复制配置失败:`, error)
      return false
    }
  }

  /**
   * 搜索作用域配置
   * @param {string} keyword 关键词
   * @returns {Promise<Object>} 搜索结果
   */
  async search(keyword) {
    await this.init()
    
    if (!keyword) {
      return { users: [], groups: [], groupUsers: [], privates: [] }
    }
    
    try {
      const searchPattern = `%${keyword}%`
      
      const users = this.db.db.prepare(
        'SELECT * FROM user_scopes WHERE userId LIKE ? OR systemPrompt LIKE ? LIMIT 50'
      ).all(searchPattern, searchPattern)
      
      const groups = this.db.db.prepare(
        'SELECT * FROM group_scopes WHERE groupId LIKE ? OR systemPrompt LIKE ? LIMIT 50'
      ).all(searchPattern, searchPattern)
      
      const groupUsers = this.db.db.prepare(
        'SELECT * FROM group_user_scopes WHERE groupId LIKE ? OR userId LIKE ? OR systemPrompt LIKE ? LIMIT 50'
      ).all(searchPattern, searchPattern, searchPattern)
      
      const privates = this.db.db.prepare(
        'SELECT * FROM private_scopes WHERE userId LIKE ? OR systemPrompt LIKE ? LIMIT 50'
      ).all(searchPattern, searchPattern)
      
      return {
        users: users.map(row => ({
          userId: row.userId,
          systemPrompt: row.systemPrompt,
          presetId: row.presetId,
          updatedAt: row.updatedAt
        })),
        groups: groups.map(row => ({
          groupId: row.groupId,
          systemPrompt: row.systemPrompt,
          presetId: row.presetId,
          updatedAt: row.updatedAt
        })),
        groupUsers: groupUsers.map(row => ({
          groupId: row.groupId,
          userId: row.userId,
          systemPrompt: row.systemPrompt,
          presetId: row.presetId,
          updatedAt: row.updatedAt
        })),
        privates: privates.map(row => ({
          userId: row.userId,
          systemPrompt: row.systemPrompt,
          presetId: row.presetId,
          updatedAt: row.updatedAt
        }))
      }
    } catch (error) {
      logger.error('[ScopeManager] 搜索失败:', error)
      return { users: [], groups: [], groupUsers: [], privates: [] }
    }
  }
}

// 创建单例
let scopeManagerInstance = null

/**
 * 获取 ScopeManager 单例
 * @param {Object} databaseService - 数据库服务实例
 * @returns {ScopeManager}
 */
export function getScopeManager(databaseService) {
  if (!scopeManagerInstance && databaseService) {
    scopeManagerInstance = new ScopeManager(databaseService)
  }
  return scopeManagerInstance
}

/**
 * 导出 scopeManager 实例（延迟初始化）
 * 注意：使用前需要确保 databaseService 已初始化
 */
export { scopeManagerInstance as scopeManager }
