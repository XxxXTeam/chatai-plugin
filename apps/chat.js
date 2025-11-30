import config from '../config/config.js'

/**
 * 转义正则特殊字符
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * AI Chat plugin for Yunzai
 */
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
        },
        {
          reg: '^#(结束对话|结束会话|新对话|新会话)$',
          fnc: 'endConversation'
        },
        {
          reg: '^#(清除记忆|清理记忆|删除记忆)$',
          fnc: 'clearMemory'
        },
        {
          reg: '^#(对话状态|会话状态)$',
          fnc: 'conversationStatus'
        },
        {
          reg: '^#clear$',
          fnc: 'clearHistory'
        },
        {
          reg: '^#(群聊总结|总结群聊|群消息总结)$',
          fnc: 'groupSummary'
        },
        {
          reg: '^#(个人画像|用户画像|分析我)$',
          fnc: 'userPortrait'
        },
        {
          reg: '^#(分析|画像)\\s*\\[CQ:at',
          fnc: 'userPortraitAt'
        }
      ]
    })
  }

  /**
   * 统一消息入口，动态判断触发方式
   * @param {*} e Yunzai event
   */
  async handleMessage(e) {
    // 实时读取配置
    const toggleMode = config.get('basic.toggleMode') || 'at'
    const togglePrefix = config.get('basic.togglePrefix') || '#chat'
    
    let msg = null
    let shouldTrigger = false

    // 检查 @ 触发
    if ((toggleMode === 'at' || toggleMode === 'both') && e.atBot) {
      msg = e.msg?.trim() || ''
      shouldTrigger = true
    }

    // 检查前缀触发
    if (!shouldTrigger && (toggleMode === 'prefix' || toggleMode === 'both')) {
      const rawMsg = e.msg || ''
      if (rawMsg.startsWith(togglePrefix)) {
        msg = rawMsg.slice(togglePrefix.length).trim()
        shouldTrigger = true
      }
    }

    if (!shouldTrigger) {
      return false
    }

    return this.processChat(e, msg)
  }

  /**
   * 统一的消息处理逻辑
   * @param {*} e Yunzai event
   * @param {string} msg 处理后的消息内容
   */
  async processChat(e, msg) {
    if (!msg && (!e.img || e.img.length === 0)) {
      await e.reply('请输入要说的内容或发送图片', true)
      return true
    }

    try {
      // Import services
      const { chatService } = await import('../src/services/ChatService.js')
      const { imageService } = await import('../src/services/ImageService.js')
      const { presetManager } = await import('../src/services/PresetManager.js')
      const { channelManager } = await import('../src/services/ChannelManager.js')

      // Check if any channel is configured and enabled
      await channelManager.init()
      const channels = channelManager.getAll().filter(ch => ch.enabled)
      if (channels.length === 0) {
        await e.reply('请先在管理面板中配置至少一个启用的渠道', true)
        return true
      }

      // User Identification
      const userId = e.user_id || e.sender?.user_id || 'unknown'
      const groupId = e.group_id || (e.isGroup ? e.group_id : null)

      // Build unique user ID (combine user + group if in group)
      const fullUserId = groupId ? `${groupId}_${userId}` : String(userId)

      // 检查用户是否被封禁（检查 userId 和 fullUserId）
      const { databaseService } = await import('../src/services/DatabaseService.js')
      databaseService.init()
      if (databaseService.isUserBlocked(String(userId)) || databaseService.isUserBlocked(fullUserId)) {
        logger.info(`[AI-Chat] 用户 ${fullUserId} 已被封禁`)
        return false // 静默忽略
      }

      // Process images - 直接使用图片URL
      let imageUrls = []
      
      // 方式1: 从 e.img 获取 (Yunzai 解析的图片URL数组)
      if (e.img && e.img.length > 0) {
        for (const imgUrl of e.img) {
          if (typeof imgUrl === 'string' && imgUrl.startsWith('http')) {
            imageUrls.push(imgUrl)
          }
        }
      }
      
      // 方式2: 从 e.message 获取 (icqq 原始消息)
      if (imageUrls.length === 0 && e.message) {
        for (const seg of e.message) {
          if (seg.type === 'image') {
            // icqq 图片消息格式
            const url = seg.url || seg.file
            if (url && url.startsWith('http')) {
              imageUrls.push(url)
            }
          }
        }
      }
      
      // 转换为图片内容格式
      let imageIds = []
      for (const url of imageUrls) {
        try {
          const downloaded = await imageService.downloadImage(url)
          imageIds.push(downloaded.id)
        } catch (imgError) {
          logger.warn('[AI-Chat] 图片下载失败，直接使用URL:', imgError.message)
          // 下载失败时直接使用URL
          imageIds.push({ type: 'url', url })
        }
      }

      // Get preset if configured
      const presetId = config.get('llm.defaultChatPresetId') || 'default'
      let preset = null
      if (presetId) {
        preset = presetManager.get(presetId)
      }

      const { LlmService } = await import('../src/services/LlmService.js')

      // 使用 selectModel 自动选择最佳模型
      const model = LlmService.selectModel({
        needsTools: preset?.enableTools !== false,  // 根据预设决定是否需要工具
        needsReasoning: preset?.enableReasoning,
        isRoleplay: false
      })

      // Send message using ChatService
      if (config.get('basic.showThinkingMessage') !== false) {
        await e.reply('思考中...', true)
      }

      const result = await chatService.sendMessage({
        userId: fullUserId,
        message: msg,
        images: imageIds,
        model: model,
        mode: 'chat',  // 指定模式
        preset: preset,
        presetId: presetId,
        event: e  // Pass event for tool context
      })

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
      const showThinking = config.get('thinking.showThinkingContent') !== false
      const thinkingUseForward = config.get('thinking.useForwardMsg') !== false
      const showToolLogs = config.get('tools.showCallLogs') !== false
      const toolsUseForward = config.get('tools.useForwardMsg') !== false
      const quoteReply = config.get('basic.quoteReply') !== false
      
      // 获取工具调用日志
      const toolCallLogs = result.toolCallLogs || []
      const hasToolLogs = toolCallLogs.length > 0 && showToolLogs
      const hasThinking = reasoningText && showThinking
      const canForward = e.group_id && e.bot?.pickGroup

      // 1. 先发送工具调用日志（合并转发）
      if (hasToolLogs && toolsUseForward && canForward) {
        try {
          const toolLogText = toolCallLogs.map(log => 
            `🔧 ${log.name}\n` +
            `参数: ${JSON.stringify(log.args, null, 2)}\n` +
            `结果: ${log.result}\n` +
            `耗时: ${log.duration}ms ${log.isError ? '❌' : '✅'}`
          ).join('\n\n')
          
          const forwardMsg = [{
            user_id: e.bot.uin || e.self_id,
            nickname: '工具调用日志',
            time: Math.floor(Date.now() / 1000),
            message: [toolLogText]
          }]
          await e.bot.pickGroup(e.group_id).sendForwardMsg(forwardMsg)
        } catch (err) {
          logger.warn('[AI-Chat] 工具日志转发失败:', err.message)
        }
      }

      // 2. 发送思考内容（合并转发）
      if (hasThinking && thinkingUseForward && canForward) {
        try {
          const forwardMsg = [{
            user_id: e.bot.uin || e.self_id,
            nickname: '思考过程',
            time: Math.floor(Date.now() / 1000),
            message: [reasoningText]
          }]
          await e.bot.pickGroup(e.group_id).sendForwardMsg(forwardMsg)
        } catch (err) {
          logger.warn('[AI-Chat] 思考内容转发失败:', err.message)
        }
      }

      // 3. 直接发送AI回复（普通消息）
      const replyResult = await e.reply(finalReply, quoteReply)
      
      // 自动撤回处理
      this.handleAutoRecall(e, replyResult, false)

    } catch (error) {
      // 详细错误记录到控制台
      logger.error('[AI-Chat] Error:', error)
      
      // 给用户显示简化的错误信息
      const userFriendlyError = this.formatErrorForUser(error)
      const errorResult = await e.reply(userFriendlyError, true)
      
      // 错误消息也支持自动撤回
      this.handleAutoRecall(e, errorResult, true)
    }

    return true
  }

  /**
   * 处理自动撤回
   * @param {*} e 事件对象
   * @param {*} replyResult 回复结果
   * @param {boolean} isError 是否是错误消息
   */
  handleAutoRecall(e, replyResult, isError = false) {
    const autoRecall = config.get('basic.autoRecall') || {}
    if (!autoRecall.enabled) return
    if (isError && !autoRecall.recallError) return
    
    const delay = (autoRecall.delay || 60) * 1000
    const messageId = replyResult?.message_id || replyResult?.data?.message_id
    
    if (!messageId) {
      logger.debug('[AI-Chat] 无法获取消息ID，跳过自动撤回')
      return
    }
    
    setTimeout(async () => {
      try {
        const bot = e.bot || global.Bot
        if (typeof bot?.deleteMsg === 'function') {
          await bot.deleteMsg(messageId)
          logger.debug(`[AI-Chat] 已撤回消息: ${messageId}`)
        } else if (typeof bot?.recallMsg === 'function') {
          await bot.recallMsg(messageId)
          logger.debug(`[AI-Chat] 已撤回消息: ${messageId}`)
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
   * Clear chat history (alias for endConversation)
   * @param {*} e Yunzai event
   */
  async clearHistory(e) {
    return this.endConversation(e)
  }

  /**
   * 结束当前对话/开始新对话
   * @param {*} e Yunzai event
   */
  async endConversation(e) {
    try {
      const { chatService } = await import('../src/services/ChatService.js')

      const userId = e.user_id || e.sender?.user_id || 'unknown'
      const groupId = e.group_id || (e.isGroup ? e.group_id : null)
      const fullUserId = groupId ? `${groupId}_${userId}` : userId

      await chatService.clearHistory(fullUserId)
      await e.reply('✅ 已结束当前对话，下次对话将开始新会话', true)
    } catch (error) {
      logger.error('[AI-Chat] End conversation error:', error)
      await e.reply('操作失败: ' + error.message, true)
    }

    return true
  }

  /**
   * 清除用户记忆
   * @param {*} e Yunzai event
   */
  async clearMemory(e) {
    try {
      const { memoryManager } = await import('../src/services/MemoryManager.js')

      const userId = e.user_id || e.sender?.user_id || 'unknown'
      const groupId = e.group_id || (e.isGroup ? e.group_id : null)
      const fullUserId = groupId ? `${groupId}_${userId}` : String(userId)

      await memoryManager.init()
      await memoryManager.clearMemory(fullUserId)
      await e.reply('✅ 已清除你的所有记忆数据', true)
    } catch (error) {
      logger.error('[AI-Chat] Clear memory error:', error)
      await e.reply('清除记忆失败: ' + error.message, true)
    }

    return true
  }

  /**
   * 查看对话状态
   * @param {*} e Yunzai event
   */
  async conversationStatus(e) {
    try {
      const { databaseService } = await import('../src/services/DatabaseService.js')
      const { memoryManager } = await import('../src/services/MemoryManager.js')

      const userId = e.user_id || e.sender?.user_id || 'unknown'
      const groupId = e.group_id || (e.isGroup ? e.group_id : null)
      const fullUserId = groupId ? `${groupId}_${userId}` : userId

      databaseService.init()
      await memoryManager.init()

      // 获取对话历史
      const messages = databaseService.getMessages(fullUserId, 100)
      const messageCount = messages.length

      // 获取记忆数量
      const memories = await memoryManager.getMemories(String(userId))
      const memoryCount = memories?.length || 0

      // 获取最后活动时间
      let lastActive = '无'
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1]
        if (lastMsg?.timestamp) {
          const date = new Date(lastMsg.timestamp)
          lastActive = date.toLocaleString('zh-CN')
        }
      }

      const status = [
        '📊 对话状态',
        `━━━━━━━━━━━━`,
        `💬 当前会话消息: ${messageCount} 条`,
        `🧠 记忆条目: ${memoryCount} 条`,
        `⏰ 最后活动: ${lastActive}`,
        `━━━━━━━━━━━━`,
        `💡 提示:`,
        `  #结束对话 - 开始新会话`,
        `  #清除记忆 - 清除记忆数据`
      ].join('\n')

      await e.reply(status, true)
    } catch (error) {
      logger.error('[AI-Chat] Status error:', error)
      await e.reply('获取状态失败: ' + error.message, true)
    }

    return true
  }

  /**
   * 检查功能是否可用（伪人模式限制）
   */
  checkFeatureAvailable(featureName, e) {
    const exclusiveFeatures = config.get('bym.exclusiveFeatures') || []
    const bymEnabled = config.get('bym.enable')
    
    if (exclusiveFeatures.includes(featureName) && !bymEnabled) {
      return { available: false, reason: '此功能需要开启伪人模式' }
    }
    return { available: true }
  }

  /**
   * 群聊总结
   * @param {*} e Yunzai event
   */
  async groupSummary(e) {
    if (!e.group_id) {
      await e.reply('此功能仅支持群聊', true)
      return true
    }

    // 检查功能是否启用
    if (!config.get('features.groupSummary.enabled')) {
      await e.reply('群聊总结功能未启用', true)
      return true
    }

    // 检查伪人模式限制
    const check = this.checkFeatureAvailable('groupSummary', e)
    if (!check.available) {
      await e.reply(check.reason, true)
      return true
    }

    try {
      await e.reply('正在分析群聊消息...', true)
      
      const { chatService } = await import('../src/services/ChatService.js')
      const { databaseService } = await import('../src/services/DatabaseService.js')
      
      databaseService.init()
      
      const maxMessages = config.get('features.groupSummary.maxMessages') || 100
      const groupKey = `group_${e.group_id}`
      
      // 获取群聊历史消息
      const messages = databaseService.getMessages(groupKey, maxMessages)
      
      if (messages.length < 5) {
        await e.reply('群聊消息太少，无法生成总结', true)
        return true
      }

      // 构造总结请求
      const summaryPrompt = `请总结以下群聊对话的主要内容，提取关键话题和讨论要点：\n\n${
        messages.map(m => `${m.role}: ${
          Array.isArray(m.content) 
            ? m.content.filter(c => c.type === 'text').map(c => c.text).join('') 
            : m.content
        }`).join('\n')
      }\n\n请用简洁的方式总结：
1. 主要讨论话题
2. 关键观点
3. 参与度分析`

      const result = await chatService.sendMessage({
        userId: `summary_${e.group_id}`,
        message: summaryPrompt,
        mode: 'chat'
      })

      let summaryText = ''
      if (result.response && Array.isArray(result.response)) {
        summaryText = result.response
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
      }

      if (summaryText) {
        // 使用合并转发发送
        if (e.bot?.pickGroup) {
          try {
            const forwardMsg = [{
              user_id: e.bot.uin || e.self_id,
              nickname: '群聊总结',
              time: Math.floor(Date.now() / 1000),
              message: [`📊 群聊总结 (最近${messages.length}条消息)\n\n${summaryText}`]
            }]
            await e.bot.pickGroup(e.group_id).sendForwardMsg(forwardMsg)
          } catch {
            await e.reply(`📊 群聊总结\n\n${summaryText}`, true)
          }
        } else {
          await e.reply(`📊 群聊总结\n\n${summaryText}`, true)
        }
      } else {
        await e.reply('总结生成失败', true)
      }
    } catch (error) {
      logger.error('[AI-Chat] Group summary error:', error)
      await e.reply('群聊总结失败: ' + error.message, true)
    }

    return true
  }

  /**
   * 个人画像分析（分析自己）
   * @param {*} e Yunzai event
   */
  async userPortrait(e) {
    return this._generatePortrait(e, e.user_id, e.sender?.nickname || '用户')
  }

  /**
   * 个人画像分析（@指定用户）
   * @param {*} e Yunzai event
   */
  async userPortraitAt(e) {
    const atUser = e.message?.find(m => m.type === 'at')
    if (!atUser) {
      await e.reply('请@要分析的用户', true)
      return true
    }
    return this._generatePortrait(e, atUser.qq, atUser.text?.replace('@', '') || '用户')
  }

  /**
   * 生成用户画像
   */
  async _generatePortrait(e, targetUserId, nickname) {
    // 检查功能是否启用
    if (!config.get('features.userPortrait.enabled')) {
      await e.reply('个人画像功能未启用', true)
      return true
    }

    // 检查伪人模式限制
    const check = this.checkFeatureAvailable('userPortrait', e)
    if (!check.available) {
      await e.reply(check.reason, true)
      return true
    }

    try {
      await e.reply('正在分析用户画像...', true)
      
      const { chatService } = await import('../src/services/ChatService.js')
      const { databaseService } = await import('../src/services/DatabaseService.js')
      
      databaseService.init()

      const groupId = e.group_id
      const minMessages = config.get('features.userPortrait.minMessages') || 10
      
      // 获取用户在群里的消息
      const userKey = groupId ? `${groupId}_${targetUserId}` : String(targetUserId)
      const messages = databaseService.getMessages(userKey, 200)
      
      // 过滤出用户发送的消息
      const userMessages = messages.filter(m => m.role === 'user')
      
      if (userMessages.length < minMessages) {
        await e.reply(`消息数量不足（需要至少${minMessages}条），无法生成画像`, true)
        return true
      }

      // 构造画像分析请求
      const portraitPrompt = `请根据以下用户的发言记录，分析并生成用户画像：

用户昵称：${nickname}
发言记录：
${userMessages.slice(-50).map(m => {
  const text = Array.isArray(m.content) 
    ? m.content.filter(c => c.type === 'text').map(c => c.text).join('') 
    : m.content
  return text
}).join('\n')}

请从以下维度分析：
1. 🎭 性格特点
2. 💬 说话风格
3. 🎯 兴趣爱好
4. 🧠 思维方式
5. 📊 活跃度评估
6. 🏷️ 标签总结（3-5个关键词）`

      const result = await chatService.sendMessage({
        userId: `portrait_${targetUserId}`,
        message: portraitPrompt,
        mode: 'chat'
      })

      let portraitText = ''
      if (result.response && Array.isArray(result.response)) {
        portraitText = result.response
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
      }

      if (portraitText) {
        // 使用合并转发发送
        if (e.group_id && e.bot?.pickGroup) {
          try {
            const forwardMsg = [{
              user_id: e.bot.uin || e.self_id,
              nickname: '用户画像分析',
              time: Math.floor(Date.now() / 1000),
              message: [`👤 ${nickname} 的用户画像\n\n${portraitText}`]
            }]
            await e.bot.pickGroup(e.group_id).sendForwardMsg(forwardMsg)
          } catch {
            await e.reply(`👤 ${nickname} 的用户画像\n\n${portraitText}`, true)
          }
        } else {
          await e.reply(`👤 ${nickname} 的用户画像\n\n${portraitText}`, true)
        }
      } else {
        await e.reply('画像生成失败', true)
      }
    } catch (error) {
      logger.error('[AI-Chat] User portrait error:', error)
      await e.reply('用户画像分析失败: ' + error.message, true)
    }

    return true
  }
}
