/**
 * 作用域管理器 - 管理用户和群组的独立配置
 * 支持为不同用户和群组设置独立的Prompt和Preset
 * 
 * 支持三层作用域：
 * 1. 用户全局作用域 (user_scopes) - 用户在所有场景的默认设置
 * 2. 群组作用域 (group_scopes) - 特定群组的默认设置
 * 3. 群用户作用域 (group_user_scopes) - 特定群组中特定用户的设置
 * 
 * 优先级：群用户作用域 > 群组作用域 > 用户全局作用域 > 默认预设
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

      this.initialized = true
      logger.info('[ScopeManager] 初始化完成')
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
      
      stmt.run(
        userId,
        systemPrompt || null,
        presetId || null,
        JSON.stringify(otherSettings),
        userId,
        now,
        now
      )
      
      logger.info(`[ScopeManager] 用户配置已更新: ${userId}`)
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
      
      stmt.run(
        groupId,
        systemPrompt || null,
        presetId || null,
        JSON.stringify(otherSettings),
        groupId,
        now,
        now
      )
      
      logger.info(`[ScopeManager] 群组配置已更新: ${groupId}`)
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
      logger.info(`[ScopeManager] 用户配置已删除: ${userId}`)
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
      logger.info(`[ScopeManager] 群组配置已删除: ${groupId}`)
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

  // ==================== 群用户组合作用域方法 ====================

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
      
      stmt.run(
        groupId,
        userId,
        systemPrompt || null,
        presetId || null,
        JSON.stringify(otherSettings),
        groupId,
        userId,
        now,
        now
      )
      
      logger.info(`[ScopeManager] 群用户配置已更新: ${groupId}:${userId}`)
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
      logger.info(`[ScopeManager] 群用户配置已删除: ${groupId}:${userId}`)
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
   * 获取有效的作用域配置（按优先级查找）
   * @param {string|null} groupId 群组ID
   * @param {string} userId 用户ID
   * @returns {Promise<Object>} 有效配置
   */
  async getEffectiveSettings(groupId, userId) {
    await this.init()
    
    let effectivePrompt = null
    let effectivePresetId = null
    let source = 'default'

    // 优先级1: 群用户组合配置
    if (groupId) {
      const groupUserSettings = await this.getGroupUserSettings(groupId, userId)
      if (groupUserSettings) {
        if (groupUserSettings.systemPrompt) {
          effectivePrompt = groupUserSettings.systemPrompt
          source = 'group_user'
        }
        if (groupUserSettings.presetId) {
          effectivePresetId = groupUserSettings.presetId
          source = 'group_user'
        }
      }
    }

    // 优先级2: 群组配置（如果群用户未设置）
    if (groupId && (!effectivePrompt || !effectivePresetId)) {
      const groupSettings = await this.getGroupSettings(groupId)
      if (groupSettings) {
        if (!effectivePrompt && groupSettings.systemPrompt) {
          effectivePrompt = groupSettings.systemPrompt
          if (source === 'default') source = 'group'
        }
        if (!effectivePresetId && groupSettings.presetId) {
          effectivePresetId = groupSettings.presetId
          if (source === 'default') source = 'group'
        }
      }
    }

    // 优先级3: 用户全局配置
    if (!effectivePrompt || !effectivePresetId) {
      const userSettings = await this.getUserSettings(userId)
      if (userSettings) {
        if (!effectivePrompt && userSettings.systemPrompt) {
          effectivePrompt = userSettings.systemPrompt
          if (source === 'default') source = 'user'
        }
        if (!effectivePresetId && userSettings.presetId) {
          effectivePresetId = userSettings.presetId
          if (source === 'default') source = 'user'
        }
      }
    }

    return {
      systemPrompt: effectivePrompt,
      presetId: effectivePresetId,
      source,
      // 标记是否有独立人设（设置了systemPrompt）
      hasIndependentPrompt: !!effectivePrompt
    }
  }

  /**
   * 获取独立人设Prompt（如果设置了自定义人设，则直接使用，不拼接默认人设）
   * @param {string|null} groupId 群组ID
   * @param {string} userId 用户ID
   * @param {string} defaultPrompt 默认Prompt（仅在没有设置独立人设时使用）
   * @returns {Promise<{prompt: string, source: string, isIndependent: boolean}>}
   */
  async getIndependentPrompt(groupId, userId, defaultPrompt = '') {
    await this.init()
    
    const effective = await this.getEffectiveSettings(groupId, userId)
    
    // 如果设置了独立人设，直接使用，不拼接默认
    if (effective.hasIndependentPrompt) {
      return {
        prompt: effective.systemPrompt,
        source: effective.source,
        isIndependent: true
      }
    }
    
    // 没有设置独立人设，使用默认Prompt
    return {
      prompt: defaultPrompt,
      source: 'default',
      isIndependent: false
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
