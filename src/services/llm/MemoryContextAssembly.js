import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/** 记忆类工具名（与 ChatAgent 的 MEMORY_TOOL_NAMES 同口径） */
const MEMORY_TOOL_NAMES = ['save_user_memory', 'get_user_memories', 'search_user_memory', 'update_user_memory']

/** 知识图谱类工具名（与 ChatAgent 的 KNOWLEDGE_GRAPH_TOOL_NAMES 同口径） */
const KNOWLEDGE_GRAPH_TOOL_NAMES = ['kg_get_knowledge', 'kg_save_entity', 'kg_search_entities', 'kg_save_relation']

/** 记忆工具使用说明（与 ChatAgent 的 MEMORY_TOOL_GUIDE 同口径） */
const MEMORY_TOOL_GUIDE = `\n【记忆管理】
- 用户透露个人信息（名字、生日、喜好、位置、职业等），或你判断某条信息值得长期记住时，调用 save_user_memory 保存
- 用户明确说"记住""别忘了"时，必须调用 save_user_memory
- 回答涉及用户个人信息的问题前，先用 get_user_memories 或 search_user_memory 查询，不要凭空作答
- 用户纠正此前说过的信息时，用 update_user_memory 更新对应记忆，而不是再存一条新的`

/** 知识图谱工具使用说明（与 ChatAgent 的 KNOWLEDGE_GRAPH_TOOL_GUIDE 同口径） */
const KNOWLEDGE_GRAPH_TOOL_GUIDE = `\n【知识图谱维护】
- 对话中确认了用户/群成员之间的事实（身份、关系、喜好、事件等）时，用 kg_save_entity / kg_save_relation 写入图谱
- 回答涉及"你和谁是什么关系""之前说过什么"这类结构性问题前，先用 kg_search_entities 或 kg_get_knowledge 查询，不要凭空作答
- 用户纠正或推翻之前的说法时，用 kg_update_entity 更新对应实体，不要新建重复节点`

/** 工具使用原则（与 ChatAgent 的 TOOL_USAGE_PRINCIPLES 同口径，主线补充"调用工具时附带中间说明"约定） */
const TOOL_USAGE_GUIDE = `\n【工具使用】
- 请求涉及实时数据（时间、天气、群信息、用户信息、新闻等）时，先调用工具取到数据，再基于数据回答，不要凭印象作答
- 请求要求执行动作（发消息、禁言、踢人、发图、搜索等）时，直接调用对应工具
- 能通过工具拿到更准确结果时，优先调用工具
- 不确定答案时，先用搜索或相关工具查证
- 只有纯闲聊、创作、情感交流这类不需要外部数据的场景，才直接回复
- 调用工具时，尽量同时写一句简短的话说明正在做什么（如"我先查一下相关记忆"），系统会把这句话马上发给用户；多轮工具调用时每一轮都这样做`

/**
 * 组装记忆注入块（结构化优先、平铺兜底）。
 *
 * @param {Object} options - 装配选项
 * @param {string|number} options.userId - 原始用户 ID（平铺记忆回退与旧组合键读取）
 * @param {string} options.cleanUserId - 清洗后的用户 ID（结构化记忆读取）
 * @param {string|null} options.groupId - 群号，可为 null
 * @param {string} options.message - 当前用户消息（参与结构化记忆相关度排序）
 * @param {Object|null} [options.event] - 事件对象（传入平铺记忆回退）
 * @returns {Promise<string>} 可拼接进 system prompt 的块；无数据时返回 ''
 */
export async function buildMemoryBlock({ userId, cleanUserId, groupId, message, event }) {
    const { memoryService } = await import('../memory/MemoryService.js')

    try {
        const structured = await memoryService.buildMemoryContext(cleanUserId, {
            groupId,
            maxItems: 15,
            query: message || ''
        })
        if (structured) {
            return structured
        }
        logger.debug('[MemoryContextAssembly] 结构化记忆为空，回退平铺记忆')
    } catch (error) {
        logger.warn('[MemoryContextAssembly] 结构化记忆接入失败，回退平铺记忆:', error.message)
    }

    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        return await memoryManager.getMemoryContext(userId, message || '', {
            event,
            groupId,
            includeProfile: true
        })
    } catch (error) {
        logger.warn('[MemoryContextAssembly] 平铺记忆接入失败:', error.message)
        return ''
    }
}

/**
 * 组装知识图谱注入块。
 *
 * @param {Object} options - 装配选项
 * @param {string} options.userId - 用户 ID（已清洗）
 * @param {string|null} options.groupId - 群号，可为 null
 * @returns {Promise<string>} 可拼接进 system prompt 的块；无实体时返回 ''
 */
export async function buildKnowledgeGraphBlock({ userId, groupId }) {
    const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
    await knowledgeGraphService.init()
    const graphContext = knowledgeGraphService.getKnowledgeContext(userId, groupId, { maxEntities: 25 })
    return graphContext ? `\n\n${graphContext}` : ''
}

/**
 * 获取记忆/知识图谱工具使用指南文本。
 * @param {Object[]} tools - 已加载工具清单（形如 { name, function: { name } }）
 * @returns {string} 指南文本；无工具加载时返回 ''
 */
export function getMemoryToolGuides(tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
        return ''
    }

    const hasMemoryTool = tools.some(tool => {
        const name = tool?.name || tool?.function?.name || ''
        return MEMORY_TOOL_NAMES.includes(name)
    })
    const hasGraphTool = tools.some(tool => {
        const name = tool?.name || tool?.function?.name || ''
        return KNOWLEDGE_GRAPH_TOOL_NAMES.includes(name)
    })

    const guides = []
    if (hasMemoryTool) {
        guides.push(MEMORY_TOOL_GUIDE)
    }
    if (hasGraphTool) {
        guides.push(KNOWLEDGE_GRAPH_TOOL_GUIDE)
    }
    if (guides.length > 0) {
        guides.unshift(TOOL_USAGE_GUIDE)
    }
    return guides.join('\n')
}
