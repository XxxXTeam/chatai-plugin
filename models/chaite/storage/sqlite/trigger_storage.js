import { ChaiteStorage, TriggerDTO } from 'chaite'
import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'
import { generateId } from '../../../../utils/common.js'

/**
 * @extends {ChaiteStorage<import('chaite').TriggerDTO>}
 */
export class SQLiteTriggerStorage extends ChaiteStorage {
  getName () {
    return 'SQLiteTriggerStorage'
  }

  /**
   *
   * @param {string} dbPath 数据库文件路径
   */
  constructor (dbPath) {
    super()
    this.dbPath = dbPath
    this.db = null
    this.initialized = false
    this.tableName = 'triggers'
  }

  /**
   * 初始化数据库连接和表结构
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

        // 创建触发器表，将主要属性分列存储
        this.db.run(`CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          modelType TEXT,
          code TEXT,
          cloudId INTEGER,
          embedded INTEGER,
          uploader TEXT,
          createdAt TEXT,
          updatedAt TEXT,
          md5 TEXT,
          status TEXT,
          permission TEXT,
          isOneTime INTEGER,
          extraData TEXT  -- 存储其他额外数据的JSON
        )`, (err) => {
          if (err) {
            reject(err)
          } else {
            // 创建索引以提高查询性能
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_triggers_name ON ${this.tableName} (name)`, (err) => {
              if (err) {
                reject(err)
              } else {
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_triggers_status ON ${this.tableName} (status)`, (err) => {
                  if (err) {
                    reject(err)
                  } else {
                    this.initialized = true
                    resolve()
                  }
                })
              }
            })
          }
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
   * 将 TriggerDTO 对象转换为数据库记录
   * @param {import('chaite').TriggerDTO} trigger
   * @returns {Object} 数据库记录
   */
  _triggerToRecord (trigger) {
    // 提取主要字段，剩余的放入extraData
    const {
      id, name, description, modelType, code, cloudId,
      embedded, uploader, createdAt, updatedAt, md5,
      status, permission, isOneTime, ...rest
    } = trigger

    // 序列化上传者对象
    const uploaderStr = uploader ? JSON.stringify(uploader) : null

    return {
      id: id || '',
      name: name || '',
      description: description || '',
      modelType: modelType || 'executable',
      code: code || null,
      cloudId: cloudId || null,
      embedded: embedded ? 1 : 0,
      uploader: uploaderStr,
      createdAt: createdAt || '',
      updatedAt: updatedAt || '',
      md5: md5 || '',
      status: status || 'enabled',
      permission: permission || 'public',
      isOneTime: isOneTime ? 1 : 0,
      extraData: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null
    }
  }

  /**
   * 将数据库记录转换为 TriggerDTO 对象
   * @param {Object} record 数据库记录
   * @returns {import('chaite').TriggerDTO} TriggerDTO对象
   */
  _recordToTrigger (record) {
    // 若记录不存在则返回null
    if (!record) return null

    // 解析上传者
    let uploader = null
    try {
      if (record.uploader) {
        uploader = JSON.parse(record.uploader)
      }
    } catch (e) {
      // 解析错误，使用null
    }

    // 解析额外数据
    let extraData = {}
    try {
      if (record.extraData) {
        extraData = JSON.parse(record.extraData)
      }
    } catch (e) {
      // 解析错误，使用空对象
    }

    // 构造基本对象
    const triggerData = {
      id: record.id,
      name: record.name,
      description: record.description,
      modelType: record.modelType,
      code: record.code,
      cloudId: record.cloudId,
      embedded: Boolean(record.embedded),
      uploader,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      md5: record.md5,
      status: record.status,
      permission: record.permission,
      isOneTime: Boolean(record.isOneTime),
      ...extraData
    }

    return new TriggerDTO(triggerData)
  }

  /**
   * 获取单个触发器
   * @param {string} key 触发器ID
   * @returns {Promise<import('chaite').TriggerDTO>}
   */
  async getItem (key) {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM ${this.tableName} WHERE id = ?`, [key], (err, row) => {
        if (err) {
          return reject(err)
        }

        const trigger = this._recordToTrigger(row)
        resolve(trigger)
      })
    })
  }

  /**
   * 保存触发器
   * @param {string} id 触发器ID
   * @param {import('chaite').TriggerDTO} trigger 触发器对象
   * @returns {Promise<string>}
   */
  async setItem (id, trigger) {
    await this.ensureInitialized()

    if (!id) {
      id = generateId()
    }

    // 加上时间戳
    if (!trigger.createdAt) {
      trigger.createdAt = new Date().toISOString()
    }

    trigger.updatedAt = new Date().toISOString()

    // 转换为数据库记录
    const record = this._triggerToRecord(trigger)
    record.id = id // 确保ID是指定的ID

    // 构建插入或更新SQL
    const fields = Object.keys(record)
    const placeholders = fields.map(() => '?').join(', ')
    const updates = fields.map(field => `${field} = ?`).join(', ')
    const values = fields.map(field => record[field])
    const duplicateValues = [...values] // 用于ON CONFLICT时的更新

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO ${this.tableName} (${fields.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updates}`,
        [...values, ...duplicateValues],
        function (err) {
          if (err) {
            return reject(err)
          }
          resolve(id)
        }
      )
    })
  }

  /**
   * 删除触发器
   * @param {string} key 触发器ID
   * @returns {Promise<void>}
   */
  async removeItem (key) {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [key], (err) => {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })
  }

  /**
   * 查询所有触发器
   * @returns {Promise<import('chaite').TriggerDTO[]>}
   */
  async listItems () {
    await this.ensureInitialized()

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM ${this.tableName}`, (err, rows) => {
        if (err) {
          return reject(err)
        }

        const triggers = rows.map(row => this._recordToTrigger(row)).filter(Boolean)
        resolve(triggers)
      })
    })
  }

  /**
   * 根据条件筛选触发器
   * @param {Record<string, unknown>} filter 筛选条件
   * @returns {Promise<import('chaite').TriggerDTO[]>}
   */
  async listItemsByEqFilter (filter) {
    await this.ensureInitialized()

    // 如果没有筛选条件，返回所有
    if (!filter || Object.keys(filter).length === 0) {
      return this.listItems()
    }

    // 尝试使用SQL字段直接过滤
    const directFields = ['id', 'name', 'description', 'modelType', 'cloudId', 'status', 'permission']
    const sqlFilters = []
    const sqlParams = []
    const extraFilters = {}
    let hasExtraFilters = false

    // 区分数据库字段和额外字段
    for (const key in filter) {
      const value = filter[key]

      // 如果是直接支持的字段，构建SQL条件
      if (directFields.includes(key)) {
        sqlFilters.push(`${key} = ?`)
        sqlParams.push(value)
      } else if (key === 'embedded') {
        // embedded 字段需要特殊处理为 0/1
        sqlFilters.push('embedded = ?')
        sqlParams.push(value ? 1 : 0)
      } else if (key === 'isOneTime') {
        // isOneTime 字段需要特殊处理为 0/1
        sqlFilters.push('isOneTime = ?')
        sqlParams.push(value ? 1 : 0)
      } else {
        // 其他字段需要在结果中进一步过滤
        extraFilters[key] = value
        hasExtraFilters = true
      }
    }

    // 构建SQL查询
    let sql = `SELECT * FROM ${this.tableName}`
    if (sqlFilters.length > 0) {
      sql += ` WHERE ${sqlFilters.join(' AND ')}`
    }

    return new Promise((resolve, reject) => {
      this.db.all(sql, sqlParams, (err, rows) => {
        if (err) {
          return reject(err)
        }

        let triggers = rows.map(row => this._recordToTrigger(row)).filter(Boolean)

        // 如果有需要在内存中过滤的额外字段
        if (hasExtraFilters) {
          triggers = triggers.filter(trigger => {
            for (const key in extraFilters) {
              if (trigger[key] !== extraFilters[key]) {
                return false
              }
            }
            return true
          })
        }

        resolve(triggers)
      })
    })
  }

  /**
   * 根据IN条件筛选触发器
   * @param {Array<{ field: string; values: unknown[]; }>} query
   * @returns {Promise<import('chaite').TriggerDTO[]>}
   */
  async listItemsByInQuery (query) {
    await this.ensureInitialized()

    // 如果没有查询条���，返回所有
    if (!query || query.length === 0) {
      return this.listItems()
    }

    // 尝试使用SQL IN子句来优化查询
    const directFields = ['id', 'name', 'description', 'modelType', 'cloudId', 'status', 'permission']
    const sqlFilters = []
    const sqlParams = []
    const extraQueries = []

    // 处理每个查询条件
    for (const { field, values } of query) {
      if (values.length === 0) continue

      // 如果是直接支持的字段，使用SQL IN子句
      if (directFields.includes(field)) {
        const placeholders = values.map(() => '?').join(', ')
        sqlFilters.push(`${field} IN (${placeholders})`)
        sqlParams.push(...values)
      } else if (field === 'embedded') {
        const boolValues = values.map(v => v ? 1 : 0)
        const placeholders = boolValues.map(() => '?').join(', ')
        sqlFilters.push(`embedded IN (${placeholders})`)
        sqlParams.push(...boolValues)
      } else if (field === 'isOneTime') {
        const boolValues = values.map(v => v ? 1 : 0)
        const placeholders = boolValues.map(() => '?').join(', ')
        sqlFilters.push(`isOneTime IN (${placeholders})`)
        sqlParams.push(...boolValues)
      } else {
        // 其他字段在内存中过滤
        extraQueries.push({ field, values })
      }
    }

    // 构建SQL查询
    let sql = `SELECT * FROM ${this.tableName}`
    if (sqlFilters.length > 0) {
      sql += ` WHERE ${sqlFilters.join(' AND ')}`
    }

    return new Promise((resolve, reject) => {
      this.db.all(sql, sqlParams, (err, rows) => {
        if (err) {
          return reject(err)
        }

        let triggers = rows.map(row => this._recordToTrigger(row)).filter(Boolean)

        // 如果有需要在内存中过滤的条件
        if (extraQueries.length > 0) {
          triggers = triggers.filter(trigger => {
            for (const { field, values } of extraQueries) {
              if (!values.includes(trigger[field])) {
                return false
              }
            }
            return true
          })
        }

        resolve(triggers)
      })
    })
  }

  /**
   * 清空表中所有数据
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
   * 关闭数据库连接
   * @returns {Promise<void>}
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

export default SQLiteTriggerStorage
