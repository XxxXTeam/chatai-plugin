import { ChaiteStorage } from 'chaite'
import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'
import crypto from 'node:crypto'

/**
 * 基于SQLite的用户状态存储实现
 * @extends {ChaiteStorage<import('chaite').UserState>}
 */
export class SQLiteUserStateStorage extends ChaiteStorage {
  /**
   * 构造函数
   * @param {string} dbPath 数据库文件路径
   */
  constructor (dbPath) {
    super()
    this.dbPath = dbPath
    this.db = null
    this.initialized = false
    this.tableName = 'user_states'
  }

  /**
   * 初始化数据库��接和表结构
   * @returns {Promise<void>}
   */
  async initialize () {
    if (this.initialized) return

    return new Promise((resolve, reject) => {
      // 确保目录存在
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) {
          return reject(err)
        }

        // 创建用户状态表
        this.db.run(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          nickname TEXT,
          card TEXT,
          conversations TEXT NOT NULL,
          settings TEXT NOT NULL,
          current TEXT NOT NULL,
          updatedAt INTEGER
        )`, (err) => {
          if (err) {
            return reject(err)
          }

          // 创建索引以加快查询
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_${this.tableName}_userId ON ${this.tableName} (userId)`, (err) => {
            if (err) {
              return reject(err)
            }
            this.initialized = true
            resolve()
          })
        })
      })
    })
  }

  /**
   * 确保数据库已初始化
   */
  async ensureInitialized () {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * 获取用户状态
   * @param {string} userId 用户ID
   * @returns {Promise<import('chaite').UserState|null>}
   */
  async getItem (userId) {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM ${this.tableName} WHERE userId = ?`, [userId], (err, row) => {
        if (err) {
          return reject(err)
        }

        if (!row) {
          return resolve(null)
        }

        try {
          const userState = {
            userId: row.userId,
            nickname: row.nickname,
            card: row.card,
            conversations: JSON.parse(row.conversations),
            settings: JSON.parse(row.settings),
            current: JSON.parse(row.current)
          }
          resolve(userState)
        } catch (e) {
          console.error(`解析用户状态数据错误: ${userId}`, e)
          resolve(null)
        }
      })
    })
  }

  /**
   * 保存用户状态
   * @param {string} userId 用户ID
   * @param {import('chaite').UserState} userState 用户状态数据
   * @returns {Promise<string>} 返回用户ID
   */
  async setItem (userId, userState) {
    await this.ensureInitialized()

    // 提取用户状态数据
    const { nickname, card, conversations, settings, current } = userState
    const updatedAt = Date.now()

    // 序列化数据
    const conversationsJson = JSON.stringify(conversations || [])
    const settingsJson = JSON.stringify(settings || {})
    const currentJson = JSON.stringify(current || {})

    return new Promise((resolve, reject) => {
      // 检查用户状态是否已存在
      this.db.get(`SELECT userId FROM ${this.tableName} WHERE userId = ?`, [userId], (err, row) => {
        if (err) {
          return reject(err)
        }

        if (row) {
          // 更新现有用户状态
          this.db.run(
            `UPDATE ${this.tableName} SET 
              nickname = ?, 
              card = ?, 
              conversations = ?, 
              settings = ?, 
              current = ?, 
              updatedAt = ?
            WHERE userId = ?`,
            [nickname, card, conversationsJson, settingsJson, currentJson, updatedAt, userId],
            (err) => {
              if (err) {
                return reject(err)
              }
              resolve(userId)
            }
          )
        } else {
          // 插入新用户状态
          this.db.run(
            `INSERT INTO ${this.tableName} 
              (id, userId, nickname, card, conversations, settings, current, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), userId, nickname, card, conversationsJson, settingsJson, currentJson, updatedAt],
            (err) => {
              if (err) {
                return reject(err)
              }
              resolve(userId)
            }
          )
        }
      })
    })
  }

  /**
   * 删除用户状态
   * @param {string} userId 用户ID
   * @returns {Promise<void>}
   */
  async removeItem (userId) {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM ${this.tableName} WHERE userId = ?`, [userId], (err) => {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }

  /**
   * 获取所有用户状态
   * @returns {Promise<import('chaite').UserState[]>}
   */
  async listItems () {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM ${this.tableName}`, (err, rows) => {
        if (err) {
          return reject(err)
        }

        const userStates = rows.map(row => {
          try {
            return {
              userId: row.userId,
              nickname: row.nickname,
              card: row.card,
              conversations: JSON.parse(row.conversations),
              settings: JSON.parse(row.settings),
              current: JSON.parse(row.current)
            }
          } catch (e) {
            console.error(`解析用户状态数据错误: ${row.userId}`, e)
            return null
          }
        }).filter(Boolean)

        resolve(userStates)
      })
    })
  }

  /**
   * 根据过滤条件查询用户状态
   * @param {Record<string, unknown>} filter 过滤条件
   * @returns {Promise<import('chaite').UserState[]>}
   */
  async listItemsByEqFilter (filter) {
    await this.ensureInitialized()

    // 只支持userId、nickname、card的过滤
    const supportedFilters = ['userId', 'nickname', 'card']
    const conditions = []
    const params = []

    for (const key of supportedFilters) {
      if (filter[key] !== undefined) {
        conditions.push(`${key} = ?`)
        params.push(filter[key])
      }
    }

    if (conditions.length === 0) {
      return this.listItems()
    }

    const whereClause = conditions.join(' AND ')

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM ${this.tableName} WHERE ${whereClause}`, params, (err, rows) => {
        if (err) {
          return reject(err)
        }

        const userStates = rows.map(row => {
          try {
            return {
              userId: row.userId,
              nickname: row.nickname,
              card: row.card,
              conversations: JSON.parse(row.conversations),
              settings: JSON.parse(row.settings),
              current: JSON.parse(row.current)
            }
          } catch (e) {
            console.error(`解析用户状态数据错误: ${row.userId}`, e)
            return null
          }
        }).filter(Boolean)

        resolve(userStates)
      })
    })
  }

  /**
   * 根据IN查询条件查询用户状��
   * @param {Array<{field: string, values: unknown[]}>} query IN查询条件
   * @returns {Promise<import('chaite').UserState[]>}
   */
  async listItemsByInQuery (query) {
    await this.ensureInitialized()

    if (!query || !query.length) {
      return this.listItems()
    }

    // 只支持userId、nickname、card的过滤
    const supportedFields = ['userId', 'nickname', 'card']
    const conditions = []
    const params = []

    for (const item of query) {
      if (supportedFields.includes(item.field) && Array.isArray(item.values) && item.values.length > 0) {
        const placeholders = item.values.map(() => '?').join(',')
        conditions.push(`${item.field} IN (${placeholders})`)
        params.push(...item.values)
      }
    }

    if (conditions.length === 0) {
      return this.listItems()
    }

    const whereClause = conditions.join(' AND ')

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM ${this.tableName} WHERE ${whereClause}`, params, (err, rows) => {
        if (err) {
          return reject(err)
        }

        const userStates = rows.map(row => {
          try {
            return {
              userId: row.userId,
              nickname: row.nickname,
              card: row.card,
              conversations: JSON.parse(row.conversations),
              settings: JSON.parse(row.settings),
              current: JSON.parse(row.current)
            }
          } catch (e) {
            console.error(`解析用户状态数据错误: ${row.userId}`, e)
            return null
          }
        }).filter(Boolean)

        resolve(userStates)
      })
    })
  }

  /**
   * 清空所有用户状态
   * @returns {Promise<void>}
   */
  async clear () {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM ${this.tableName}`, (err) => {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }

  /**
   * 获取存储名称
   * @returns {string}
   */
  getName () {
    return 'SQLiteUserStateStorage'
  }

  /**
   * 关闭数据库连接
   * @returns {Promise<void>}
   */
  async close () {
    if (!this.db) {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      this.db.close(err => {
        if (err) {
          reject(err)
        } else {
          this.initialized = false
          this.db = null
          resolve()
        }
      })
    })
  }
}
