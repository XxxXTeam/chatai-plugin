import fsp from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import crypto from 'crypto'
import { getScopeManager } from '../src/services/scope/ScopeManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { getBfaceUrl } from '../src/utils/messageParser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 表情包小偷服务
 * 支持群组独立配置：开关、独立文件夹、最大数量、触发方式
 *
 * 触发方式:
 * - random: 随机触发（按概率）
 * - bym_follow: 伪人触发跟随（伪人触发时一起发送）
 * - bym_random: 伪人触发随机（伪人触发时按概率发送）
 * - chat_follow: 对话跟随（AI回复时一起发送）
 * - chat_random: 对话随机（AI回复时按概率发送）
 * - off: 不自动发送（仅收集）
 */
class EmojiThiefService {
    constructor() {
        this.rootDir = path.join(__dirname, '../data/EmojiThief')
        this.globalDbPath = path.join(this.rootDir, 'global_md5.json')
        this.initialized = false
    }

    async init() {
        if (this.initialized) return
        await fsp.mkdir(this.rootDir, { recursive: true }).catch(() => {})
        this.initialized = true
    }

    /**
     * 获取群组配置
     */
    async getGroupConfig(groupId) {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()
            const groupSettings = await scopeManager.getGroupSettings(String(groupId))
            const settings = groupSettings?.settings || {}

            return {
                enabled: settings.emojiThiefEnabled ?? false,
                separateFolder: settings.emojiThiefSeparateFolder ?? true, // 独立文件夹
                maxCount: settings.emojiThiefMaxCount ?? 500,
                stealRate: settings.emojiThiefStealRate ?? 1.0, // 偷取概率
                triggerMode: settings.emojiThiefTriggerMode ?? 'random',
                triggerRate: settings.emojiThiefTriggerRate ?? 0.05 // 发送概率
            }
        } catch (err) {
            logger.debug('[EmojiThief] 获取群组配置失败:', err.message)
            return {
                enabled: false,
                separateFolder: true,
                maxCount: 500,
                stealRate: 1.0,
                triggerMode: 'random',
                triggerRate: 0.05
            }
        }
    }

    /**
     * 获取表情包存储路径
     * @param {string} groupId 群号
     * @param {boolean} separateFolder 是否独立文件夹
     */
    getEmojiDir(groupId, separateFolder) {
        if (separateFolder) {
            return path.join(this.rootDir, `group_${groupId}`)
        }
        return path.join(this.rootDir, 'shared')
    }

    /**
     * 读取MD5数据库
     */
    async readMd5Db(dbPath) {
        try {
            await fsp.access(dbPath)
            const data = await fsp.readFile(dbPath, 'utf-8')
            return new Set(JSON.parse(data))
        } catch {
            return new Set()
        }
    }

    /**
     * 写入MD5数据库
     */
    async writeMd5Db(dbPath, md5Set) {
        const dataArray = Array.from(md5Set)
        await fsp.writeFile(dbPath, JSON.stringify(dataArray, null, 2))
    }

    /**
     * 收集表情包
     */
    async collectEmoji(e) {
        await this.init()

        if (!e.isGroup || !e.group_id) return false

        const groupId = String(e.group_id)
        const config = await this.getGroupConfig(groupId)

        if (!config.enabled) return false

        const emojiDir = this.getEmojiDir(groupId, config.separateFolder)
        const dbPath = path.join(emojiDir, 'md5.json')

        await fsp.mkdir(emojiDir, { recursive: true }).catch(() => {})

        const md5Db = await this.readMd5Db(dbPath)
        let hasNewEmoji = false
        let collectedCount = 0

        for (const item of e.message) {
            // 获取表情URL（支持多种类型）
            let emojiUrl = null
            let emojiType = null

            // 检查是否是表情包类型的图片
            if (item.type === 'image') {
                // 严格过滤：必须是表情包类型（sub_type=1 或有 emoji_id）
                // 排除头像和普通图片
                const isEmoji = item.sub_type === 1 || item.emoji_id || item.asface

                // 排除可能是头像的图片
                const url = item.url || ''
                const isAvatar =
                    url.includes('/avatar/') ||
                    url.includes('q.qlogo.cn') ||
                    url.includes('qlogo.cn') ||
                    url.includes('/head/') ||
                    url.includes('face_') ||
                    url.includes('/0/0-') || // QQ头像URL特征
                    (item.width && item.height && item.width === item.height && item.width <= 140) // 小正方形图片可能是头像

                // 排除过小或过大的图片（表情包通常在特定尺寸范围内）
                const width = item.width || 0
                const height = item.height || 0
                const isSizeInvalid =
                    width > 0 &&
                    height > 0 &&
                    ((width < 50 && height < 50) || // 太小，可能是表情符号
                        width > 800 ||
                        height > 800) // 太大，不是表情包

                if (isEmoji && !isAvatar && !isSizeInvalid && url) {
                    emojiUrl = url
                    emojiType = 'image'
                }
            }
            // 支持 bface 原创表情
            else if (item.type === 'bface' && item.file) {
                emojiUrl = getBfaceUrl(item.file)
                if (emojiUrl) {
                    emojiType = 'bface'
                    logger.debug(`[EmojiThief] 发现bface表情: ${item.text || '未知'}, url=${emojiUrl}`)
                }
            }
            // 支持 mface 商城表情
            else if (item.type === 'mface' && item.url) {
                emojiUrl = item.url
                emojiType = 'mface'
                logger.debug(`[EmojiThief] 发现mface商城表情`)
            }

            if (!emojiUrl) continue

            // 预先检查URL是否已存在（基于URL的快速去重，避免重复下载）
            const urlHash = crypto.createHash('md5').update(emojiUrl).digest('hex').substring(0, 16)
            if (md5Db.has(urlHash) || md5Db.has(`url:${urlHash}`)) {
                logger.debug(`[EmojiThief] 跳过重复URL: ${emojiUrl.substring(0, 50)}...`)
                continue
            }

            try {
                // 根据偷取概率决定是否偷取
                if (Math.random() > config.stealRate) {
                    continue
                }

                // 如果达到上限，随机删除一个
                if (md5Db.size >= config.maxCount) {
                    await this.removeRandomEmoji(emojiDir, md5Db)
                }

                const response = await axios.get(emojiUrl, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                    validateStatus: status => status === 200 // 只接受200状态码
                })
                const buffer = response.data

                // 检查下载的内容是否有效
                if (!buffer || buffer.length < 100) {
                    logger.debug(`[EmojiThief] 跳过无效数据: ${emojiUrl.substring(0, 50)}...`)
                    continue
                }

                const hash = crypto.createHash('md5').update(buffer).digest('hex')

                // 检查内容hash是否已存在
                if (md5Db.has(hash)) {
                    // 记录URL hash以便下次快速跳过
                    md5Db.add(`url:${urlHash}`)
                    logger.debug(`[EmojiThief] 跳过重复内容: ${hash}`)
                    continue
                }

                // 判断文件类型
                const ext = this.detectImageType(buffer) || 'gif'
                const fileName = `${hash}.${ext}`
                const filePath = path.join(emojiDir, fileName)

                await fsp.writeFile(filePath, buffer)
                md5Db.add(hash)
                md5Db.add(`url:${urlHash}`) // 同时记录URL hash
                hasNewEmoji = true
                collectedCount++

                logger.debug(`[EmojiThief] 收集${emojiType}表情成功: ${fileName}`)
            } catch (error) {
                logger.debug(`[EmojiThief] 处理${emojiType || ''}表情包失败: ${error.message}`)
            }
        }

        if (hasNewEmoji) {
            await this.writeMd5Db(dbPath, md5Db)
            logger.debug(`[EmojiThief] 群${groupId}新收集${collectedCount}个表情包，共${md5Db.size}个`)
        }

        return hasNewEmoji
    }

    /**
     * 检测图片类型
     */
    detectImageType(buffer) {
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'webp'
        return null
    }

    /**
     * 随机删除一个表情包（当达到上限时）
     */
    async removeRandomEmoji(emojiDir, md5Db) {
        try {
            const files = await fsp.readdir(emojiDir)
            const emojiFiles = files.filter(f => !f.endsWith('.json'))

            if (emojiFiles.length === 0) return

            const randomFile = emojiFiles[Math.floor(Math.random() * emojiFiles.length)]
            const filePath = path.join(emojiDir, randomFile)

            // 从MD5数据库中移除
            const hash = randomFile.split('.')[0]
            md5Db.delete(hash)

            // 删除文件
            await fsp.unlink(filePath).catch(() => {})
            logger.debug(`[EmojiThief] 达到上限，删除旧表情包: ${randomFile}`)
        } catch (err) {
            logger.debug(`[EmojiThief] 删除随机表情包失败: ${err.message}`)
        }
    }

    /**
     * 随机获取一个表情包
     */
    async getRandomEmoji(groupId, separateFolder = true) {
        await this.init()

        try {
            const emojiDir = this.getEmojiDir(groupId, separateFolder)

            // 尝试从群组目录获取
            let files = []
            try {
                const allFiles = await fsp.readdir(emojiDir)
                files = allFiles.filter(f => !f.endsWith('.json'))
            } catch {
                // 目录不存在
            }

            // 如果本群没有，尝试从所有群组获取
            if (files.length === 0) {
                const dirs = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch(() => [])

                for (const dir of dirs.filter(d => d.isDirectory())) {
                    const dirPath = path.join(this.rootDir, dir.name)
                    try {
                        const dirFiles = await fsp.readdir(dirPath)
                        const emojiFiles = dirFiles.filter(f => !f.endsWith('.json'))
                        if (emojiFiles.length > 0) {
                            const randomFile = emojiFiles[Math.floor(Math.random() * emojiFiles.length)]
                            return path.join(dirPath, randomFile)
                        }
                    } catch {
                        continue
                    }
                }
                return null
            }

            const randomFile = files[Math.floor(Math.random() * files.length)]
            return path.join(emojiDir, randomFile)
        } catch (error) {
            logger.debug(`[EmojiThief] 获取随机表情包失败: ${error.message}`)
            return null
        }
    }

    /**
     * 构建表情包消息
     */
    buildEmojiMessage(filePath) {
        return {
            type: 'image',
            file: `file://${filePath}`,
            subType: 1
        }
    }

    /**
     * 尝试触发表情包发送
     * @param {object} e 消息事件
     * @param {string} triggerSource 触发来源: 'message' | 'bym' | 'chat'
     * @returns {Promise<object|null>} 表情包消息或null
     */
    async tryTrigger(e, triggerSource = 'message') {
        if (!e.isGroup || !e.group_id) return null

        const groupId = String(e.group_id)
        const config = await this.getGroupConfig(groupId)

        if (!config.enabled) return null

        const mode = config.triggerMode
        const rate = config.triggerRate

        // 根据触发来源和模式判断是否触发
        let shouldTrigger = false

        switch (mode) {
            case 'random':
                // 随机触发 - 任何消息都可能触发
                if (triggerSource === 'message') {
                    shouldTrigger = Math.random() < rate
                }
                break

            case 'bym_follow':
                // 伪人触发跟随 - 伪人触发时100%发送
                if (triggerSource === 'bym') {
                    shouldTrigger = true
                }
                break

            case 'bym_random':
                // 伪人触发随机 - 伪人触发时按概率发送
                if (triggerSource === 'bym') {
                    shouldTrigger = Math.random() < rate
                }
                break

            case 'chat_follow':
                // 对话跟随 - AI回复时100%发送
                if (triggerSource === 'chat') {
                    shouldTrigger = true
                }
                break

            case 'chat_random':
                // 对话随机 - AI回复时按概率发送
                if (triggerSource === 'chat') {
                    shouldTrigger = Math.random() < rate
                }
                break

            case 'off':
            default:
                shouldTrigger = false
                break
        }

        if (!shouldTrigger) return null

        const emojiPath = await this.getRandomEmoji(groupId, config.separateFolder)
        if (!emojiPath) return null

        logger.debug(`[EmojiThief] 群${groupId}触发表情包发送 (mode=${mode}, source=${triggerSource})`)
        return this.buildEmojiMessage(emojiPath)
    }

    /**
     * 获取群组表情包统计
     */
    async getGroupStats(groupId) {
        await this.init()

        const config = await this.getGroupConfig(groupId)
        const emojiDir = this.getEmojiDir(groupId, config.separateFolder)

        try {
            const files = await fsp.readdir(emojiDir)
            const emojiFiles = files.filter(f => !f.endsWith('.json'))
            return {
                count: emojiFiles.length,
                maxCount: config.maxCount,
                enabled: config.enabled,
                separateFolder: config.separateFolder,
                triggerMode: config.triggerMode
            }
        } catch {
            return {
                count: 0,
                maxCount: config.maxCount,
                enabled: config.enabled,
                triggerMode: config.triggerMode
            }
        }
    }

    /**
     * 清理群组表情包
     */
    async clearGroupEmojis(groupId) {
        await this.init()

        const config = await this.getGroupConfig(groupId)
        const emojiDir = this.getEmojiDir(groupId, config.separateFolder)

        try {
            await fsp.rm(emojiDir, { recursive: true, force: true })
            logger.debug(`[EmojiThief] 已清理群${groupId}的表情包`)
            return true
        } catch (error) {
            logger.error(`[EmojiThief] 清理群${groupId}表情包失败:`, error.message)
            return false
        }
    }
}

// 导出单例
export const emojiThiefService = new EmojiThiefService()

/**
 * 表情包小偷插件
 */
export class EmojiThief extends plugin {
    constructor() {
        super({
            name: 'AI-表情包小偷',
            dsc: '收集群聊表情包并随机发送',
            event: 'message.group',
            priority: 100,
            rule: [
                {
                    reg: '',
                    fnc: 'collectAndTrigger',
                    log: false
                }
            ]
        })
    }

    async collectAndTrigger(e) {
        // 收集表情包
        await emojiThiefService.collectEmoji(e)

        // 尝试随机触发（仅限random模式）
        const emojiMsg = await emojiThiefService.tryTrigger(e, 'message')
        if (emojiMsg) {
            await e.reply(emojiMsg)
        }

        return false
    }
}
