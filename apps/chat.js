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
      const fullUserId = groupId ? `${groupId}_${userId}` : userId

      // Process images if any
      let imageIds = []
      if (e.img && e.img.length > 0) {
        for (const img of e.img) {
          try {
            let imageUrl = img.file || img.url

            // Handle different image formats
            if (imageUrl && imageUrl.startsWith('base64://')) {
              const base64Data = imageUrl.replace('base64://', '')
              const buffer = Buffer.from(base64Data, 'base64')
              const uploaded = await imageService.uploadImage(buffer, 'yunzai_image.png')
              imageIds.push(uploaded.id)
            } else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
              const downloaded = await imageService.downloadImage(imageUrl)
              imageIds.push(downloaded.id)
            } else if (imageUrl && require('fs').existsSync(imageUrl)) {
              const buffer = require('fs').readFileSync(imageUrl)
              const uploaded = await imageService.uploadImage(buffer, require('path').basename(imageUrl))
              imageIds.push(uploaded.id)
            }
          } catch (imgError) {
            logger.warn('[AI-Chat] Failed to process image:', imgError)
          }
        }
      }

      // Get preset if configured
      const presetId = config.get('llm.defaultChatPresetId') || 'default'
      let preset = null
      if (presetId) {
        preset = presetManager.get(presetId)
      }

      // Import LlmService for model selection
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

      // Add usage info if available
      let usageInfo = ''
      if (result.usage) {
        const { promptTokens, completionTokens, totalTokens } = result.usage
        if (totalTokens) {
          usageInfo = `\n\n[用量: ${totalTokens} tokens]`
        }
      }

      // 如果有思考内容，使用转发消息发送
      if (reasoningText && e.group_id && e.bot?.pickGroup) {
        try {
          const forwardMsg = [
            {
              user_id: e.bot.uin || e.self_id,
              nickname: '思考过程',
              time: Math.floor(Date.now() / 1000),
              message: [reasoningText]
            },
            {
              user_id: e.bot.uin || e.self_id,
              nickname: 'AI回复',
              time: Math.floor(Date.now() / 1000) + 1,
              message: [replyText + usageInfo || '抱歉，我没有理解你的问题']
            }
          ]
          await e.bot.pickGroup(e.group_id).sendForwardMsg(forwardMsg)
        } catch (forwardErr) {
          logger.warn('[AI-Chat] 转发消息发送失败，使用普通回复:', forwardErr.message)
          await e.reply(replyText + usageInfo || '抱歉，我没有理解你的问题', true)
        }
      } else {
        await e.reply(replyText + usageInfo || '抱歉，我没有理解你的问题', true)
      }

    } catch (error) {
      logger.error('[AI-Chat] Error:', error)
      await e.reply(`出错了: ${error.message}`, true)
    }

    return true
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
}
