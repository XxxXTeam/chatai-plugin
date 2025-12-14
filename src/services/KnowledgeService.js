/**
 * 知识库服务
 * 管理预设关联的知识库文档
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.join(__dirname, '../../data')
const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge')

/**
 * 知识库文档
 * @typedef {Object} KnowledgeDocument
 * @property {string} id - 文档ID
 * @property {string} name - 文档名称
 * @property {string} content - 文档内容
 * @property {string} type - 文档类型 (text, markdown, json)
 * @property {string[]} tags - 标签
 * @property {number} createdAt - 创建时间
 * @property {number} updatedAt - 更新时间
 * @property {string[]} presetIds - 关联的预设ID
 */

class KnowledgeService {
    constructor() {
        this.initialized = false
        this.documents = new Map()
        this.presetKnowledgeMap = new Map() // presetId -> Set<docId>
    }

    async init() {
        if (this.initialized) return
        
        // 确保知识库目录存在
        if (!fs.existsSync(KNOWLEDGE_DIR)) {
            fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true })
        }
        
        await this.loadDocuments()
        this.initialized = true
        logger.debug(`[KnowledgeService] 初始化完成，加载 ${this.documents.size} 个知识库文档`)
    }

    /**
     * 加载所有知识库文档
     */
    async loadDocuments() {
        const indexFile = path.join(KNOWLEDGE_DIR, 'index.json')
        
        if (fs.existsSync(indexFile)) {
            try {
                const indexData = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
                for (const doc of indexData.documents || []) {
                    this.documents.set(doc.id, doc)
                    // 构建预设-文档映射
                    if (doc.presetIds && doc.presetIds.length > 0) {
                        for (const presetId of doc.presetIds) {
                            if (!this.presetKnowledgeMap.has(presetId)) {
                                this.presetKnowledgeMap.set(presetId, new Set())
                            }
                            this.presetKnowledgeMap.get(presetId).add(doc.id)
                        }
                    }
                }
            } catch (err) {
                logger.error('[KnowledgeService] 加载索引失败:', err.message)
            }
        }

        // 扫描目录中的文件
        await this.scanKnowledgeFiles()
    }

    /**
     * 扫描知识库目录中的文件
     */
    async scanKnowledgeFiles() {
        const supportedExts = ['.txt', '.md', '.json']
        
        try {
            const files = fs.readdirSync(KNOWLEDGE_DIR)
            for (const file of files) {
                if (file === 'index.json') continue
                
                const ext = path.extname(file).toLowerCase()
                if (!supportedExts.includes(ext)) continue
                
                const filePath = path.join(KNOWLEDGE_DIR, file)
                const stat = fs.statSync(filePath)
                if (!stat.isFile()) continue
                
                const id = `file_${file.replace(/\.[^.]+$/, '')}`
                
                // 跳过已存在的
                if (this.documents.has(id)) continue
                
                try {
                    const content = fs.readFileSync(filePath, 'utf-8')
                    const doc = {
                        id,
                        name: file,
                        content: content.trim(),
                        type: ext === '.md' ? 'markdown' : ext === '.json' ? 'json' : 'text',
                        tags: [],
                        createdAt: stat.birthtime.getTime(),
                        updatedAt: stat.mtime.getTime(),
                        presetIds: [],
                        filePath: file
                    }
                    this.documents.set(id, doc)
                    logger.debug(`[KnowledgeService] 自动加载文件: ${file}`)
                } catch (err) {
                    logger.warn(`[KnowledgeService] 读取文件失败: ${file}`, err.message)
                }
            }
        } catch (err) {
            logger.error('[KnowledgeService] 扫描目录失败:', err.message)
        }
    }

    /**
     * 保存索引文件
     */
    async saveIndex() {
        const indexFile = path.join(KNOWLEDGE_DIR, 'index.json')
        const indexData = {
            version: 1,
            updatedAt: Date.now(),
            documents: Array.from(this.documents.values()).map(doc => ({
                id: doc.id,
                name: doc.name,
                type: doc.type,
                tags: doc.tags,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                presetIds: doc.presetIds,
                filePath: doc.filePath,
                // 不保存完整内容到索引
                contentLength: doc.content?.length || 0
            }))
        }
        
        fs.writeFileSync(indexFile, JSON.stringify(indexData, null, 2), 'utf-8')
    }

    /**
     * 获取所有知识库文档
     * @returns {Array<KnowledgeDocument>}
     */
    getAll() {
        return Array.from(this.documents.values())
    }

    /**
     * 根据ID获取文档
     * @param {string} id
     * @returns {KnowledgeDocument|null}
     */
    get(id) {
        return this.documents.get(id) || null
    }

    /**
     * 根据名称获取文档
     * @param {string} name
     * @returns {KnowledgeDocument|null}
     */
    getByName(name) {
        for (const doc of this.documents.values()) {
            if (doc.name === name) return doc
        }
        return null
    }

    /**
     * 创建知识库文档
     * @param {Object} data - 文档数据
     * @returns {KnowledgeDocument}
     */
    async create(data) {
        const id = data.id || `kb_${crypto.randomUUID()}`
        const now = Date.now()
        
        const doc = {
            id,
            name: data.name || '未命名文档',
            content: data.content || '',
            type: data.type || 'text',
            tags: data.tags || [],
            createdAt: now,
            updatedAt: now,
            presetIds: data.presetIds || []
        }
        
        // 如果有文件路径，保存到文件
        if (data.saveToFile !== false) {
            const ext = doc.type === 'markdown' ? '.md' : doc.type === 'json' ? '.json' : '.txt'
            const fileName = `${doc.name.replace(/[\/\\:*?"<>|]/g, '_')}${ext}`
            const filePath = path.join(KNOWLEDGE_DIR, fileName)
            fs.writeFileSync(filePath, doc.content, 'utf-8')
            doc.filePath = fileName
        }
        
        this.documents.set(id, doc)
        
        // 更新预设映射
        for (const presetId of doc.presetIds) {
            if (!this.presetKnowledgeMap.has(presetId)) {
                this.presetKnowledgeMap.set(presetId, new Set())
            }
            this.presetKnowledgeMap.get(presetId).add(id)
        }
        
        await this.saveIndex()
        return doc
    }

    /**
     * 更新知识库文档
     * @param {string} id
     * @param {Object} data
     * @returns {KnowledgeDocument}
     */
    async update(id, data) {
        const doc = this.documents.get(id)
        if (!doc) {
            throw new Error(`文档不存在: ${id}`)
        }
        
        const oldPresetIds = doc.presetIds || []
        
        // 更新字段
        Object.assign(doc, {
            ...data,
            id, // 不能改变ID
            updatedAt: Date.now()
        })
        
        // 如果有文件，更新文件内容
        if (doc.filePath && data.content !== undefined) {
            const filePath = path.join(KNOWLEDGE_DIR, doc.filePath)
            if (fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, doc.content, 'utf-8')
            }
        }
        
        // 更新预设映射
        // 移除旧的映射
        for (const presetId of oldPresetIds) {
            const set = this.presetKnowledgeMap.get(presetId)
            if (set) set.delete(id)
        }
        // 添加新的映射
        for (const presetId of doc.presetIds || []) {
            if (!this.presetKnowledgeMap.has(presetId)) {
                this.presetKnowledgeMap.set(presetId, new Set())
            }
            this.presetKnowledgeMap.get(presetId).add(id)
        }
        
        await this.saveIndex()
        return doc
    }

    /**
     * 删除知识库文档
     * @param {string} id
     * @returns {boolean}
     */
    async delete(id) {
        const doc = this.documents.get(id)
        if (!doc) return false
        
        // 删除文件
        if (doc.filePath) {
            const filePath = path.join(KNOWLEDGE_DIR, doc.filePath)
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)
            }
        }
        
        // 移除映射
        for (const presetId of doc.presetIds || []) {
            const set = this.presetKnowledgeMap.get(presetId)
            if (set) set.delete(id)
        }
        
        this.documents.delete(id)
        await this.saveIndex()
        return true
    }

    /**
     * 获取预设关联的知识库
     * @param {string} presetId
     * @returns {Array<KnowledgeDocument>}
     */
    getPresetKnowledge(presetId) {
        const docIds = this.presetKnowledgeMap.get(presetId)
        if (!docIds || docIds.size === 0) return []
        
        const docs = []
        for (const id of docIds) {
            const doc = this.documents.get(id)
            if (doc) docs.push(doc)
        }
        return docs
    }

    /**
     * 将知识库关联到预设
     * @param {string} docId
     * @param {string} presetId
     */
    async linkToPreset(docId, presetId) {
        const doc = this.documents.get(docId)
        if (!doc) {
            throw new Error(`文档不存在: ${docId}`)
        }
        
        if (!doc.presetIds.includes(presetId)) {
            doc.presetIds.push(presetId)
            doc.updatedAt = Date.now()
            
            if (!this.presetKnowledgeMap.has(presetId)) {
                this.presetKnowledgeMap.set(presetId, new Set())
            }
            this.presetKnowledgeMap.get(presetId).add(docId)
            
            await this.saveIndex()
        }
    }

    /**
     * 取消知识库与预设的关联
     * @param {string} docId
     * @param {string} presetId
     */
    async unlinkFromPreset(docId, presetId) {
        const doc = this.documents.get(docId)
        if (!doc) return
        
        const idx = doc.presetIds.indexOf(presetId)
        if (idx !== -1) {
            doc.presetIds.splice(idx, 1)
            doc.updatedAt = Date.now()
            
            const set = this.presetKnowledgeMap.get(presetId)
            if (set) set.delete(docId)
            
            await this.saveIndex()
        }
    }

    /**
     * 构建预设的知识库提示词
     * @param {string} presetId
     * @param {Object} options
     * @returns {string}
     */
    buildKnowledgePrompt(presetId, options = {}) {
        const { maxLength = 10000, separator = '\n\n---\n\n' } = options
        
        const docs = this.getPresetKnowledge(presetId)
        if (docs.length === 0) return ''
        
        const parts = ['【知识库参考】']
        let totalLength = 0
        
        for (const doc of docs) {
            const docText = `## ${doc.name}\n${doc.content}`
            if (totalLength + docText.length > maxLength) {
                // 截断
                const remaining = maxLength - totalLength
                if (remaining > 100) {
                    parts.push(docText.substring(0, remaining) + '...')
                }
                break
            }
            parts.push(docText)
            totalLength += docText.length
        }
        
        return parts.join(separator)
    }

    /**
     * 搜索知识库
     * @param {string} query
     * @param {Object} options
     * @returns {Array<{doc: KnowledgeDocument, score: number}>}
     */
    search(query, options = {}) {
        const { limit = 10, presetId } = options
        const results = []
        
        let searchDocs = Array.from(this.documents.values())
        
        // 如果指定预设，只搜索关联的文档
        if (presetId) {
            searchDocs = this.getPresetKnowledge(presetId)
        }
        
        const queryLower = query.toLowerCase()
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1)
        
        for (const doc of searchDocs) {
            let score = 0
            const contentLower = (doc.content || '').toLowerCase()
            const nameLower = (doc.name || '').toLowerCase()
            
            // 标题匹配权重高
            if (nameLower.includes(queryLower)) {
                score += 10
            }
            
            // 内容匹配
            for (const term of queryTerms) {
                if (nameLower.includes(term)) score += 5
                
                // 计算在内容中出现的次数
                let idx = 0
                let count = 0
                while ((idx = contentLower.indexOf(term, idx)) !== -1) {
                    count++
                    idx += term.length
                    if (count >= 10) break
                }
                score += count
            }
            
            // 标签匹配
            for (const tag of doc.tags || []) {
                if (queryTerms.some(t => tag.toLowerCase().includes(t))) {
                    score += 3
                }
            }
            
            if (score > 0) {
                results.push({ doc, score })
            }
        }
        
        // 按分数排序
        results.sort((a, b) => b.score - a.score)
        
        return results.slice(0, limit)
    }
}

export const knowledgeService = new KnowledgeService()
