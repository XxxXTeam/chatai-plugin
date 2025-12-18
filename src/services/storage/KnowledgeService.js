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

const DATA_DIR = path.join(__dirname, '../../../data')
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
        
        // 统计信息
        const docsWithContent = Array.from(this.documents.values()).filter(d => d.content && d.content.length > 0)
        const linkedDocs = Array.from(this.documents.values()).filter(d => d.presetIds && d.presetIds.length > 0)
        
        logger.info(`[KnowledgeService] 初始化完成:`)
        logger.info(`  - 总文档数: ${this.documents.size}`)
        logger.info(`  - 有内容文档: ${docsWithContent.length}`)
        logger.info(`  - 已关联预设: ${linkedDocs.length}`)
        logger.info(`  - 知识库目录: ${KNOWLEDGE_DIR}`)
        
        // 列出已关联的文档
        if (linkedDocs.length > 0) {
            for (const doc of linkedDocs) {
                logger.info(`  - [${doc.name}] 关联预设: ${doc.presetIds.join(', ')}，内容长度: ${doc.content?.length || 0}`)
            }
        }
    }

    /**
     * 加载所有知识库文档
     */
    async loadDocuments() {
        const indexFile = path.join(KNOWLEDGE_DIR, 'index.json')
        
        if (fs.existsSync(indexFile)) {
            try {
                const indexData = JSON.parse(fs.readFileSync(indexFile, 'utf-8'))
                const brokenDocs = []
                
                for (const doc of indexData.documents || []) {
                    // 从文件读取实际内容（索引只保存元数据）
                    if (doc.filePath) {
                        const filePath = path.join(KNOWLEDGE_DIR, doc.filePath)
                        if (fs.existsSync(filePath)) {
                            try {
                                doc.content = fs.readFileSync(filePath, 'utf-8')
                                logger.debug(`[KnowledgeService] 从文件加载内容: ${doc.filePath}`)
                            } catch (err) {
                                logger.warn(`[KnowledgeService] 读取文件失败: ${doc.filePath}`, err.message)
                                doc.content = ''
                                brokenDocs.push(doc)
                            }
                        } else {
                            logger.warn(`[KnowledgeService] 文件不存在: ${doc.filePath}，文档 ${doc.id} 将被移除`)
                            brokenDocs.push(doc)
                            continue // 跳过损坏的文档，不加载到内存
                        }
                    } else {
                        // 没有 filePath，检查是否有内联内容（兼容旧格式）
                        doc.content = doc.content || ''
                    }
                    
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
                
                logger.info(`[KnowledgeService] 从索引加载 ${this.documents.size} 个文档`)
                
                // 自动清理损坏的文档记录
                if (brokenDocs.length > 0) {
                    logger.warn(`[KnowledgeService] 发现 ${brokenDocs.length} 个损坏文档，将自动清理索引`)
                    // 延迟保存索引，移除损坏的文档
                    setTimeout(() => this.saveIndex().catch(e => logger.error('[KnowledgeService] 清理索引失败:', e)), 1000)
                }
            } catch (err) {
                logger.error('[KnowledgeService] 加载索引失败:', err.message)
            }
        }

        // 扫描目录中的文件（发现未在索引中的新文件）
        await this.scanKnowledgeFiles()
    }

    /**
     * 扫描知识库目录中的文件（发现未在索引中的新文件）
     */
    async scanKnowledgeFiles() {
        const supportedExts = ['.txt', '.md', '.json']
        
        // 收集已被索引文档引用的文件
        const indexedFiles = new Set()
        for (const doc of this.documents.values()) {
            if (doc.filePath) {
                indexedFiles.add(doc.filePath)
            }
        }
        
        try {
            const files = fs.readdirSync(KNOWLEDGE_DIR)
            for (const file of files) {
                if (file === 'index.json') continue
                
                const ext = path.extname(file).toLowerCase()
                if (!supportedExts.includes(ext)) continue
                
                const filePath = path.join(KNOWLEDGE_DIR, file)
                const stat = fs.statSync(filePath)
                if (!stat.isFile()) continue
                
                // 跳过已被其他文档引用的文件
                if (indexedFiles.has(file)) {
                    logger.debug(`[KnowledgeService] 跳过已索引文件: ${file}`)
                    continue
                }
                
                const id = `file_${file.replace(/\.[^.]+$/, '')}`
                
                // 跳过已存在的文档
                if (this.documents.has(id)) continue
                
                try {
                    const content = fs.readFileSync(filePath, 'utf-8')
                    const doc = {
                        id,
                        name: file,
                        content: content.trim(),
                        type: ext === '.md' ? 'markdown' : ext === '.json' ? 'json' : 'text',
                        tags: ['auto_imported'],
                        createdAt: stat.birthtime.getTime(),
                        updatedAt: stat.mtime.getTime(),
                        presetIds: [],
                        filePath: file
                    }
                    this.documents.set(id, doc)
                    logger.info(`[KnowledgeService] 自动发现新文件: ${file}`)
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
                // 不保存完整内容到索引（内容保存在单独文件中）
                contentLength: doc.content?.length || 0
            }))
        }
        
        try {
            fs.writeFileSync(indexFile, JSON.stringify(indexData, null, 2), 'utf-8')
            logger.debug(`[KnowledgeService] 索引已保存: ${indexData.documents.length} 个文档`)
        } catch (err) {
            logger.error(`[KnowledgeService] 保存索引失败:`, err.message)
            throw err
        }
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
        
        // 保存到文件（默认行为，确保持久化）
        if (data.saveToFile !== false) {
            const ext = doc.type === 'markdown' ? '.md' : doc.type === 'json' ? '.json' : '.txt'
            // 清理文件名中的特殊字符
            let safeName = doc.name
                .replace(/[\/\\:*?"<>|]/g, '_')
                .replace(/\s+/g, '_')
                .substring(0, 80) // 限制文件名长度
            
            // 如果清理后文件名为空或只有下划线，使用 ID
            if (!safeName || /^_+$/.test(safeName)) {
                safeName = 'doc'
            }
            
            // 添加 ID 前缀确保文件名唯一，避免不同文档共享同一文件
            const idPrefix = id.replace('kb_', '').substring(0, 8)
            const fileName = `${safeName}_${idPrefix}${ext}`
            const filePath = path.join(KNOWLEDGE_DIR, fileName)
            
            try {
                fs.writeFileSync(filePath, doc.content, 'utf-8')
                doc.filePath = fileName
                logger.info(`[KnowledgeService] 创建文档: ${doc.name}`)
                logger.info(`  - ID: ${id}`)
                logger.info(`  - 文件: ${fileName}`)
                logger.info(`  - 内容长度: ${doc.content.length}`)
                logger.info(`  - 关联预设: ${doc.presetIds.join(', ') || '无'}`)
            } catch (err) {
                logger.error(`[KnowledgeService] 保存文件失败: ${filePath}`, err.message)
                throw new Error(`保存知识库文件失败: ${err.message}`)
            }
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
        logger.debug(`[KnowledgeService] 索引已更新`)
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
        
        // 保存文件内容（确保持久化）
        if (data.content !== undefined) {
            // 如果没有文件路径，创建新文件
            if (!doc.filePath) {
                const ext = doc.type === 'markdown' ? '.md' : doc.type === 'json' ? '.json' : '.txt'
                const fileName = `${doc.name.replace(/[\/\\:*?"<>|]/g, '_')}_${id.substring(0, 8)}${ext}`
                doc.filePath = fileName
                logger.info(`[KnowledgeService] 为文档 ${doc.name} 创建文件: ${fileName}`)
            }
            
            const filePath = path.join(KNOWLEDGE_DIR, doc.filePath)
            fs.writeFileSync(filePath, doc.content, 'utf-8')
            logger.debug(`[KnowledgeService] 已保存文档内容到: ${doc.filePath}`)
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
        const { 
            maxLength = 15000, 
            separator = '\n\n',
            includeTriples = true 
        } = options
        
        const docs = this.getPresetKnowledge(presetId)
        if (docs.length === 0) return ''
        
        const parts = []
        parts.push('【知识库参考资料】')
        parts.push('以下是与当前对话相关的参考信息，请在回答时参考这些内容：')
        parts.push('')
        
        let totalLength = 0
        let docIndex = 0
        
        for (const doc of docs) {
            docIndex++
            
            // 构建文档内容
            let docContent = doc.content || ''
            
            // 如果内容太长，智能截断
            const maxDocLength = Math.floor((maxLength - 200) / Math.min(docs.length, 3))
            if (docContent.length > maxDocLength) {
                // 优先保留结构化内容（实体关系部分）
                const entitySection = docContent.match(/## 实体关系[\s\S]*?(?=##|$)/)?.[0] || ''
                const passageSection = docContent.match(/## 知识条目[\s\S]*?(?=##|$)/)?.[0] || ''
                
                if (entitySection && passageSection) {
                    // 实体关系优先，知识条目截断
                    const entityLen = Math.min(entitySection.length, maxDocLength * 0.6)
                    const passageLen = maxDocLength - entityLen
                    docContent = entitySection.substring(0, entityLen) + '\n\n' + passageSection.substring(0, passageLen)
                    if (docContent.length < doc.content.length) {
                        docContent += '\n...(内容已截断)'
                    }
                } else {
                    docContent = docContent.substring(0, maxDocLength) + '\n...(内容已截断)'
                }
            }
            
            const docText = `### 📚 ${doc.name}\n${docContent}`
            
            if (totalLength + docText.length > maxLength) {
                if (docIndex === 1) {
                    // 第一个文档，至少保留一部分
                    const remaining = maxLength - totalLength - 100
                    if (remaining > 500) {
                        parts.push(docText.substring(0, remaining) + '\n...(内容已截断)')
                    }
                }
                break
            }
            
            parts.push(docText)
            totalLength += docText.length
        }
        
        if (parts.length <= 3) {
            // 没有有效内容
            return ''
        }
        
        parts.push('')
        parts.push('---')
        parts.push('请结合以上知识库内容回答用户问题。如果问题与知识库内容相关，优先参考知识库信息。')
        
        return parts.join(separator)
    }

    /**
     * 导入 OpenIE 格式的知识库
     * @param {Object} data - OpenIE JSON 数据
     * @param {Object} options - 导入选项
     * @returns {Object} 导入结果
     */
    async importOpenIE(data, options = {}) {
        const { 
            name = '导入的知识库',
            tags = [],
            presetIds = [],
            mergeMode = 'create' // create | merge | replace
        } = options

        if (!data || !data.docs || !Array.isArray(data.docs)) {
            throw new Error('无效的 OpenIE 格式：缺少 docs 数组')
        }

        const stats = {
            totalDocs: data.docs.length,
            imported: 0,
            entities: new Set(),
            triples: []
        }

        // 构建知识库内容 - 优化结构便于 AI 理解
        const entityMap = new Map() // 主体实体 -> { attributes: [], relations: [] }
        const passages = []

        for (const doc of data.docs) {
            // 收集实体
            if (doc.extracted_entities) {
                for (const entity of doc.extracted_entities) {
                    stats.entities.add(entity)
                    if (!entityMap.has(entity)) {
                        entityMap.set(entity, { attributes: [], relations: [], passages: [] })
                    }
                }
            }

            // 收集三元组并按主体组织
            if (doc.extracted_triples) {
                for (const triple of doc.extracted_triples) {
                    if (Array.isArray(triple) && triple.length >= 3) {
                        const [subject, predicate, object] = triple
                        stats.triples.push({ subject, predicate, object })
                        
                        if (!entityMap.has(subject)) {
                            entityMap.set(subject, { attributes: [], relations: [], passages: [] })
                        }
                        
                        const entry = entityMap.get(subject)
                        // 区分属性和关系
                        const isAttribute = ['是', '为', '有', '属于', '名', '名字', '外文名', '别号', '别名'].some(
                            k => predicate.includes(k)
                        ) || predicate.endsWith('色') || predicate.endsWith('名')
                        
                        if (isAttribute) {
                            entry.attributes.push({ predicate, object })
                        } else {
                            entry.relations.push({ predicate, object })
                        }
                    }
                }
            }

            // 收集原文段落并关联到实体
            if (doc.passage) {
                passages.push(doc.passage)
                stats.imported++
                
                // 将段落关联到提及的实体
                if (doc.extracted_entities) {
                    for (const entity of doc.extracted_entities) {
                        if (entityMap.has(entity)) {
                            entityMap.get(entity).passages.push(doc.passage)
                        }
                    }
                }
            }
        }

        // 构建结构化内容 - 实体为中心的组织方式
        let content = ''
        
        // 1. 实体关系图谱（主要内容，AI 更容易理解）
        if (entityMap.size > 0) {
            content += '## 实体关系\n\n'
            content += '以下是知识库中的实体及其属性、关系：\n\n'
            
            // 按实体关联信息量排序，信息量大的优先
            const sortedEntities = Array.from(entityMap.entries())
                .map(([entity, data]) => ({
                    entity,
                    data,
                    score: data.attributes.length * 2 + data.relations.length + data.passages.length
                }))
                .filter(e => e.score > 0)
                .sort((a, b) => b.score - a.score)
            
            for (const { entity, data } of sortedEntities) {
                if (data.attributes.length === 0 && data.relations.length === 0) continue
                
                content += `### 【${entity}】\n`
                
                // 属性
                if (data.attributes.length > 0) {
                    content += '**基本属性：**\n'
                    for (const attr of data.attributes) {
                        content += `- ${attr.predicate}：${attr.object}\n`
                    }
                }
                
                // 关系
                if (data.relations.length > 0) {
                    content += '**相关信息：**\n'
                    for (const rel of data.relations) {
                        content += `- ${rel.predicate}：${rel.object}\n`
                    }
                }
                
                content += '\n'
            }
        }

        // 2. 原始知识条目（补充信息）
        if (passages.length > 0) {
            content += '## 知识条目\n\n'
            content += '以下是原始知识片段：\n\n'
            // 去重并限制数量
            const uniquePassages = [...new Set(passages)]
            const maxPassages = Math.min(uniquePassages.length, 200)
            content += uniquePassages.slice(0, maxPassages).join('\n\n')
            if (uniquePassages.length > maxPassages) {
                content += `\n\n...(还有 ${uniquePassages.length - maxPassages} 条未显示)`
            }
            content += '\n\n'
        }

        // 3. 快速查询索引（三元组简表）
        if (stats.triples.length > 0 && stats.triples.length <= 50) {
            content += '## 快速查询索引\n\n'
            content += '| 主体 | 关系 | 内容 |\n'
            content += '|------|------|------|\n'
            for (const t of stats.triples) {
                // 转义表格中的特殊字符
                const subject = t.subject.replace(/\|/g, '\\|')
                const predicate = t.predicate.replace(/\|/g, '\\|')
                const object = t.object.replace(/\|/g, '\\|')
                content += `| ${subject} | ${predicate} | ${object} |\n`
            }
            content += '\n'
        }

        // 根据合并模式处理
        let resultDoc
        const existingDoc = this.getByName(name)

        if (existingDoc && mergeMode === 'merge') {
            // 合并到现有文档
            const mergedContent = existingDoc.content + '\n\n---\n\n' + content
            resultDoc = await this.update(existingDoc.id, {
                content: mergedContent,
                tags: [...new Set([...(existingDoc.tags || []), ...tags])]
            })
        } else if (existingDoc && mergeMode === 'replace') {
            // 替换现有文档
            resultDoc = await this.update(existingDoc.id, {
                content,
                tags,
                presetIds: presetIds.length > 0 ? presetIds : existingDoc.presetIds
            })
        } else {
            // 创建新文档
            const docName = existingDoc ? `${name}_${Date.now()}` : name
            resultDoc = await this.create({
                name: docName,
                content,
                type: 'markdown',
                tags: ['openie', 'imported', ...tags],
                presetIds
            })
        }

        return {
            success: true,
            document: resultDoc,
            stats: {
                totalDocs: stats.totalDocs,
                imported: stats.imported,
                entityCount: stats.entities.size,
                tripleCount: stats.triples.length
            }
        }
    }

    /**
     * 搜索知识库
     * @param {string} query
     * @param {Object} options
     * @returns {Array<{doc: KnowledgeDocument, score: number, matches: string[]}>}
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
            const matches = []
            const contentLower = (doc.content || '').toLowerCase()
            const nameLower = (doc.name || '').toLowerCase()
            
            // 标题匹配权重高
            if (nameLower.includes(queryLower)) {
                score += 15
                matches.push(`标题匹配: ${doc.name}`)
            }
            
            // 实体标题匹配 (【实体名】格式)
            const entityPattern = /【([^】]+)】/g
            let entityMatch
            while ((entityMatch = entityPattern.exec(doc.content || '')) !== null) {
                const entity = entityMatch[1].toLowerCase()
                if (entity.includes(queryLower) || queryLower.includes(entity)) {
                    score += 20
                    matches.push(`实体匹配: ${entityMatch[1]}`)
                }
                for (const term of queryTerms) {
                    if (entity.includes(term)) {
                        score += 8
                    }
                }
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
                if (count > 0) {
                    score += count * 2
                    matches.push(`内容匹配 "${term}": ${count}次`)
                }
            }
            
            // 标签匹配
            for (const tag of doc.tags || []) {
                if (queryTerms.some(t => tag.toLowerCase().includes(t))) {
                    score += 5
                    matches.push(`标签匹配: ${tag}`)
                }
            }
            
            if (score > 0) {
                results.push({ doc, score, matches })
            }
        }
        
        // 按分数排序
        results.sort((a, b) => b.score - a.score)
        
        return results.slice(0, limit)
    }

    /**
     * 基于查询动态获取相关知识（用于工具调用）
     * @param {string} query - 查询内容
     * @param {Object} options - 选项
     * @returns {string} 格式化的知识内容
     */
    getRelevantKnowledge(query, options = {}) {
        const { presetId, maxLength = 5000, limit = 3 } = options
        
        const results = this.search(query, { presetId, limit })
        if (results.length === 0) return ''
        
        const parts = [`【查询相关知识】关键词: "${query}"`]
        let totalLength = 0
        
        for (const { doc, score, matches } of results) {
            // 提取相关片段而非完整内容
            let relevantContent = this.extractRelevantSection(doc.content, query)
            
            if (totalLength + relevantContent.length > maxLength) {
                relevantContent = relevantContent.substring(0, maxLength - totalLength - 50) + '...'
            }
            
            parts.push(`\n### ${doc.name} (相关度: ${score})`)
            parts.push(relevantContent)
            
            totalLength += relevantContent.length
            if (totalLength >= maxLength) break
        }
        
        return parts.join('\n')
    }

    /**
     * 从文档内容中提取与查询相关的片段
     * @param {string} content - 文档内容
     * @param {string} query - 查询关键词
     * @returns {string} 相关片段
     */
    extractRelevantSection(content, query) {
        if (!content || !query) return content || ''
        
        const queryLower = query.toLowerCase()
        const lines = content.split('\n')
        const relevantLines = []
        let inRelevantSection = false
        let sectionDepth = 0
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const lineLower = line.toLowerCase()
            
            // 检查是否是章节标题
            const isHeader = line.match(/^#{1,4}\s/)
            
            // 如果是包含查询词的章节标题，开始收集
            if (isHeader && lineLower.includes(queryLower)) {
                inRelevantSection = true
                sectionDepth = (line.match(/^#+/) || [''])[0].length
                relevantLines.push(line)
                continue
            }
            
            // 如果在相关章节中
            if (inRelevantSection) {
                // 遇到同级或更高级标题时结束
                if (isHeader) {
                    const currentDepth = (line.match(/^#+/) || [''])[0].length
                    if (currentDepth <= sectionDepth) {
                        inRelevantSection = false
                        // 检查新章节是否也相关
                        if (lineLower.includes(queryLower)) {
                            inRelevantSection = true
                            sectionDepth = currentDepth
                            relevantLines.push(line)
                        }
                        continue
                    }
                }
                relevantLines.push(line)
            } else if (lineLower.includes(queryLower)) {
                // 单行匹配，收集上下文
                const start = Math.max(0, i - 1)
                const end = Math.min(lines.length, i + 3)
                for (let j = start; j < end; j++) {
                    if (!relevantLines.includes(lines[j])) {
                        relevantLines.push(lines[j])
                    }
                }
            }
        }
        
        // 如果没有找到相关片段，返回开头部分
        if (relevantLines.length === 0) {
            return lines.slice(0, 20).join('\n')
        }
        
        return relevantLines.join('\n')
    }
}

export const knowledgeService = new KnowledgeService()
