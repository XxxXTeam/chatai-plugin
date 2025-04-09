import { ChaiteStorage } from 'chaite'
import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'

/**
 * @extends {ChaiteStorage<import('chaite').ToolsGroupDTO>}
 */
export class SQLiteToolsGroupStorage extends ChaiteStorage {
  getName () {
    return 'SQLiteToolsGroupStorage'
  }

  /**
   * @param {string} dbPath 数据库文件路径
   */
  constructor (dbPath) {
    super()
    this.dbPath = dbPath
    this.db = null
    this.initialized = false
    this.tableName = 'tools_groups'
  }

  /**
   * 初始化数据库连接和表结构
   */
  async initialize () {
    if (this.initialized) return

    return new Promise((resolve, reject) => {
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) return reject(err)

        this.db.run(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          tools TEXT NOT NULL,
          createdAt TEXT,
          updatedAt TEXT
        )`, (err) => {
          if (err) return reject(err)

          this.db.run(`CREATE INDEX IF NOT EXISTS idx_tools_groups_name ON ${this.tableName} (name)`, (err) => {
            if (err) return reject(err)
            this.initialized = true
            resolve()
          })
        })
      })
    })
  }

  async ensureInitialized () {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * 获取工具组
   * @param {string} key 工具组ID
   */
  async getItem (key) {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM ${this.tableName} WHERE id = ?`, [key], (err, row) => {
        if (err) return reject(err)

        if (!row) return resolve(null)

        try {
          const toolsGroup = {
            ...row,
            tools: JSON.parse(row.tools)
          }
          resolve(toolsGroup)
        } catch (e) {
          console.error(`解析工具组数据错误: ${key}`, e)
          resolve({
            ...row,
            tools: []
          })
        }
      })
    })
  }

  /**
   * 保存工具组
   * @param {string} id 工具组ID
   * @param {Object} data 工具组数据
   */
  async setItem (id, data) {
    await this.ensureInitialized()

    // 提取工具组数据
    const { name, description, tools } = data
    const updatedAt = Date.now()

    // 将工具列表序列化为JSON字符串
    const toolsJson = JSON.stringify(tools || [])

    return new Promise((resolve, reject) => {
      // 检查工具组是否已存在
      this.db.get(`SELECT id FROM ${this.tableName} WHERE id = ?`, [id], (err, row) => {
        if (err) {
          return reject(err)
        }

        if (row) {
          // 更新现有工具组
          this.db.run(
            `UPDATE ${this.tableName} SET name = ?, description = ?, tools = ?, updatedAt = ? WHERE id = ?`,
            [name, description, toolsJson, updatedAt, id],
            (err) => {
              if (err) {
                return reject(err)
              }
              resolve(id)
            }
          )
        } else {
          // 插入新工具组
          this.db.run(
            `INSERT INTO ${this.tableName} (id, name, description, tools, updatedAt) VALUES (?, ?, ?, ?, ?)`,
            [id, name, description, toolsJson, updatedAt],
            (err) => {
              if (err) {
                return reject(err)
              }
              resolve(id)
            }
          )
        }
      })
    })
  }

  /**
   * 删除工具组
   * @param {string} key 工具组ID
   */
  async removeItem (key) {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [key], function (err) {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }

  /**
   * 获取所有工具组
   */
  async listItems () {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM ${this.tableName}`, (err, rows) => {
        if (err) {
          return reject(err)
        }

        const toolsGroups = rows.map(row => {
          try {
            return {
              ...row,
              tools: JSON.parse(row.tools)
            }
          } catch (e) {
            console.error(`解析工具组数据错误: ${row.id}`, e)
            return {
              ...row,
              tools: []
            }
          }
        })

        resolve(toolsGroups)
      })
    })
  }

  /**
   * 根据条件筛选工具组
   * @param {Record<string, unknown>} filter 筛选条件
   */
  async listItemsByEqFilter (filter) {
    await this.ensureInitialized()

    if (!filter || Object.keys(filter).length === 0) {
      return this.listItems()
    }

    const directFields = ['id', 'name', 'description']
    const conditions = []
    const params = []

    for (const key in filter) {
      if (directFields.includes(key)) {
        conditions.push(`${key} = ?`)
        params.push(filter[key])
      }
    }

    const sql = conditions.length > 0
      ? `SELECT * FROM ${this.tableName} WHERE ${conditions.join(' AND ')}`
      : `SELECT * FROM ${this.tableName}`

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err)

        const toolsGroups = rows.map(row => {
          try {
            const group = {
              ...row,
              tools: JSON.parse(row.tools || '[]')
            }

            // 过滤非直接字段
            for (const key in filter) {
              if (!directFields.includes(key) && group[key] !== filter[key]) {
                return null
              }
            }

            return group
          } catch (e) {
            console.error(`解析工具组数据错误: ${row.id}`, e)
            return null
          }
        }).filter(Boolean)

        resolve(toolsGroups)
      })
    })
  }

  /**
   * 根据IN条件筛选工具组
   * @param {Array<{field: string, values: unknown[]}>} query IN查询条件
   */
  async listItemsByInQuery (query) {
    await this.ensureInitialized()

    if (!query || query.length === 0) {
      return this.listItems()
    }

    const directFields = ['id', 'name', 'description']
    const conditions = []
    const params = []
    const memoryQueries = []

    for (const item of query) {
      if (directFields.includes(item.field) && Array.isArray(item.values) && item.values.length > 0) {
        const placeholders = item.values.map(() => '?').join(',')
        conditions.push(`${item.field} IN (${placeholders})`)
        params.push(...item.values)
      } else if (item.values.length > 0) {
        memoryQueries.push(item)
      }
    }

    const sql = conditions.length > 0
      ? `SELECT * FROM ${this.tableName} WHERE ${conditions.join(' AND ')}`
      : `SELECT * FROM ${this.tableName}`

    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err)

        let toolsGroups = rows.map(row => {
          try {
            return {
              ...row,
              tools: JSON.parse(row.tools || '[]')
            }
          } catch (e) {
            console.error(`解析工具组数据错误: ${row.id}`, e)
            return null
          }
        }).filter(Boolean)

        // 内存中过滤其它字段
        if (memoryQueries.length > 0) {
          toolsGroups = toolsGroups.filter(group => {
            for (const { field, values } of memoryQueries) {
              if (!values.includes(group[field])) {
                return false
              }
            }
            return true
          })
        }

        resolve(toolsGroups)
      })
    })
  }

  /**
   * 清空所有工具组
   */
  async clear () {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM ${this.tableName}`, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * 关闭数据库连接
   */
  async close () {
    if (!this.db) return Promise.resolve()

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
