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
          knowledgeIds TEXT,
          inheritFrom TEXT,
          settings TEXT,
          createdAt INTEGER,
          updatedAt INTEGER
        )
      `)
      try {
        this.db.db.exec(`ALTER TABLE group_scopes ADD COLUMN knowledgeIds TEXT`)
      } catch (e) { /* 列已存在 */ }
      try {
        this.db.db.exec(`ALTER TABLE group_scopes ADD COLUMN inheritFrom TEXT`)
      } catch (e) { /* 列已存在 */ }

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
        knowledgeIds: row.knowledgeIds ? JSON.parse(row.knowledgeIds) : [],
        inheritFrom: row.inheritFrom ? JSON.parse(row.inheritFrom) : [],
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
   * 设置群组配置（自动合并现有配置）
   * @param {string} groupId 群组ID
   * @param {Object} settings 配置
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupSettings(groupId, settings) {
    await this.init()
    
    try {
      const now = Date.now()
      
      // 获取现有配置进行合并
      const existing = await this.getGroupSettings(groupId)
      const existingSettings = existing?.settings || {}
      
      const { systemPrompt, presetId, knowledgeIds, inheritFrom, ...otherSettings } = settings
      let finalOtherSettings = { ...otherSettings }
      if (otherSettings.settings && typeof otherSettings.settings === 'object') {
        const { settings: nestedSettings, ...rest } = otherSettings
        finalOtherSettings = { ...rest, ...nestedSettings }
      }
      
      // 合并现有设置与新设置（新设置优先）
      const mergedSettings = { ...existingSettings, ...finalOtherSettings }
      
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO group_scopes 
        (groupId, systemPrompt, presetId, knowledgeIds, inheritFrom, settings, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT createdAt FROM group_scopes WHERE groupId = ?), ?), ?)
      `)
      
      // 支持空人设：区分 undefined 和 空字符串；保留现有值如果未提供新值
      const finalPrompt = systemPrompt === undefined ? (existing?.systemPrompt ?? null) : systemPrompt
      const finalPresetId = presetId === undefined ? (existing?.presetId ?? null) : (presetId || null)
      const finalKnowledgeIds = knowledgeIds === undefined ? (existing?.knowledgeIds ?? null) : knowledgeIds
      const finalInheritFrom = inheritFrom === undefined ? (existing?.inheritFrom ?? null) : inheritFrom
      
      stmt.run(
        groupId,
        finalPrompt,
        finalPresetId,
        finalKnowledgeIds ? JSON.stringify(finalKnowledgeIds) : null,
        finalInheritFrom ? JSON.stringify(finalInheritFrom) : null,
        JSON.stringify(mergedSettings),
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
    const existingInnerSettings = existingSettings.settings || {}
    return await this.setUserSettings(userId, {
      ...existingInnerSettings,  // 保留模型等配置
      presetId: existingSettings.presetId,  // 保留预设ID
      systemPrompt: prompt  // 仅更新人设
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
   * 设置群组Prompt（仅更新人设，保留其他配置如模型等）
   * @param {string} groupId 群组ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupPrompt(groupId, prompt) {
    const existingSettings = await this.getGroupSettings(groupId) || {}
    // 保留现有的 settings 中的其他配置（如 modelId、功能开关等）
    const existingInnerSettings = existingSettings.settings || {}
    return await this.setGroupSettings(groupId, {
      ...existingInnerSettings,  // 保留模型等配置
      presetId: existingSettings.presetId,  // 保留预设ID
      knowledgeIds: existingSettings.knowledgeIds,  // 保留知识库
      inheritFrom: existingSettings.inheritFrom,  // 保留继承配置
      systemPrompt: prompt  // 仅更新人设
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
        knowledgeIds: row.knowledgeIds ? JSON.parse(row.knowledgeIds) : [],
        inheritFrom: row.inheritFrom ? JSON.parse(row.inheritFrom) : [],
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
   * 设置群用户组合Prompt（仅更新人设，保留其他配置如模型等）
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setGroupUserPrompt(groupId, userId, prompt) {
    const existingSettings = await this.getGroupUserSettings(groupId, userId) || {}
    // 保留现有的 settings 中的其他配置
    const existingInnerSettings = existingSettings.settings || {}
    return await this.setGroupUserSettings(groupId, userId, {
      ...existingInnerSettings,  // 保留模型等配置
      presetId: existingSettings.presetId,  // 保留预设ID
      systemPrompt: prompt  // 仅更新人设
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
   * 设置私聊Prompt（仅更新人设，保留其他配置如模型等）
   * @param {string} userId 用户ID
   * @param {string} prompt Prompt文本
   * @returns {Promise<boolean>} 是否成功
   */
  async setPrivatePrompt(userId, prompt) {
    const existingSettings = await this.getPrivateSettings(userId) || {}
    // 保留现有的 settings 中的其他配置
    const existingInnerSettings = existingSettings.settings || {}
    return await this.setPrivateSettings(userId, {
      ...existingInnerSettings,  // 保留模型等配置
      presetId: existingSettings.presetId,  // 保留预设ID
      systemPrompt: prompt  // 仅更新人设
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
    let effectiveModelId = null
    let effectiveEnabled = null
    let source = 'default'
    let modelSource = 'default'
    
    // 功能开关配置
    let featureConfig = {
      toolsEnabled: undefined,
      imageGenEnabled: undefined,
      imageGenModel: undefined,
      summaryEnabled: undefined,
      summaryModel: undefined,
      triggerMode: undefined,
      // 模型分类配置
      chatModel: undefined,
      toolModel: undefined,
      dispatchModel: undefined,
      imageModel: undefined,
      drawModel: undefined,
      searchModel: undefined,
      roleplayModel: undefined
    }

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
    logger.debug(`[ScopeManager] 查询配置 [${scene}]: groupId=${groupId}, userId=${userId}, 优先级: ${priorityOrder.join(' > ')}`)

    // 按优先级顺序查找
    for (const level of priorityOrder) {
      let settings = null
      let innerSettings = null
      
      switch (level) {
        case 'group_user':
          if (groupId && !isPrivate) {
            settings = settingsCache.group_user
            innerSettings = settings?.settings || {}
          }
          break
        case 'group':
          if (groupId && !isPrivate) {
            settings = settingsCache.group
            innerSettings = settings?.settings || {}
          }
          break
        case 'private':
          if (isPrivate) {
            settings = settingsCache.private
            innerSettings = settings?.settings || {}
          }
          break
        case 'user':
          settings = settingsCache.user
          innerSettings = settings?.settings || {}
          break
        case 'default':
          // default 由外部处理，这里跳过
          continue
      }
      
      if (settings) {
        // 支持空人设：区分"未设置"(null/undefined)和"设置为空"("")
        if (effectivePrompt === null && settings.systemPrompt !== undefined && settings.systemPrompt !== null) {
          effectivePrompt = settings.systemPrompt
          source = level
          logger.debug(`[ScopeManager] 使用 ${level} 的 systemPrompt${settings.systemPrompt === '' ? ' (空人设)' : ''}`)
        }
        
        if (!effectivePresetId && settings.presetId) {
          effectivePresetId = settings.presetId
          if (source === 'default') source = level
        }
        
        // 模型配置：优先从 settings.modelId 或 innerSettings.modelId 获取
        if (!effectiveModelId) {
          const modelId = innerSettings?.modelId || settings?.modelId
          if (modelId && typeof modelId === 'string' && modelId.trim()) {
            effectiveModelId = modelId.trim()
            modelSource = level
            logger.debug(`[ScopeManager] 使用 ${level} 的模型: ${effectiveModelId}`)
          }
        }
        
        // 启用状态
        if (effectiveEnabled === null) {
          const enabled = innerSettings?.enabled ?? settings?.enabled
          if (enabled !== undefined) {
            effectiveEnabled = enabled
          }
        }
        
        // 功能开关配置（仅从群组配置获取）
        if (level === 'group' && innerSettings) {
          if (featureConfig.toolsEnabled === undefined && innerSettings.toolsEnabled !== undefined) {
            featureConfig.toolsEnabled = innerSettings.toolsEnabled
          }
          if (featureConfig.imageGenEnabled === undefined && innerSettings.imageGenEnabled !== undefined) {
            featureConfig.imageGenEnabled = innerSettings.imageGenEnabled
          }
          if (featureConfig.imageGenModel === undefined && innerSettings.imageGenModel) {
            featureConfig.imageGenModel = innerSettings.imageGenModel
          }
          if (featureConfig.summaryEnabled === undefined && innerSettings.summaryEnabled !== undefined) {
            featureConfig.summaryEnabled = innerSettings.summaryEnabled
          }
          if (featureConfig.summaryModel === undefined && innerSettings.summaryModel) {
            featureConfig.summaryModel = innerSettings.summaryModel
          }
          if (featureConfig.triggerMode === undefined && innerSettings.triggerMode) {
            featureConfig.triggerMode = innerSettings.triggerMode
          }
          // 模型分类配置（chatModel优先，兼容旧的modelId）
          if (featureConfig.chatModel === undefined) {
            const chatModel = innerSettings.chatModel || innerSettings.modelId
            if (chatModel) {
              featureConfig.chatModel = chatModel
            }
          }
          if (featureConfig.toolModel === undefined && innerSettings.toolModel) {
            featureConfig.toolModel = innerSettings.toolModel
          }
          if (featureConfig.dispatchModel === undefined && innerSettings.dispatchModel) {
            featureConfig.dispatchModel = innerSettings.dispatchModel
          }
          if (featureConfig.imageModel === undefined && innerSettings.imageModel) {
            featureConfig.imageModel = innerSettings.imageModel
          }
          if (featureConfig.drawModel === undefined && innerSettings.drawModel) {
            featureConfig.drawModel = innerSettings.drawModel
          }
          if (featureConfig.searchModel === undefined && innerSettings.searchModel) {
            featureConfig.searchModel = innerSettings.searchModel
          }
          if (featureConfig.roleplayModel === undefined && innerSettings.roleplayModel) {
            featureConfig.roleplayModel = innerSettings.roleplayModel
          }
        }
      }
    }

    // 空字符串也算有独立人设（用户明确设置为空）
    const hasIndependentPrompt = effectivePrompt !== null && effectivePrompt !== undefined
    
    // 输出最终配置摘要
    logger.debug(`[ScopeManager] 生效配置: 来源=${source}, 模型=${effectiveModelId || '(默认)'} (来源: ${modelSource}), 预设=${effectivePresetId || '(默认)'}, 独立人设=${hasIndependentPrompt}`)

    return {
      systemPrompt: effectivePrompt,
      presetId: effectivePresetId,
      modelId: effectiveModelId,
      enabled: effectiveEnabled,
      source,
      modelSource,
      // 标记是否有独立人设（包括空字符串）
      hasIndependentPrompt,
      // 返回优先级信息
      priorityOrder,
      // 功能配置
      features: featureConfig
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
          knowledgeIds: row.knowledgeIds ? JSON.parse(row.knowledgeIds) : [],
          inheritFrom: row.inheritFrom ? JSON.parse(row.inheritFrom) : [],
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

  /**
   * 设置群组知识库
   * @param {string} groupId 群组ID
   * @param {string[]} knowledgeIds 知识库ID列表
   * @returns {Promise<boolean>}
   */
  async setGroupKnowledge(groupId, knowledgeIds) {
    const settings = await this.getGroupSettings(groupId) || {}
    return await this.setGroupSettings(groupId, {
      ...settings,
      knowledgeIds: Array.isArray(knowledgeIds) ? knowledgeIds : []
    })
  }

  /**
   * 添加群组知识库
   * @param {string} groupId 群组ID
   * @param {string} knowledgeId 知识库ID
   * @returns {Promise<boolean>}
   */
  async addGroupKnowledge(groupId, knowledgeId) {
    const settings = await this.getGroupSettings(groupId) || {}
    const existing = settings.knowledgeIds || []
    if (!existing.includes(knowledgeId)) {
      existing.push(knowledgeId)
    }
    return await this.setGroupSettings(groupId, {
      ...settings,
      knowledgeIds: existing
    })
  }

  /**
   * 移除群组知识库
   * @param {string} groupId 群组ID
   * @param {string} knowledgeId 知识库ID
   * @returns {Promise<boolean>}
   */
  async removeGroupKnowledge(groupId, knowledgeId) {
    const settings = await this.getGroupSettings(groupId) || {}
    const existing = settings.knowledgeIds || []
    const idx = existing.indexOf(knowledgeId)
    if (idx !== -1) {
      existing.splice(idx, 1)
    }
    return await this.setGroupSettings(groupId, {
      ...settings,
      knowledgeIds: existing
    })
  }

  /**
   * 设置群组继承来源
   * 支持继承格式：
   * - 'preset:预设ID' - 继承预设的提示词和知识库
   * - 'group:群号' - 继承其他群的提示词和知识库
   * - 'knowledge:知识库ID' - 直接继承知识库
   * @param {string} groupId 群组ID
   * @param {string[]} inheritFrom 继承来源列表
   * @returns {Promise<boolean>}
   */
  async setGroupInheritance(groupId, inheritFrom) {
    const settings = await this.getGroupSettings(groupId) || {}
    return await this.setGroupSettings(groupId, {
      ...settings,
      inheritFrom: Array.isArray(inheritFrom) ? inheritFrom : []
    })
  }

  /**
   * 添加群组继承来源
   * @param {string} groupId 群组ID
   * @param {string} source 继承来源
   * @returns {Promise<boolean>}
   */
  async addGroupInheritance(groupId, source) {
    const settings = await this.getGroupSettings(groupId) || {}
    const existing = settings.inheritFrom || []
    if (!existing.includes(source)) {
      existing.push(source)
    }
    return await this.setGroupSettings(groupId, {
      ...settings,
      inheritFrom: existing
    })
  }

  /**
   * 移除群组继承来源
   * @param {string} groupId 群组ID
   * @param {string} source 继承来源
   * @returns {Promise<boolean>}
   */
  async removeGroupInheritance(groupId, source) {
    const settings = await this.getGroupSettings(groupId) || {}
    const existing = settings.inheritFrom || []
    const idx = existing.indexOf(source)
    if (idx !== -1) {
      existing.splice(idx, 1)
    }
    return await this.setGroupSettings(groupId, {
      ...settings,
      inheritFrom: existing
    })
  }

  /**
   * 解析群组的完整配置（包含继承）
   * @param {string} groupId 群组ID
   * @param {Object} options 选项
   * @returns {Promise<{systemPrompt: string, knowledgeIds: string[], presetId: string, sources: string[]}>}
   */
  async resolveGroupConfig(groupId, options = {}) {
    const { maxDepth = 5, visited = new Set() } = options
    
    // 防止循环继承
    if (visited.has(`group:${groupId}`)) {
      logger.warn(`[ScopeManager] 检测到循环继承: group:${groupId}`)
      return { systemPrompt: '', knowledgeIds: [], presetId: null, sources: [] }
    }
    visited.add(`group:${groupId}`)
    
    const settings = await this.getGroupSettings(groupId)
    if (!settings) {
      return { systemPrompt: '', knowledgeIds: [], presetId: null, sources: [] }
    }
    
    const result = {
      systemPrompt: settings.systemPrompt || '',
      knowledgeIds: [...(settings.knowledgeIds || [])],
      presetId: settings.presetId || null,
      sources: [`group:${groupId}`]
    }
    
    // 处理继承
    const inheritFrom = settings.inheritFrom || []
    if (inheritFrom.length > 0 && maxDepth > 0) {
      for (const source of inheritFrom) {
        const [type, id] = source.split(':')
        
        if (type === 'preset') {
          // 继承预设
          try {
            const { presetManager } = await import('../preset/PresetManager.js')
            await presetManager.init()
            const preset = presetManager.get(id)
            if (preset) {
              // 合并预设提示词（如果本群没有设置）
              if (!result.systemPrompt && preset.systemPrompt) {
                result.systemPrompt = preset.systemPrompt
              }
              // 获取预设关联的知识库
              const presetKnowledge = presetManager.getPresetKnowledge(id)
              for (const doc of presetKnowledge) {
                if (!result.knowledgeIds.includes(doc.id)) {
                  result.knowledgeIds.push(doc.id)
                }
              }
              result.sources.push(source)
              logger.debug(`[ScopeManager] 群 ${groupId} 继承预设 ${id}`)
            }
          } catch (err) {
            logger.warn(`[ScopeManager] 加载预设 ${id} 失败:`, err.message)
          }
        } else if (type === 'group') {
          // 继承其他群配置（递归）
          const inherited = await this.resolveGroupConfig(id, { maxDepth: maxDepth - 1, visited })
          if (inherited.systemPrompt && !result.systemPrompt) {
            result.systemPrompt = inherited.systemPrompt
          }
          for (const kId of inherited.knowledgeIds) {
            if (!result.knowledgeIds.includes(kId)) {
              result.knowledgeIds.push(kId)
            }
          }
          result.sources.push(...inherited.sources)
        } else if (type === 'knowledge') {
          // 直接继承知识库
          if (!result.knowledgeIds.includes(id)) {
            result.knowledgeIds.push(id)
          }
          result.sources.push(source)
        }
      }
    }
    
    return result
  }

  /**
   * 构建群组的完整系统提示词（包含继承和知识库）
   * @param {string} groupId 群组ID
   * @param {Object} options 选项
   * @returns {Promise<{prompt: string, knowledgePrompt: string, sources: string[]}>}
   */
  async buildGroupPrompt(groupId, options = {}) {
    const { includeKnowledge = true, maxKnowledgeLength = 15000 } = options
    
    const config = await this.resolveGroupConfig(groupId)
    let prompt = config.systemPrompt || ''
    let knowledgePrompt = ''
    
    // 构建知识库提示词
    if (includeKnowledge && config.knowledgeIds.length > 0) {
      try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        
        const parts = []
        parts.push('【群组知识库】')
        parts.push('以下是本群配置的参考信息：')
        parts.push('')
        
        let totalLength = 0
        for (const kId of config.knowledgeIds) {
          const doc = knowledgeService.get(kId)
          if (!doc || !doc.content) continue
          
          let docContent = doc.content
          const maxDocLength = Math.floor((maxKnowledgeLength - 200) / Math.min(config.knowledgeIds.length, 3))
          if (docContent.length > maxDocLength) {
            docContent = docContent.substring(0, maxDocLength) + '\n...(内容已截断)'
          }
          
          const docText = `### 📚 ${doc.name}\n${docContent}`
          if (totalLength + docText.length > maxKnowledgeLength) break
          
          parts.push(docText)
          totalLength += docText.length
        }
        
        if (parts.length > 3) {
          parts.push('')
          parts.push('---')
          knowledgePrompt = parts.join('\n\n')
        }
      } catch (err) {
        logger.warn(`[ScopeManager] 构建群组知识库失败:`, err.message)
      }
    }
    
    return {
      prompt,
      knowledgePrompt,
      presetId: config.presetId,
      knowledgeIds: config.knowledgeIds,
      sources: config.sources
    }
  }

  /**
   * 获取群组的有效配置（用于伪人模式）
   * 整合系统提示词、知识库和继承配置
   * @param {string} groupId 群组ID
   * @param {string} userId 用户ID（可选，用于群用户级别配置）
   * @param {Object} options 选项
   * @returns {Promise<Object>}
   */
  async getEffectiveBymConfig(groupId, userId = null, options = {}) {
    const { defaultPrompt = '', includeKnowledge = true } = options
    
    // 1. 获取群组完整配置（包含继承）
    const groupConfig = await this.buildGroupPrompt(groupId, { includeKnowledge })
    
    // 2. 获取优先级配置
    const effectiveSettings = await this.getEffectiveSettings(groupId, userId, { isPrivate: false })
    
    // 3. 构建最终配置
    let finalPrompt = ''
    let sources = []
    
    // 优先使用用户/群用户级别的独立人设
    if (effectiveSettings.hasIndependentPrompt) {
      finalPrompt = effectiveSettings.systemPrompt
      sources.push(effectiveSettings.source)
    } else if (groupConfig.prompt) {
      // 其次使用群组提示词（包含继承）
      finalPrompt = groupConfig.prompt
      sources = groupConfig.sources
    } else {
      // 最后使用默认提示词
      finalPrompt = defaultPrompt
      sources.push('default')
    }
    
    return {
      systemPrompt: finalPrompt,
      knowledgePrompt: groupConfig.knowledgePrompt,
      knowledgeIds: groupConfig.knowledgeIds,
      presetId: effectiveSettings.presetId || groupConfig.presetId,
      sources,
      hasIndependentPrompt: effectiveSettings.hasIndependentPrompt
    }
  }

  /**
   * 获取群组的功能模型配置
   * @param {string} groupId 群组ID
   * @param {string} feature 功能类型: 'chat' | 'image' | 'summary' | 'tools'
   * @returns {Promise<{model: string|null, enabled: boolean|null, source: string}>}
   */
  async getFeatureModel(groupId, feature) {
    await this.init()
    
    const groupSettings = await this.getGroupSettings(groupId)
    if (!groupSettings) {
      return { model: null, enabled: null, source: 'default' }
    }
    
    const settings = groupSettings.settings || {}
    
    switch (feature) {
      case 'chat':
        return {
          model: settings.modelId || null,
          enabled: settings.enabled,
          source: settings.modelId ? 'group' : 'default'
        }
      case 'image':
        return {
          model: settings.imageGenModel || null,
          enabled: settings.imageGenEnabled,
          source: settings.imageGenModel ? 'group' : 'default'
        }
      case 'summary':
        return {
          model: settings.summaryModel || null,
          enabled: settings.summaryEnabled,
          source: settings.summaryModel ? 'group' : 'default'
        }
      case 'tools':
        return {
          model: null,
          enabled: settings.toolsEnabled,
          source: settings.toolsEnabled !== undefined ? 'group' : 'default'
        }
      default:
        return { model: null, enabled: null, source: 'default' }
    }
  }

  /**
   * 获取群组完整配置摘要（用于日志和调试）
   * @param {string} groupId 群组ID
   * @returns {Promise<Object>}
   */
  async getGroupConfigSummary(groupId) {
    await this.init()
    
    const groupSettings = await this.getGroupSettings(groupId)
    if (!groupSettings) {
      return { exists: false, groupId }
    }
    
    const settings = groupSettings.settings || {}
    
    return {
      exists: true,
      groupId,
      enabled: settings.enabled ?? true,
      presetId: groupSettings.presetId || '(默认)',
      modelId: settings.modelId || '(默认)',
      triggerMode: settings.triggerMode || 'default',
      features: {
        tools: settings.toolsEnabled === undefined ? '继承' : settings.toolsEnabled ? '开启' : '关闭',
        imageGen: settings.imageGenEnabled === undefined ? '继承' : settings.imageGenEnabled ? '开启' : '关闭',
        imageGenModel: settings.imageGenModel || '(默认)',
        summary: settings.summaryEnabled === undefined ? '继承' : settings.summaryEnabled ? '开启' : '关闭',
        summaryModel: settings.summaryModel || '(默认)'
      },
      hasCustomPrompt: !!groupSettings.systemPrompt,
      knowledgeCount: (groupSettings.knowledgeIds || []).length
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
