import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'
import { LlmService } from './LlmService.js'
import { channelManager } from './ChannelManager.js'
import { contextManager } from './ContextManager.js'

const logger = chatLogger

/**
 * 任务类型枚举
 */
export const TaskType = {
    CHAT: 'chat',
    TOOL: 'tool',
    DRAW: 'draw',
    IMAGE_UNDERSTAND: 'image_understand',
    SEARCH: 'search',
    ROLEPLAY: 'roleplay'
}

/**
 * 执行模式
 */
export const ExecutionMode = {
    SEQUENTIAL: 'sequential',
    PARALLEL: 'parallel'
}

/**
 * 任务编排器
 * 
 * 职责：
 * 1. 分析用户意图，拆分为任务序列
 * 2. 为每个任务生成执行提示词
 * 3. 不负责具体工具选择（由工具模型自行决定）
 */
export class TaskOrchestrator {
    constructor() {
        this.initialized = false
    }

    /**
     * 分析用户请求，生成任务计划
     * 
     * @param {string} userMessage - 用户消息
     * @param {Object} options - 选项
     * @returns {Promise<{tasks: Array, executionMode: string, analysis: string}>}
     */
    async analyze(userMessage, options = {}) {
        const { 
            hasImages = false, 
            event = null, 
            conversationId = null,
            groupDispatchModel = null 
        } = options

        // 获取调度模型
        const dispatchModel = groupDispatchModel || LlmService.getDispatchModel() || LlmService.getDefaultModel()

        if (!dispatchModel) {
            logger.debug('[TaskOrchestrator] 无调度模型，使用默认计划')
            return this.createDefaultPlan(userMessage, { hasImages })
        }

        try {
            await channelManager.init()
            const channel = channelManager.getBestChannel(dispatchModel)

            if (!channel) {
                logger.warn('[TaskOrchestrator] 未找到调度渠道，使用默认计划')
                return this.createDefaultPlan(userMessage, { hasImages })
            }

            // 构建分析提示词
            const analysisPrompt = this.buildAnalysisPrompt(hasImages)

            // 获取上下文摘要
            let contextSummary = ''
            if (conversationId) {
                try {
                    const history = await contextManager.getContextHistory(conversationId, 8)
                    if (history.length > 0) {
                        const recentMessages = history.slice(-5).map(msg => {
                            const role = msg.role === 'user' ? '用户' : 'AI'
                            const text = Array.isArray(msg.content)
                                ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('').substring(0, 80)
                                : String(msg.content).substring(0, 80)
                            return `${role}: ${text}`
                        }).join('\n')
                        contextSummary = `\n\n【近期对话】\n${recentMessages}\n`
                    }
                } catch (e) {
                    logger.debug(`[TaskOrchestrator] 获取上下文失败: ${e.message}`)
                }
            }

            const client = await LlmService.createClient({
                enableTools: false,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key
            })

            const response = await client.sendMessage({
                role: 'user',
                content: [{ type: 'text', text: `${analysisPrompt}${contextSummary}\n\n用户请求：${userMessage}` }]
            }, {
                model: dispatchModel,
                maxToken: 512,
                temperature: 0.3
            })

            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''

            const plan = this.parseResponse(responseText, userMessage, { hasImages })

            logger.info(`[TaskOrchestrator] 分析完成: "${plan.analysis}", 任务=[${plan.tasks.map(t => t.type).join(',')}]`)

            return plan

        } catch (error) {
            logger.error('[TaskOrchestrator] 分析失败:', error.message)
            return this.createDefaultPlan(userMessage, { hasImages })
        }
    }

    /**
     * 构建分析提示词
     * 简洁明了，只关注任务拆分
     */
    buildAnalysisPrompt(hasImages = false) {
        return `你是任务分析器。分析用户请求，拆分为执行步骤。

## 任务类型：
- **tool** - 需要执行操作（查询信息、发消息、管理群组、获取数据等）
- **draw** - 需要生成/绘制图片
- **image_understand** - 需要理解/分析图片内容
- **search** - 需要联网搜索最新信息
- **chat** - 纯聊天对话、问答、创作

${hasImages ? '注意：用户消息包含图片。\n' : ''}
## 核心规则：
1. 涉及查询/操作的请求用 tool（如：时间、天气、群成员、发消息等）
2. 复杂请求可拆分为多个任务，按顺序排列
3. 后续任务依赖前置结果时设置 dependsOn
4. 纯闲聊/问候/创作文本用 chat

## 返回格式（仅JSON）：
{
  "analysis": "简要意图分析",
  "tasks": [
    {"type": "任务类型", "priority": 1, "prompt": "该任务的执行指令"},
    {"type": "任务类型", "priority": 2, "prompt": "执行指令", "dependsOn": 1}
  ],
  "executionMode": "sequential"
}

## 示例：
用户："随机选几个群成员，然后画他们的合照"
{"analysis":"先随机选成员，再绘制合照","tasks":[{"type":"tool","priority":1,"prompt":"随机获取几个群成员信息"},{"type":"draw","priority":2,"prompt":"根据上一步获取的成员信息，绘制群成员合照","dependsOn":1}],"executionMode":"sequential"}

用户："现在几点了"
{"analysis":"查询时间","tasks":[{"type":"tool","priority":1,"prompt":"获取当前时间"}],"executionMode":"sequential"}

用户："你好呀"
{"analysis":"问候","tasks":[{"type":"chat","priority":1,"prompt":"友好回应"}],"executionMode":"sequential"}

只返回JSON。`
    }

    /**
     * 解析响应
     */
    parseResponse(responseText, originalMessage, context = {}) {
        const { hasImages = false } = context
        const defaultPlan = this.createDefaultPlan(originalMessage, { hasImages })

        if (!responseText || typeof responseText !== 'string') {
            return defaultPlan
        }

        try {
            // 清理响应
            let cleanResponse = responseText.trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')

            const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/)
            if (!jsonMatch) {
                return this.detectIntentFallback(originalMessage, context)
            }

            let jsonStr = jsonMatch[0].replace(/,\s*([\]}])/g, '$1')
            const parsed = JSON.parse(jsonStr)

            const analysis = parsed.analysis || ''
            const executionMode = ['sequential', 'parallel'].includes(parsed.executionMode)
                ? parsed.executionMode
                : 'sequential'

            // 解析任务
            let tasks = []
            if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
                tasks = parsed.tasks.map((t, idx) => {
                    const type = [TaskType.DRAW, TaskType.IMAGE_UNDERSTAND, TaskType.TOOL, TaskType.SEARCH, TaskType.CHAT]
                        .includes(t.type) ? t.type : TaskType.CHAT

                    return {
                        type,
                        priority: t.priority || idx + 1,
                        prompt: t.prompt || t.params?.prompt || originalMessage,
                        dependsOn: t.dependsOn || null
                    }
                })
            }

            if (tasks.length === 0) {
                return this.detectIntentFallback(originalMessage, context)
            }

            return { analysis, tasks, executionMode }

        } catch (parseErr) {
            logger.debug(`[TaskOrchestrator] 解析失败: ${parseErr.message}`)
            return this.detectIntentFallback(originalMessage, context)
        }
    }

    /**
     * 意图检测回退（调度失败时使用）
     */
    detectIntentFallback(message, context = {}) {
        const { hasImages = false } = context
        const msg = (message || '').toLowerCase()

        // 图片场景
        if (hasImages) {
            return {
                analysis: '图片理解',
                tasks: [{ type: TaskType.IMAGE_UNDERSTAND, priority: 1, prompt: message }],
                executionMode: 'sequential'
            }
        }

        // 工具意图关键词
        const toolKeywords = [
            '几点', '时间', '日期', '今天', '明天', '昨天', '星期', '周几',
            '天气', '温度', '气温', '下雨', '下雪',
            '发消息', '发送', '艾特', '@', '私聊',
            '群成员', '群信息', '群列表', '踢人', '禁言',
            '查', '搜', '获取', '看看', '帮我', '告诉我',
            '随机', '抽取', '选择'
        ]

        // 绘图意图
        const drawKeywords = ['画', '绘', '生成图', '图片生成', 'draw', 'paint']

        // 搜索意图
        const searchKeywords = ['搜索', '搜一下', '最新', '新闻', '热点']

        for (const kw of drawKeywords) {
            if (msg.includes(kw)) {
                return {
                    analysis: '绘图请求',
                    tasks: [{ type: TaskType.DRAW, priority: 1, prompt: message }],
                    executionMode: 'sequential'
                }
            }
        }

        for (const kw of searchKeywords) {
            if (msg.includes(kw)) {
                return {
                    analysis: '搜索请求',
                    tasks: [{ type: TaskType.SEARCH, priority: 1, prompt: message }],
                    executionMode: 'sequential'
                }
            }
        }

        for (const kw of toolKeywords) {
            if (msg.includes(kw)) {
                return {
                    analysis: '工具请求',
                    tasks: [{ type: TaskType.TOOL, priority: 1, prompt: message }],
                    executionMode: 'sequential'
                }
            }
        }

        // 默认对话
        return {
            analysis: '对话',
            tasks: [{ type: TaskType.CHAT, priority: 1, prompt: message }],
            executionMode: 'sequential'
        }
    }

    /**
     * 创建默认计划
     */
    createDefaultPlan(userMessage, context = {}) {
        const { hasImages = false } = context

        if (hasImages) {
            return {
                analysis: '图片理解',
                tasks: [{ type: TaskType.IMAGE_UNDERSTAND, priority: 1, prompt: userMessage }],
                executionMode: 'sequential'
            }
        }

        return {
            analysis: '默认对话',
            tasks: [{ type: TaskType.CHAT, priority: 1, prompt: userMessage }],
            executionMode: 'sequential'
        }
    }

    /**
     * 判断是否应启用任务编排
     */
    static shouldUseOrchestrator() {
        return config.get('tools.dispatchFirst') !== false
    }
}

export const taskOrchestrator = new TaskOrchestrator()
