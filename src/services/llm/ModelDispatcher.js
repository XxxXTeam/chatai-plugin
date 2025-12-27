import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'
import { LlmService } from './LlmService.js'
import { channelManager } from '../../core/lib/ChannelManager.js'

const logger = chatLogger

/**
 * 任务类型枚举
 */
export const TaskType = {
    CHAT: 'chat',           // 普通对话
    TOOL: 'tool',           // 工具调用
    DRAW: 'draw',           // 绘图生成
    IMAGE_UNDERSTAND: 'image_understand',  // 图像理解
    SEARCH: 'search',       // 联网搜索
    ROLEPLAY: 'roleplay'    // 伪人回复
}

/**
 * 任务执行模式
 */
export const ExecutionMode = {
    SEQUENTIAL: 'sequential',  // 串行执行
    PARALLEL: 'parallel'       // 并行执行
}

/**
 * 多模型调度器
 * 负责分析用户需求，构建工作列表，调度多个模型执行
 */
export class ModelDispatcher {
    constructor() {
        this.initialized = false
    }

    /**
     * 分析用户输入，生成任务工作列表
     * @param {string} userMessage - 用户消息
     * @param {Object} context - 上下文信息
     * @returns {Promise<{tasks: Array, executionMode: string, analysis: string}>}
     */
    async analyzeAndPlan(userMessage, context = {}) {
        const { hasImages = false, event = null } = context
        
        // 获取调度模型
        const dispatchModel = LlmService.selectModel({ isDispatch: true })
        
        if (!dispatchModel) {
            logger.debug('[ModelDispatcher] 未配置调度模型，使用默认单任务模式')
            return this.createDefaultPlan(userMessage, context)
        }

        try {
            await channelManager.init()
            const channel = channelManager.getBestChannel(dispatchModel)
            
            if (!channel) {
                logger.warn('[ModelDispatcher] 未找到调度模型渠道，使用默认计划')
                return this.createDefaultPlan(userMessage, context)
            }

            const analysisPrompt = this.buildAnalysisPrompt(hasImages)
            
            const clientOptions = {
                enableTools: false,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key
            }
            
            const client = await LlmService.createClient(clientOptions)
            
            const response = await client.sendMessage({
                role: 'user',
                content: [{ type: 'text', text: `${analysisPrompt}\n\n用户输入：${userMessage}` }]
            }, {
                model: dispatchModel,
                maxToken: 1024,
                temperature: 0.3
            })
            
            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            const plan = this.parseAnalysisResponse(responseText, context)
            
            logger.debug(`[ModelDispatcher] 分析结果: ${JSON.stringify(plan)}`)
            
            return plan
            
        } catch (error) {
            logger.error('[ModelDispatcher] 分析失败:', error.message)
            return this.createDefaultPlan(userMessage, context)
        }
    }

    /**
     * 构建需求分析提示词
     */
    buildAnalysisPrompt(hasImages = false) {
        const capabilities = [
            { type: 'chat', name: '对话', desc: '普通聊天回复，不需要特殊能力' },
            { type: 'tool', name: '工具调用', desc: '需要执行操作如查时间、发消息、管理群组等' },
            { type: 'draw', name: '绘图', desc: '需要生成/绘制/画图片' },
            { type: 'image_understand', name: '图像理解', desc: '需要分析/理解/描述图片内容' },
            { type: 'search', name: '联网搜索', desc: '需要查询最新信息、新闻、实时数据' },
            { type: 'roleplay', name: '角色扮演', desc: '需要模拟特定角色或人格回复' }
        ]

        let prompt = `你是一个任务分析器。请分析用户的输入，判断需要哪些能力来完成任务。

可用能力类型：
${capabilities.map(c => `- ${c.type}: ${c.name} - ${c.desc}`).join('\n')}

${hasImages ? '注意：用户消息中包含图片。\n' : ''}

分析规则：
1. 判断用户真正的需求，可能需要多个能力组合
2. 如果需要多个能力，判断它们是否可以并行执行
3. 某些任务有依赖关系需要串行，如：先理解图片再根据内容绘图
4. 纯闲聊只需要 chat

请返回JSON格式：
{
    "analysis": "简要分析用户意图",
    "tasks": [
        {"type": "任务类型", "priority": 1, "params": {"prompt": "该任务的具体提示词"}}
    ],
    "executionMode": "sequential 或 parallel",
    "needsToolGroups": [工具组索引数组，如果需要工具]
}

示例：
用户说"帮我画一只猫"
{"analysis": "用户需要生成猫的图片", "tasks": [{"type": "draw", "priority": 1, "params": {"prompt": "一只猫"}}], "executionMode": "sequential", "needsToolGroups": []}

用户说"这张图片里有什么？然后帮我画一张类似的"
{"analysis": "用户需要先理解图片，再根据理解结果生成类似图片", "tasks": [{"type": "image_understand", "priority": 1, "params": {"prompt": "描述图片内容"}}, {"type": "draw", "priority": 2, "params": {"prompt": "根据上一步结果生成"}}], "executionMode": "sequential", "needsToolGroups": []}

只返回JSON，不要其他内容。`

        return prompt
    }

    /**
     * 解析分析响应
     */
    parseAnalysisResponse(responseText, context = {}) {
        try {
            // 提取 JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                
                // 验证并规范化任务
                const tasks = (parsed.tasks || []).map((task, index) => ({
                    type: task.type || TaskType.CHAT,
                    priority: task.priority || index + 1,
                    params: task.params || {},
                    model: this.getModelForTask(task.type)
                }))
                
                return {
                    analysis: parsed.analysis || '',
                    tasks: tasks.length > 0 ? tasks : [{ type: TaskType.CHAT, priority: 1, params: {}, model: LlmService.getChatModel() }],
                    executionMode: parsed.executionMode || ExecutionMode.SEQUENTIAL,
                    needsToolGroups: parsed.needsToolGroups || []
                }
            }
        } catch (error) {
            logger.debug('[ModelDispatcher] 解析响应失败:', error.message)
        }
        
        return this.createDefaultPlan('', context)
    }

    /**
     * 根据任务类型获取对应模型
     */
    getModelForTask(taskType) {
        switch (taskType) {
            case TaskType.DRAW:
                return LlmService.getDrawModel() || LlmService.getDefaultModel()
            case TaskType.IMAGE_UNDERSTAND:
                return LlmService.getImageModel() || LlmService.getDefaultModel()
            case TaskType.SEARCH:
                return LlmService.getSearchModel() || LlmService.getDefaultModel()
            case TaskType.ROLEPLAY:
                return LlmService.getRoleplayModel() || LlmService.getDefaultModel()
            case TaskType.TOOL:
                return LlmService.getToolModel() || LlmService.getDefaultModel()
            case TaskType.CHAT:
            default:
                return LlmService.getChatModel() || LlmService.getDefaultModel()
        }
    }

    /**
     * 创建默认计划（单任务模式）
     */
    createDefaultPlan(userMessage, context = {}) {
        const { hasImages = false, isRoleplay = false, needsSearch = false } = context
        
        let taskType = TaskType.CHAT
        
        if (hasImages) {
            taskType = TaskType.IMAGE_UNDERSTAND
        } else if (isRoleplay) {
            taskType = TaskType.ROLEPLAY
        } else if (needsSearch) {
            taskType = TaskType.SEARCH
        }
        
        return {
            analysis: '默认单任务模式',
            tasks: [{
                type: taskType,
                priority: 1,
                params: { prompt: userMessage },
                model: this.getModelForTask(taskType)
            }],
            executionMode: ExecutionMode.SEQUENTIAL,
            needsToolGroups: []
        }
    }

    /**
     * 执行任务计划
     * @param {Object} plan - 任务计划
     * @param {Object} context - 执行上下文
     * @returns {Promise<Array>} 执行结果数组
     */
    async executePlan(plan, context = {}) {
        const { tasks, executionMode } = plan
        
        if (!tasks || tasks.length === 0) {
            return []
        }
        
        // 按优先级排序
        const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority)
        
        if (executionMode === ExecutionMode.PARALLEL) {
            // 并行执行所有任务
            logger.debug(`[ModelDispatcher] 并行执行 ${sortedTasks.length} 个任务`)
            const results = await Promise.all(
                sortedTasks.map(task => this.executeTask(task, context))
            )
            return results
        } else {
            // 串行执行，后续任务可以使用前面的结果
            logger.debug(`[ModelDispatcher] 串行执行 ${sortedTasks.length} 个任务`)
            const results = []
            let previousResult = null
            
            for (const task of sortedTasks) {
                // 将前一个任务的结果传递给当前任务
                const taskContext = {
                    ...context,
                    previousResult
                }
                
                const result = await this.executeTask(task, taskContext)
                results.push(result)
                previousResult = result
            }
            
            return results
        }
    }

    /**
     * 执行单个任务
     */
    async executeTask(task, context = {}) {
        const { type, params, model } = task
        const startTime = Date.now()
        
        logger.debug(`[ModelDispatcher] 执行任务: type=${type}, model=${model}`)
        
        try {
            // 这里返回任务配置，由 ChatService 实际执行
            // 因为需要访问完整的对话上下文和工具系统
            return {
                success: true,
                taskType: type,
                model,
                params,
                previousResult: context.previousResult,
                duration: Date.now() - startTime
            }
        } catch (error) {
            logger.error(`[ModelDispatcher] 任务执行失败:`, error.message)
            return {
                success: false,
                taskType: type,
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 判断是否需要多模型调度
     */
    static shouldUseDispatcher() {
        return config.get('tools.useToolGroups') === true && 
               config.get('tools.dispatchFirst') === true
    }
}

export const modelDispatcher = new ModelDispatcher()
