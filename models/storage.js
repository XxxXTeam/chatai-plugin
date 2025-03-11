// storage.js written by sonnet
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import path from 'path'
import fs from 'fs'
import ChatGPTConfig from '../config/config.js'

/**
 * 基于 LowDB 的简单存储类，提供 CRUD 和条件查询功能
 */
export class LowDBStorage {
  /**
   * 创建一个新的存储实例
   * @param {Object} options 配置选项
   * @param {string} options.filename 数据文件名称
   * @param {string} options.directory 数据目录，默认为当前目录下的 data 文件夹
   */
  constructor (options = {}) {
    const { filename = 'db.json', directory = path.join(process.cwd(), 'data') } = options

    // 确保目录存在
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true })
    }

    this.filePath = path.join(directory, filename)
    this.adapter = new JSONFile(this.filePath)
    this.db = new Low(this.adapter, { collections: {} })
    this.initialized = false
  }

  /**
   * 初始化存储
   * @returns {Promise<LowDBStorage>} 当前存储实例
   */
  async init () {
    // 读取数据文件，如果不存在则创建默认结构
    await this.db.read()
    this.db.data ||= { collections: {} }
    await this.db.write()

    this.initialized = true
    return this
  }

  /**
   * 获取或创建一个集合
   * @param {string} name 集合名称
   * @returns {LowDBCollection} 集合实例
   */
  collection (name) {
    this._checkInit()

    // 确保集合存在
    if (!this.db.data.collections[name]) {
      this.db.data.collections[name] = []
      this.db.write()
    }

    return new LowDBCollection(this, name)
  }

  /**
   * 列出所有集合名称
   * @returns {string[]} 集合名称列表
   */
  listCollections () {
    this._checkInit()
    return Object.keys(this.db.data.collections)
  }

  /**
   * 删除一个集合
   * @param {string} name 要删除的集合名称
   * @returns {Promise<boolean>} 是否成功删除
   */
  async dropCollection (name) {
    this._checkInit()

    if (this.db.data.collections[name]) {
      delete this.db.data.collections[name]
      await this.db.write()
      return true
    }
    return false
  }

  /**
   * 检查存储是否已初始化
   * @private
   */
  _checkInit () {
    if (!this.initialized) {
      throw new Error('存储尚未初始化，请先调用 init() 方法')
    }
  }
}

/**
 * 集合类，提供对特定数据集合的操作
 */
export class LowDBCollection {
  /**
   * 创建一个集合实例
   * @param {LowDBStorage} storage 所属存储实例
   * @param {string} name 集合名称
   */
  constructor (storage, name) {
    this.storage = storage
    this.name = name
  }

  /**
   * 获取集合数据引用
   * @private
   */
  get _collection () {
    return this.storage.db.data.collections[this.name]
  }

  /**
   * 保存数据到存储
   * @private
   */
  async _save () {
    return this.storage.db.write()
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateId () {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 15)
  }

  /**
   * 创建新文档
   * @param {Object} doc 要插入的文档
   * @returns {Promise<Object & {id: string}>} 插入的文档（带ID）
   */
  async insert (doc) {
    // 生成唯一ID，如果没有提供
    if (!doc.id) {
      doc.id = this._generateId()
    }

    // 加上时间戳
    if (!doc.createdAt) {
      doc.createdAt = new Date().toISOString()
    }

    doc.updatedAt = new Date().toISOString()

    // 添加到集合
    this._collection.push(doc)
    await this._save()

    return doc
  }

  /**
   * 批量插入多个文档
   * @param {Object[]} docs 要插入的文档数组
   * @returns {Promise<Object[]>} 插入的文档（带ID）
   */
  async insertMany (docs) {
    const inserted = []

    for (const doc of docs) {
      inserted.push(await this.insert(doc))
    }

    return inserted
  }

  /**
   * 根据ID查找单个文档
   * @param {string} id 文档ID
   * @returns {Promise<Object|null>} 查找到的文档或null
   */
  async findById (id) {
    return this._collection.find(doc => doc.id === id) || null
  }

  /**
   * 返回集合中的所有文档
   * @returns {Promise<Object[]>} 文档数组
   */
  async findAll () {
    return [...this._collection]
  }

  /**
   * 根据条件查找文档
   * @param {Object} query 查询条件（字段等值匹配）
   * @returns {Promise<Object[]>} 匹配的文档数组
   */
  async find (query = {}) {
    return this._collection.filter(doc => {
      for (const key in query) {
        const value = query[key]

        // 处理嵌套属性 (例如 user.profile.name)
        if (key.includes('.')) {
          const parts = key.split('.')
          let current = doc

          for (let i = 0; i < parts.length; i++) {
            if (current === undefined || current === null) return false
            current = current[parts[i]]
          }

          if (current !== value) return false
        } else if (doc[key] !== value) {
          return false
        }
      }
      return true
    })
  }

  /**
   * 根据条件查找单个文档
   * @param {Object} query 查询条件
   * @returns {Promise<Object|null>} 第一个匹配的文档或null
   */
  async findOne (query = {}) {
    const results = await this.find(query)
    return results.length > 0 ? results[0] : null
  }

  /**
   * 使用自定义函数进行高级查询
   * @param {Function} filterFn 过滤函数
   * @returns {Promise<Object[]>} 匹配的文档数组
   */
  async findWhere (filterFn) {
    return this._collection.filter(filterFn)
  }

  /**
   * 根据ID更新文档
   * @param {string} id 文档ID
   * @param {Object} updates 要更新的字段
   * @returns {Promise<Object|null>} 更新后的文档或null
   */
  async updateById (id, updates) {
    const index = this._collection.findIndex(doc => doc.id === id)

    if (index === -1) return null

    // 防止覆盖ID
    const { id: _, ...safeUpdates } = updates

    // 更新文档
    const updatedDoc = {
      ...this._collection[index],
      ...safeUpdates,
      updatedAt: new Date().toISOString()
    }

    this._collection[index] = updatedDoc
    await this._save()

    return updatedDoc
  }

  /**
   * 根据条件更新文档
   * @param {Object} query 查询条件
   * @param {Object} updates 要更新的字段
   * @returns {Promise<number>} 更新的文档数量
   */
  async update (query, updates) {
    const matches = await this.find(query)
    let updated = 0

    for (const doc of matches) {
      await this.updateById(doc.id, updates)
      updated++
    }

    return updated
  }

  /**
   * 根据ID删除文档
   * @param {string} id 文档ID
   * @returns {Promise<boolean>} 是否成功删除
   */
  async deleteById (id) {
    const index = this._collection.findIndex(doc => doc.id === id)

    if (index === -1) return false

    this._collection.splice(index, 1)
    await this._save()

    return true
  }

  /**
   * 根据条件删除文档
   * @param {Object} query 查询条件
   * @returns {Promise<number>} 删除的文档数量
   */
  async delete (query) {
    const before = this._collection.length

    const remaining = this._collection.filter(doc => {
      for (const key in query) {
        if (doc[key] !== query[key]) {
          return true // 保留不匹配的
        }
      }
      return false // 删除匹配的
    })

    this.storage.db.data.collections[this.name] = remaining
    await this._save()

    return before - remaining.length
  }

  /**
   * 清空集合中的所有文档
   * @returns {Promise<number>} 删除的文档数量
   */
  async deleteAll () {
    const count = this._collection.length
    this.storage.db.data.collections[this.name] = []
    await this._save()
    return count
  }

  /**
   * 返回集合中文档的数量
   * @returns {Promise<number>} 文档数量
   */
  async count (query = {}) {
    if (Object.keys(query).length === 0) {
      return this._collection.length
    }

    const matches = await this.find(query)
    return matches.length
  }
}

const dataDir = path.resolve('./plugins/chatgpt-plugin', ChatGPTConfig.dataDir)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}
const storageLocation = path.resolve(dataDir, 'storage.json')
if (!fs.existsSync(storageLocation)) {
  fs.writeFileSync(storageLocation, JSON.stringify({ collections: {} }))
}

const ChatGPTStorage = new LowDBStorage({
  filename: 'storage.json',
  directory: dataDir
})

export default ChatGPTStorage
