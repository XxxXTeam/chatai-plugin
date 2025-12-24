import config from '../config/config.js'
import { cleanCQCode, parseUserMessage } from '../src/utils/messageParser.js'
import { isDebugEnabled } from './Commands.js'
import {
    escapeRegExp,
    recordSentMessage,
    markMessageProcessed,
    startProcessingMessage,
    isMessageProcessed,
    isSelfMessage,
    isReplyToBotMessage,
    getBotIds
} from '../src/utils/messageDedup.js'

export {
    recordSentMessage,
    markMessageProcessed,
    startProcessingMessage,
    isMessageProcessed,
    isSelfMessage,
    isReplyToBotMessage,
    getBotIds
}

export class Chat extends plugin {
  constructor() {
    super({
      name: 'AI-Chat',
      dsc: 'AI对话功能',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '',  // 匹配所有消息，动态判断
          fnc: 'handleMessage',
          log: false
        }
      ]
    })
  }

  /**
   * 统一消息入口（Chat.js作为高优先级入口，ChatListener作为兜底）
   * 此处主要处理@和前缀触发，其他由ChatListener处理
   */
  async handleMessage() {
    const e = this.e
    
    // 防护：忽略自身消息
    if (isSelfMessage(e)) {
      logger.debug('[Chat] 跳过: 自身消息')
      return false
    }
    
    // 已被处理则跳过
    if (isMessageProcessed(e)) {
      logger.debug('[Chat] 跳过: 已被处理')
      return false
    }
    
    // 注意：startProcessingMessage 移到触发条件判断之后调用
    // 避免在返回 false（交给 ChatListener 处理）时，消息被标记为处理中
    
    // 获取配置（优先新trigger配置）
    let triggerCfg = config.get('trigger')
    let prefixes = triggerCfg?.prefixes || []
    
    // 兼容旧配置
    if (!triggerCfg?.private) {
      const listenerConfig = config.get('listener') || {}
      prefixes = listenerConfig.triggerPrefix || ['#chat']
      if (typeof prefixes === 'string') prefixes = [prefixes]
      
      // 旧配置的群聊触发判断
      const triggerMode = listenerConfig.triggerMode || 'at'
      const groupCfg = {
        enabled: listenerConfig.groupChat?.enabled ?? true,
        at: ['at', 'both'].includes(triggerMode),
        prefix: ['prefix', 'both'].includes(triggerMode)
      }
      // 私聊配置：默认启用，默认前缀触发（与群聊一致）
      const privateCfg = {
        enabled: listenerConfig.privateChat?.enabled ?? true,
        mode: listenerConfig.privateChat?.alwaysReply ? 'always' : 'prefix'  // 默认prefix模式
      }
      triggerCfg = { private: privateCfg, group: groupCfg, prefixes }
    }
    
    // 过滤无效的 prefix 值（null, undefined, 空字符串）
    prefixes = (Array.isArray(prefixes) ? prefixes : [prefixes])
      .filter(p => p && typeof p === 'string' && p.trim())
      .map(p => p.trim())
    
    // 获取系统命令前缀，避免系统命令被当作 AI 对话触发
    const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
    const cmdPrefixEscaped = escapeRegExp(cmdPrefix)
    
    const rawMsg = cleanCQCode(e.msg || '')
    let msg = null
    let triggerReason = ''
    
    // 检查是否是系统命令（以 #ai 开头的管理命令），避免被当作 AI 对话
    if (rawMsg && new RegExp(`^${cmdPrefixEscaped}[\\u4e00-\\u9fa5a-zA-Z]`).test(rawMsg)) {
      logger.debug(`[Chat] 跳过: 系统命令 ${rawMsg.substring(0, 20)}...`)
      return false
    }
    if (!e.isGroup) {
      const privateCfg = triggerCfg.private || {}
      // 私聊未启用则跳过
      if (!privateCfg.enabled) {
        return false
      }
      
      const mode = privateCfg.mode || 'prefix'
      
      // 先检查前缀触发（优先级高于 always 模式）
      for (const prefix of prefixes) {
        if (prefix && rawMsg.startsWith(prefix)) {
          const content = rawMsg.slice(prefix.length).trimStart()
          msg = content || ''  // 允许空内容
          triggerReason = `私聊前缀[${prefix}]`
          break
        }
      }
      
      // 如果没有前缀触发
      if (msg === null) {
        if (mode === 'always') {
          // 私聊总是响应模式 - 交给 ChatListener 处理
          return false
        } else if (mode === 'prefix') {
          // 私聊前缀模式但没匹配到前缀
          return false
        } else {
          // 其他模式（off）
          return false
        }
      }
    } else {
      let groupCfg = { ...(triggerCfg.group || {}) }
      
      // 检查群组特定的触发模式配置
      try {
        const { getScopeManager } = await import('../src/services/scope/ScopeManager.js')
        const { databaseService } = await import('../src/services/storage/DatabaseService.js')
        if (!databaseService.initialized) {
          await databaseService.init()
        }
        const sm = getScopeManager(databaseService)
        await sm.init()
        const groupSettings = await sm.getGroupSettings(String(e.group_id))
        const groupTriggerMode = groupSettings?.settings?.triggerMode || groupSettings?.triggerMode
        
        // 如果群组设置了特定触发模式且不是默认，则覆盖全局配置
        if (groupTriggerMode && groupTriggerMode !== 'default') {
          if (groupTriggerMode === 'at') {
            groupCfg = { ...groupCfg, at: true, prefix: false, keyword: false, random: false }
          } else if (groupTriggerMode === 'prefix') {
            groupCfg = { ...groupCfg, at: false, prefix: true, keyword: false, random: false }
          } else if (groupTriggerMode === 'both') {
            groupCfg = { ...groupCfg, at: true, prefix: true, keyword: true, random: false }
          } else if (groupTriggerMode === 'keyword') {
            groupCfg = { ...groupCfg, at: false, prefix: false, keyword: true, random: false }
          } else if (groupTriggerMode === 'random') {
            groupCfg = { ...groupCfg, at: false, prefix: false, keyword: false, random: true }
          } else if (groupTriggerMode === 'off') {
            groupCfg = { ...groupCfg, enabled: false }
          }
          logger.debug(`[Chat] 群 ${e.group_id} 使用独立触发模式: ${groupTriggerMode}`)
        }
      } catch (err) {
        logger.debug(`[Chat] 获取群组触发配置失败: ${err.message}`)
      }
      
      // 群聊未启用则跳过
      if (!groupCfg.enabled) {
        return false
      }
      
      // 群聊：检查 @ 触发
      if (groupCfg.at && e.atBot) {
        const isReplyToBot = isReplyToBotMessage(e)
        const hasReply = !!e.source
        
        // 从消息中去除 @机器人 部分
        const cleanAtBot = (text) => {
          if (!text) return ''
          // 获取机器人QQ号
          const botId = e.self_id || e.bot?.uin || Bot?.uin
          if (!botId) return text
          
          // 去除 @机器人 的各种格式
          let cleaned = text
            // 去除 @QQ号 格式（带空格）
            .replace(new RegExp(`\\s*@${botId}\\s*`, 'g'), ' ')
            // 去除 @昵称 格式（如果有机器人昵称）
            .replace(new RegExp(`\\s*@${e.bot?.nickname || ''}\\s*`, 'gi'), ' ')
            // 清理多余空格
            .replace(/\s+/g, ' ')
            .trim()
          return cleaned
        }
        
        const cleanedMsg = cleanAtBot(rawMsg)
        
        if (isReplyToBot) {
          // 引用机器人消息：检查 replyBot 配置
          if (groupCfg.replyBot) {
            msg = cleanedMsg
            triggerReason = '引用机器人消息'
          }
          // 如果 replyBot=false，则不触发（防止重复响应）
        } else if (hasReply && !groupCfg.reply) {
          // 引用其他消息但 reply=false：仍然允许 @ 触发
          msg = cleanedMsg
          triggerReason = '@机器人(含引用)'
        } else {
          // 正常 @ 触发
          msg = cleanedMsg
          triggerReason = '@机器人'
        }
      }

      // 群聊：检查前缀触发（前缀视为@，如"残花你好"或"残花 你好"都能触发）
      if (!msg && groupCfg.prefix) {
        for (const prefix of prefixes) {
          if (prefix && rawMsg.startsWith(prefix)) {
            // 提取前缀后的内容（去除开头空格）
            const content = rawMsg.slice(prefix.length).trimStart()
            // 前缀触发成功，即使后面没有内容也触发（类似@机器人不说话）
            msg = content || ''  // 允许空内容
            triggerReason = `群聊前缀[${prefix}]`
            break
          }
        }
      }

      // 前缀触发允许空消息（类似@不说话），其他情况需要有内容
      if (msg === null || msg === undefined) {
        return false  // 交给ChatListener处理其他情况（随机、关键词等）
      }
    }
    
    // 确定要处理消息后，检查并发处理
    if (!startProcessingMessage(e)) {
      logger.debug('[Chat] 跳过: 消息正在处理中')
      return false
    }
    
    // 标记消息已处理
    markMessageProcessed(e)

    // 检测 debug 模式：
    // 1. 消息末尾包含 "debug" （单次触发）
    // 2. 通过 #chatdebug 命令开启的持久化模式
    let debugMode = isDebugEnabled(e)  // 检查持久化debug模式
    
    if (msg && /\s+debug\s*$/i.test(msg)) {
      debugMode = true
      msg = msg.replace(/\s+debug\s*$/i, '').trim()
      logger.info('[AI-Chat] Debug模式已启用(单次)')
    } else if (debugMode) {
      logger.info('[AI-Chat] Debug模式已启用(持久化)')
    }

    return this.processChat(msg, { debugMode })
  }

  /**
   * 统一的消息处理逻辑
   * @param {string} msg 处理后的消息内容
   * @param {Object} options 选项
   * @param {boolean} options.debugMode 是否启用调试模式
   */
  async processChat(msg, options = {}) {
    const e = this.e
    const { debugMode = false } = options
    const debugLogs = []  // 收集调试信息
    
    const addDebugLog = (title, content) => {
      if (debugMode) {
        debugLogs.push({ title, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) })
      }
    }

    // 使用增强的消息解析器解析引用消息和转发消息
    let parsedMessage = null
    let enhancedMsg = msg
    
    try {
      parsedMessage = await parseUserMessage(e, {
        handleReplyText: true,
        handleReplyImage: true,
        handleReplyFile: true,
        handleForward: true,
        handleAtMsg: true,
        excludeAtBot: true,
        includeSenderInfo: true,
        includeDebugInfo: debugMode
      })
      
      // 合并解析结果到消息中
      let parsedText = parsedMessage.content
        ?.filter(c => c.type === 'text')
        ?.map(c => c.text)
        ?.join('') || ''
      
      // 移除 debug 后缀（如果存在），因为 parseUserMessage 使用原始 e.message
      if (debugMode && parsedText) {
        parsedText = parsedText.replace(/\s+debug\s*$/i, '').trim()
      }
      
      // 如果解析出的文本比原始 msg 更丰富（包含引用/转发内容），使用解析结果
      // 但仅当有引用或转发时才替换，避免覆盖已清理的 msg
      if ((parsedMessage.quote || parsedMessage.forward) && parsedText.length > (msg?.length || 0)) {
        enhancedMsg = parsedText
      } else if (parsedText && !msg) {
        enhancedMsg = parsedText
      }
      
      if (debugMode) {
        addDebugLog('📝 消息解析', {
          originalMsg: msg,
          parsedText: parsedText?.substring(0, 200),
          hasQuote: !!parsedMessage.quote,
          hasForward: !!parsedMessage.forward,
          quoteSender: parsedMessage.quote?.sender?.nickname,
          quoteContent: parsedMessage.quote?.content?.substring(0, 100),
          debugInfo: parsedMessage.debug
        })
      }
    } catch {
      // 回退到原始消息
      enhancedMsg = msg
    }

    if (!enhancedMsg && (!e.img || e.img.length === 0)) {
      await this.reply('请输入要说的内容或发送图片', true)
      return true
    }

    try {
      // Import services
      const { chatService } = await import('../src/services/llm/ChatService.js')
      const { imageService } = await import('../src/services/media/ImageService.js')
      const { presetManager } = await import('../src/services/preset/PresetManager.js')
      const { channelManager } = await import('../src/services/llm/ChannelManager.js')

      // Check if any channel is configured and enabled
      await channelManager.init()
      const channels = channelManager.getAll().filter(ch => ch.enabled)
      if (channels.length === 0) {
        await this.reply('请先在管理面板中配置至少一个启用的渠道', true)
        return true
      }

      // User Identification
      const userId = e.user_id || e.sender?.user_id || 'unknown'
      const groupId = e.group_id || (e.isGroup ? e.group_id : null)

      // Build unique user ID (combine user + group if in group)
      const fullUserId = groupId ? `${groupId}_${userId}` : String(userId)
      
      // 获取隔离模式信息
      const { contextManager } = await import('../src/services/llm/ContextManager.js')
      const conversationId = contextManager.getConversationId(userId, groupId)
      
      // 检测框架和适配器
      const bot = e.bot || Bot
      const framework = bot?.bots ? 'TRSS' : 'Miao'
      let adapter = 'unknown'
      if (bot?.adapter?.name) {
        adapter = bot.adapter.name
      } else if (bot?.version?.app_name) {
        adapter = bot.version.app_name
      } else if (bot?.pickGroup && bot?.gml) {
        adapter = 'icqq'
      }
      
      addDebugLog('🖥️ 环境信息', {
        framework,
        adapter,
        botUin: bot?.uin || e.self_id,
        platform: e.platform || 'QQ'
      })
      
      addDebugLog('📋 消息信息', {
        userId,
        groupId,
        fullUserId,
        conversationId,
        isolationMode: contextManager.getIsolationMode(),
        message: msg?.substring(0, 200) + (msg?.length > 200 ? '...' : ''),
        messageLength: msg?.length || 0,
        imageCount: e.img?.length || 0
      })
      
      addDebugLog('👤 发送者信息', {
        user_id: e.sender?.user_id,
        nickname: e.sender?.nickname,
        card: e.sender?.card,
        role: e.sender?.role,
        title: e.sender?.title,
        level: e.sender?.level
      })
      
      addDebugLog('📨 消息结构', {
        hasSource: !!e.source,
        hasForward: e.message?.some(m => m.type === 'forward'),
        messageSegments: e.message?.map(m => m.type),
        sourceSeq: e.source?.seq,
        sourceMsgId: e.source?.message_id,
        atBot: e.atBot,
        isGroup: e.isGroup
      })

      // 检查用户是否被封禁（检查 userId 和 fullUserId）
      const { databaseService } = await import('../src/services/storage/DatabaseService.js')
      databaseService.init()
      if (databaseService.isUserBlocked(String(userId)) || databaseService.isUserBlocked(fullUserId)) {
        logger.info(`[AI-Chat] 用户 ${fullUserId} 已被封禁`)
        return false // 静默忽略
      }

      // Process images - 直接使用图片URL
      let imageIds = []
      
      // 方式1: 从 parsedMessage.content 获取（包括引用消息中的图片）
      if (parsedMessage?.content) {
        for (const item of parsedMessage.content) {
          if (item.type === 'image_url' && item.image_url?.url) {
            // 直接传递 image_url 对象
            imageIds.push(item)
          } else if (item.type === 'image' && item.image) {
            // base64 或其他格式
            imageIds.push(item)
          }
        }
      }
      
      // 方式2: 从 e.img 获取 (Yunzai 解析的图片URL数组)
      if (imageIds.length === 0 && e.img && e.img.length > 0) {
        for (const imgUrl of e.img) {
          if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
            imageIds.push({ type: 'image_url', image_url: { url: imgUrl } })
          }
        }
      }
      
      // 方式3: 从 e.message 获取 (icqq 原始消息)
      if (imageIds.length === 0 && e.message) {
        for (const seg of e.message) {
          if (seg.type === 'image') {
            // icqq 图片消息格式
            const url = seg.url || seg.file
            if (url && url.startsWith('http')) {
              imageIds.push({ type: 'image_url', image_url: { url } })
            }
          }
        }
      }

      // Get preset if configured
      const presetId = config.get('llm.defaultChatPresetId') || 'default'
      let preset = null
      if (presetId) {
        preset = presetManager.get(presetId)
      }

      const { LlmService } = await import('../src/services/llm/LlmService.js')

      // 使用 selectModel 自动选择最佳模型
      const model = LlmService.selectModel({
        needsTools: preset?.enableTools !== false,  // 根据预设决定是否需要工具
        needsReasoning: preset?.enableReasoning,
        isRoleplay: false
      })

      // 获取最佳渠道
      const channel = channelManager.getBestChannel(model)
      
      addDebugLog('🔧 模型与渠道', {
        selectedModel: model,
        presetId,
        presetName: preset?.name,
        channelId: channel?.id,
        channelName: channel?.name,
        adapterType: channel?.adapterType,
        baseUrl: channel?.baseUrl?.substring(0, 50)
      })

      // Send message using ChatService
      if (config.get('basic.showThinkingMessage') !== false) {
        await this.reply('思考中...', true)
      }

      // 传递 debug 模式给 ChatService
      const result = await chatService.sendMessage({
        userId: fullUserId,
        message: enhancedMsg,  // 使用enhancedMsg而不是msg，包含引用/转发解析结果
        images: imageIds,
        model: model,
        mode: 'chat',  // 指定模式
        preset: preset,
        presetId: presetId,
        event: e,  // Pass event for tool context
        debugMode  // 传递调试模式
      })
      
      // 收集调试信息
      if (debugMode && result.debugInfo) {
        const di = result.debugInfo
        
        // 1. 渠道信息
        if (di.channel) {
          addDebugLog('📡 渠道信息', {
            id: di.channel.id,
            name: di.channel.name,
            adapter: di.channel.adapterType,
            baseUrl: di.channel.baseUrl,
            priority: di.channel.priority,
            modelsCount: di.channel.modelsCount,
            models: di.channel.models?.join(', '),
            streaming: di.channel.streaming,
            llmConfig: di.channel.llmConfig,
            hasCustomHeaders: di.channel.hasCustomHeaders,
            hasTemplates: di.channel.hasTemplates
          })
        }
        
        // 2. 预设信息
        if (di.preset) {
          addDebugLog('🎭 预设信息', {
            id: di.preset.id,
            name: di.preset.name,
            hasSystemPrompt: di.preset.hasSystemPrompt,
            enableTools: di.preset.enableTools,
            enableReasoning: di.preset.enableReasoning,
            toolsConfig: di.preset.toolsConfig,
            isNewSession: di.preset.isNewSession,
            promptContext: di.preset.promptContext
          })
        }
        
        // 3. Scope 信息
        if (di.scope) {
          addDebugLog('🎯 Scope信息', {
            groupId: di.scope.groupId,
            userId: di.scope.userId,
            conversationId: di.scope.conversationId,
            isIndependent: di.scope.isIndependent,
            source: di.scope.source,
            forceIsolation: di.scope.forceIsolation,
            hasPrefixPersona: di.scope.hasPrefixPersona
          })
        }
        
        // 4. 记忆信息
        if (di.memory) {
          addDebugLog('🧠 记忆信息', {
            userMemory: di.memory.userMemory,
            groupMemory: di.memory.groupMemory
          })
        }
        
        // 5. 知识库信息
        if (di.knowledge) {
          addDebugLog('📚 知识库', {
            hasKnowledge: di.knowledge.hasKnowledge,
            length: di.knowledge.length,
            presetId: di.knowledge.presetId,
            preview: di.knowledge.preview?.substring(0, 200)
          })
        }
        
        // 6. 请求信息
        addDebugLog('📤 请求信息', {
          model: di.request?.model,
          usedModel: di.usedModel,
          fallbackUsed: di.fallbackUsed,
          conversationId: di.request?.conversationId,
          messagesCount: di.request?.messagesCount,
          historyCount: di.request?.historyCount,
          toolsCount: di.request?.toolsCount,
          systemPromptLength: di.request?.systemPromptLength,
          userMessageLength: di.request?.userMessageLength,
          imagesCount: di.request?.imagesCount,
          useStreaming: di.request?.useStreaming,
          options: di.request?.options
        })
        
        // 7. 消息结构
        if (di.request?.messagesStructure) {
          addDebugLog('📝 消息结构', di.request.messagesStructure)
        }
        
        // 8. 系统提示词完整内容
        if (di.request?.systemPromptFull) {
          addDebugLog('📋 系统提示词', di.request.systemPromptFull)
        }
        
        // 9. 上下文历史
        if (di.context) {
          addDebugLog('📜 上下文历史', {
            totalHistoryLength: di.context.totalHistoryLength,
            maxContextMessages: di.context.maxContextMessages,
            isolationMode: di.context.isolationMode,
            hasUserLabels: di.context.hasUserLabels,
            recentMessages: di.context.historyMessages
          })
        }
        
        // 10. 可用工具列表
        if (di.availableTools?.length > 0) {
          addDebugLog('🛠️ 可用工具', `共 ${di.availableTools.length} 个: ${di.availableTools.join(', ')}`)
        }
        
        // 11. 工具调用详情
        if (di.toolCalls?.length > 0) {
          addDebugLog('🔧 工具调用详情', di.toolCalls)
        }
        
        // 12. 响应信息
        addDebugLog('📥 响应信息', di.response || '无')
        
        // 13. Token用量
        addDebugLog('📊 Token用量', result.usage || '无')
        
        // 14. 耗时信息
        if (di.timing) {
          addDebugLog('⏱️ 耗时', `${di.timing.duration}ms`)
        }
      }
      
      // 添加消息解析调试信息 (引用/转发)
      if (debugMode && e.source) {
        addDebugLog('💬 引用消息', {
          hasSource: true,
          sourceSeq: e.source?.seq,
          sourceUserId: e.source?.user_id,
          sourceTime: e.source?.time
        })
      }

      // Extract text and reasoning response
      let replyText = ''
      let reasoningText = ''
      if (result.response && Array.isArray(result.response)) {
        replyText = result.response
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
        reasoningText = result.response
          .filter(c => c.type === 'reasoning')
          .map(c => c.text)
          .join('\n')
      }

      // Log usage info to console only
      if (result.usage) {
        const { promptTokens, completionTokens, totalTokens } = result.usage
        if (totalTokens) {
          logger.info(`[AI-Chat] Token用量 - 输入: ${promptTokens || 0}, 输出: ${completionTokens || 0}, 总计: ${totalTokens}`)
        }
      }

      if (!replyText) {
        // 没有回复内容时不发送任何消息
        return true
      }
      const finalReply = replyText
      // 思考适配总开关：关闭后完全不处理思考内容
      const thinkingEnabled = config.get('thinking.enabled') !== false
      // 显示思考内容：只有总开关开启时才生效
      const showThinking = thinkingEnabled && config.get('thinking.showThinkingContent') !== false
      // 思考合并转发：只有总开关开启时才生效
      const thinkingUseForward = config.get('thinking.useForwardMsg') !== false
      const showToolLogs = config.get('tools.showCallLogs') !== false
      const toolsUseForward = config.get('tools.useForwardMsg') !== false
      const quoteReply = config.get('basic.quoteReply') === true
      
      // 获取工具调用日志
      const toolCallLogs = result.toolCallLogs || []
      const hasToolLogs = toolCallLogs.length > 0 && showToolLogs
      // 只有思考适配开启时才显示思考内容
      const hasThinking = reasoningText && showThinking

      // 1. 先发送工具调用日志（合并转发）
      if (hasToolLogs && toolsUseForward) {
        try {
          const toolLogText = toolCallLogs.map(log => 
            `🔧 ${log.name}\n` +
            `参数: ${JSON.stringify(log.args, null, 2)}\n` +
            `结果: ${log.result}\n` +
            `耗时: ${log.duration}ms ${log.isError ? '❌' : '✅'}`
          ).join('\n\n')
          await this.sendForwardMsg('工具调用日志', [toolLogText])
        } catch {
          // 转发失败时忽略
        }
      }

      // 2. 发送思考内容（合并转发）
      if (hasThinking && thinkingUseForward) {
        try {
          await this.sendForwardMsg('思考过程', [reasoningText])
        } catch {
          // 转发失败时忽略
        }
      }

      // 3. 直接发送AI回复（普通消息）
      // 记录发送的消息（用于防止自身消息循环）
      recordSentMessage(finalReply)
      
      const replyResult = await this.reply(finalReply, quoteReply)
      
      // 自动撤回处理
      this.handleAutoRecall(replyResult, false)
      
      // 4. Debug模式：发送调试信息（合并转发）
      if (debugMode && debugLogs.length > 0) {
        try {
          // 添加思考内容
          if (reasoningText) {
            addDebugLog('� 思考过程', reasoningText.substring(0, 500) + (reasoningText.length > 500 ? '...' : ''))
          }
          // 添加最终回复
          addDebugLog('💬 最终回复', replyText.substring(0, 500) + (replyText.length > 500 ? '...' : ''))
          
          // 构建调试消息（格式化输出）
          const debugMessages = debugLogs.map(log => {
            let content = log.content
            // 格式化对象/数组类型的内容
            if (typeof content === 'object') {
              content = JSON.stringify(content, null, 2)
            }
            return `【${log.title}】\n${content}`
          })
          
          await this.sendForwardMsg('🔍 Debug调试信息', debugMessages)
        } catch (err) {
          logger.warn('[AI-Chat] 调试信息发送失败:', err.message)
        }
      }

    } catch (error) {
      // 给用户显示简化的错误信息
      const userFriendlyError = this.formatErrorForUser(error)
      const errorResult = await this.reply(userFriendlyError, true)
      this.handleAutoRecall(errorResult, true)
    }

    return true
  }

  /**
   * 处理自动撤回
   * @param {*} replyResult 回复结果
   * @param {boolean} isError 是否是错误消息
   */
  handleAutoRecall(replyResult, isError = false) {
    // 获取配置，严格检查 enabled 必须为 true
    const autoRecall = config.get('basic.autoRecall')
    
    // 严格检查：只有 enabled === true 时才执行撤回
    if (!autoRecall || autoRecall.enabled !== true) {
      logger.debug('[AI-Chat] 自动撤回未启用，跳过')
      return
    }
    
    // 错误消息撤回检查
    if (isError && autoRecall.recallError !== true) {
      logger.debug('[AI-Chat] 错误消息撤回未启用，跳过')
      return
    }
    
    const delay = (autoRecall.delay || 60) * 1000
    const messageId = replyResult?.message_id || replyResult?.data?.message_id
    
    if (!messageId) {
      logger.debug('[AI-Chat] 无法获取消息ID，跳过自动撤回')
      return
    }
    
    logger.debug(`[AI-Chat] 将在 ${delay/1000} 秒后撤回消息: ${messageId}`)
    
    const e = this.e
    setTimeout(async () => {
      try {
        // 再次检查配置（可能在延迟期间被修改）
        const currentConfig = config.get('basic.autoRecall')
        if (!currentConfig || currentConfig.enabled !== true) {
          logger.debug('[AI-Chat] 撤回时配置已变更，取消撤回')
          return
        }
        
        // 优先使用 this.e.bot，回退到 Bot
        const bot = e?.bot || Bot
        if (typeof bot?.deleteMsg === 'function') {
          await bot.deleteMsg(messageId)
          logger.debug(`[AI-Chat] 成功撤回消息: ${messageId}`)
        } else if (typeof bot?.recallMsg === 'function') {
          await bot.recallMsg(messageId)
          logger.debug(`[AI-Chat] 成功撤回消息: ${messageId}`)
        } else {
          logger.debug('[AI-Chat] 无可用的撤回方法')
        }
      } catch (err) {
        logger.debug(`[AI-Chat] 撤回消息失败: ${err.message}`)
      }
    }, delay)
  }

  /**
   * 将错误信息格式化为用户友好的提示
   */
  formatErrorForUser(error) {
    const msg = error.message || String(error)
    
    // API 配额/限流错误
    if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota')) {
      const retryMatch = msg.match(/retry in ([\d.]+)s/i)
      const retryTime = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60
      return `⚠️ API 请求过于频繁，请 ${retryTime} 秒后重试`
    }
    
    // 认证错误
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) {
      return '⚠️ API 认证失败，请检查 API Key 配置'
    }
    
    // 模型不存在
    if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) {
      return '⚠️ 模型不存在或不可用，请检查模型配置'
    }
    
    // 余额不足
    if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('billing')) {
      return '⚠️ API 余额不足，请检查账户'
    }
    
    // 超时
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
      return '⚠️ 请求超时，请稍后重试'
    }
    
    // 网络错误
    if (msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('fetch')) {
      return '⚠️ 网络连接失败，请检查网络'
    }
    
    // 内容过滤
    if (msg.includes('content') && (msg.includes('filter') || msg.includes('block') || msg.includes('safety'))) {
      return '⚠️ 内容被安全过滤，请换个话题'
    }
    
    // 默认：截取简短错误
    const shortMsg = msg.split('\n')[0].substring(0, 100)
    return `出错了: ${shortMsg}${msg.length > 100 ? '...' : ''}`
  }


  /**
   * 发送合并转发消息
   * @param {string} title 转发消息标题/昵称
   * @param {Array} messages 消息数组
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendForwardMsg(title, messages) {
    const e = this.e
    if (!e) return false
    
    try {
      // 获取bot信息
      const bot = e.bot || Bot
      const botId = bot?.uin || e.self_id || 10000
      const nickname = title || 'Bot'
      
      // 构建转发消息节点
      const forwardNodes = messages.map(msg => ({
        user_id: botId,
        nickname: nickname,
        message: Array.isArray(msg) ? msg : [msg]
      }))
      
      // 优先使用 e.group/e.friend 的方法
      if (e.isGroup && e.group?.makeForwardMsg) {
        const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
        if (forwardMsg) {
          await e.group.sendMsg(forwardMsg)
          return true
        }
      } else if (!e.isGroup && e.friend?.makeForwardMsg) {
        const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
        if (forwardMsg) {
          await e.friend.sendMsg(forwardMsg)
          return true
        }
      }
      
      // 回退：使用 Bot.makeForwardMsg
      if (typeof Bot?.makeForwardMsg === 'function') {
        const forwardMsg = Bot.makeForwardMsg(forwardNodes)
        if (e.group?.sendMsg) {
          await e.group.sendMsg(forwardMsg)
          return true
        } else if (e.friend?.sendMsg) {
          await e.friend.sendMsg(forwardMsg)
          return true
        }
      }
      
      // 最终回退：直接使用 pickGroup/pickFriend
      if (e.isGroup && bot?.pickGroup) {
        const group = bot.pickGroup(e.group_id)
        if (group?.sendForwardMsg) {
          await group.sendForwardMsg(forwardNodes)
          return true
        }
      }
      
      return false
    } catch (err) {
      logger.debug('[Chat] sendForwardMsg failed:', err.message)
      return false
    }
  }

  /**
   * 获取消息（支持引用消息获取）
   * @param {string} messageId 消息ID
   * @returns {Promise<Object|null>} 消息对象
   */
  async getMessage(messageId) {
    const e = this.e
    if (!e || !messageId) return null
    
    try {
      const bot = e.bot || Bot
      
      // 尝试多种方式获取消息
      if (typeof bot?.getMsg === 'function') {
        return await bot.getMsg(messageId)
      }
      if (typeof bot?.getMessage === 'function') {
        return await bot.getMessage(messageId)
      }
      if (e.group && typeof e.group?.getChatHistory === 'function') {
        const history = await e.group.getChatHistory(messageId, 1)
        return history?.[0] || null
      }
      
      return null
    } catch (err) {
      logger.debug('[Chat] getMessage failed:', err.message)
      return null
    }
  }

  /**
   * 发送私聊消息
   * @param {string|number} userId 用户ID
   * @param {string|Array} msg 消息内容
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendPrivateMsg(userId, msg) {
    try {
      const bot = this.e?.bot || Bot
      
      if (typeof bot?.sendPrivateMsg === 'function') {
        await bot.sendPrivateMsg(userId, msg)
        return true
      }
      if (typeof bot?.pickFriend === 'function') {
        const friend = bot.pickFriend(userId)
        if (friend?.sendMsg) {
          await friend.sendMsg(msg)
          return true
        }
      }
      if (typeof Bot?.sendFriendMsg === 'function') {
        await Bot.sendFriendMsg(bot?.uin, userId, msg)
        return true
      }
      
      return false
    } catch (err) {
      logger.debug('[Chat] sendPrivateMsg failed:', err.message)
      return false
    }
  }

}
