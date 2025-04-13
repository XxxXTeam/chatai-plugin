import { ChaiteStorage } from 'chaite'
import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'
import { generateId } from '../../../../utils/common.js'

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

        try {
          // 首先检查表是否存在
          const tableExists = await this.checkTableExists()

          if (tableExists) {
            // 如果表存在，检查并迁移旧结构
            await this.migrateTableIfNeeded()
          } else {
            // 如果表不存在，创建新表
            await this.createTable()
          }

          // 确保索引存在
          await this.ensureIndex()

          this.initialized = true
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  /**
   * 检查表是否存在
   */
  async checkTableExists () {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?',
        [this.tableName],
        (err, row) => {
          if (err) return reject(err)
          resolve(!!row)
        }
      )
    })
  }

  /**
   * 创建新表
   */
  async createTable () {
    return new Promise((resolve, reject) => {
      this.db.run(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      toolIds TEXT NOT NULL,
      isDefault INTEGER DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT
    )`, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * 确保索引存在
   */
  async ensureIndex () {
    return new Promise((resolve, reject) => {
      this.db.run(`CREATE INDEX IF NOT EXISTS idx_tools_groups_name ON ${this.tableName} (name)`, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * 检查并迁移表结构
   */
  async migrateTableIfNeeded () {
    // 检查表结构
    const columns = await this.getTableColumns()

    // 检查是否有旧版本的结构（有tools字段而不是toolIds）
    const hasOldStructure = columns.includes('tools') && !columns.includes('toolIds')
    const needsDefaultColumn = !columns.includes('isDefault')

    if (hasOldStructure || needsDefaultColumn) {
      console.log(`检测到旧表结构，开始迁移 ${this.tableName} 表...`)

      // 备份所有数据
      const allData = await this.backupData()

      // 重命名旧表
      await this.renameTable(`${this.tableName}_old`)

      // 创建新表
      await this.createTable()
      await this.ensureIndex()

      // 恢复数据到新表
      if (allData.length > 0) {
        await this.restoreData(allData, hasOldStructure)
      }

      // 删除旧表
      await this.dropTable(`${this.tableName}_old`)

      console.log(`表 ${this.tableName} 迁移完成，共迁移 ${allData.length} 条数据`)
    }
  }

  /**
   * 获取表的所有列名
   */
  async getTableColumns () {
    return new Promise((resolve, reject) => {
      this.db.all(`PRAGMA table_info(${this.tableName})`, (err, rows) => {
        if (err) return reject(err)

        const columns = rows.map(row => row.name)
        resolve(columns)
      })
    })
  }

  /**
   * 备份表数据
   */
  async backupData () {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM ${this.tableName}`, (err, rows) => {
        if (err) return reject(err)
        resolve(rows)
      })
    })
  }

  /**
   * 重命名表
   */
  async renameTable (newName) {
    return new Promise((resolve, reject) => {
      this.db.run(`ALTER TABLE ${this.tableName} RENAME TO ${newName}`, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * 删除表
   */
  async dropTable (tableName) {
    return new Promise((resolve, reject) => {
      this.db.run(`DROP TABLE IF EXISTS ${tableName}`, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * 恢复数据到新表
   */
  async restoreData (data, hasOldStructure) {
    const promises = data.map(row => {
      return new Promise((resolve, reject) => {
        // 处理数据转换
        const newRow = { ...row }

        if (hasOldStructure && row.tools) {
          try {
            // 从旧的tools结构提取toolIds
            const tools = JSON.parse(row.tools)
            newRow.toolIds = JSON.stringify(tools.map(t => t.id || t))
            delete newRow.tools
          } catch (e) {
            console.error(`解析工具组数据错误: ${row.id}`, e)
            newRow.toolIds = JSON.stringify([])
            delete newRow.tools
          }
        }

        // 添加isDefault字段
        if (newRow.isDefault === undefined) {
          newRow.isDefault = 0
        }

        // 添加时间戳
        if (!newRow.createdAt) {
          newRow.createdAt = new Date().toISOString()
        }
        if (!newRow.updatedAt) {
          newRow.updatedAt = new Date().toISOString()
        }

        const fields = Object.keys(newRow)
        const placeholders = fields.map(() => '?').join(',')
        const values = fields.map(field => newRow[field])

        this.db.run(
          `INSERT INTO ${this.tableName} (${fields.join(',')}) VALUES (${placeholders})`,
          values,
          (err) => {
            if (err) return reject(err)
            resolve()
          }
        )
      })
    })

    return Promise.all(promises)
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
            toolIds: JSON.parse(row.toolIds),
            isDefault: Boolean(row.isDefault)
          }
          resolve(toolsGroup)
        } catch (e) {
          console.error(`解析工具组数据错误: ${key}`, e)
          resolve({
            ...row,
            toolIds: [],
            isDefault: Boolean(row.isDefault)
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
    if (!id) {
      id = generateId()
    }

    // 加上时间戳
    if (!data.createdAt) {
      data.createdAt = new Date().toISOString()
    }

    data.updatedAt = new Date().toISOString()
    // 提取工具组数据
    const { name, description, toolIds, isDefault } = data
    const updatedAt = new Date().toISOString()

    // 将工具ID列表序列化为JSON字符串
    const toolIdsJson = JSON.stringify(toolIds || [])
    const isDefaultValue = isDefault ? 1 : 0

    return new Promise((resolve, reject) => {
      // 检查工具组是否已存在
      this.db.get(`SELECT id FROM ${this.tableName} WHERE id = ?`, [id], (err, row) => {
        if (err) {
          return reject(err)
        }

        if (row) {
          // 更新现有工具组
          this.db.run(
            `UPDATE ${this.tableName} SET name = ?, description = ?, toolIds = ?, isDefault = ?, updatedAt = ? WHERE id = ?`,
            [name, description, toolIdsJson, isDefaultValue, updatedAt, id],
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
            `INSERT INTO ${this.tableName} (id, name, description, toolIds, isDefault, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name, description, toolIdsJson, isDefaultValue, data.createdAt, updatedAt],
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
              toolIds: JSON.parse(row.toolIds),
              isDefault: Boolean(row.isDefault)
            }
          } catch (e) {
            console.error(`解析工具组数据错误: ${row.id}`, e)
            return {
              ...row,
              toolIds: [],
              isDefault: Boolean(row.isDefault)
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
      } else if (key === 'isDefault') {
        conditions.push('isDefault = ?')
        params.push(filter[key] ? 1 : 0)
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
              toolIds: JSON.parse(row.toolIds || '[]'),
              isDefault: Boolean(row.isDefault)
            }

            // 过滤其他字段
            for (const key in filter) {
              if (!directFields.includes(key) &&
                key !== 'isDefault' &&
                JSON.stringify(group[key]) !== JSON.stringify(filter[key])) {
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
      } else if (item.field === 'isDefault' && Array.isArray(item.values) && item.values.length > 0) {
        const boolValues = item.values.map(v => v ? 1 : 0)
        const placeholders = boolValues.map(() => '?').join(',')
        conditions.push(`isDefault IN (${placeholders})`)
        params.push(...boolValues)
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
              toolIds: JSON.parse(row.toolIds || '[]'),
              isDefault: Boolean(row.isDefault)
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
              // 对于toolIds字段做特殊处理
              if (field === 'toolIds') {
                const hasMatch = values.some(toolId => group.toolIds.includes(toolId))
                if (!hasMatch) return false
              } else if (!values.includes(group[field])) {
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
