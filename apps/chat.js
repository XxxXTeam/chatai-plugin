import config from '../config/config.js'

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
          reg: '^#chat\\s*(.*)$',
          fnc: 'chat'
        },
        {
          reg: '^#clear$',
          fnc: 'clearHistory'
        }
      ]
    })
  }

  /**
   * Handle chat messages
   * @param {*} e Yunzai event
   */
  async chat(e) {
    const msg = e.msg.replace(/^#chat\s*/, '').trim()

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
      const presetId = config.get('llm.defaultChatPresetId')
      let preset = null
      if (presetId) {
        preset = presetManager.get(presetId)
      }

      // Determine model (use chatModel if configured, otherwise defaultModel)
      const model = config.get('llm.chatModel') || config.get('llm.defaultModel')

      // Send message using ChatService
      await e.reply('思考中...', true)

      const result = await chatService.sendMessage({
        userId: fullUserId,
        message: msg,
        images: imageIds,
        model: model,
        preset: preset
      })

      // Extract text response
      let replyText = ''
      if (result.response && Array.isArray(result.response)) {
        replyText = result.response
          .filter(c => c.type === 'text')
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

      await e.reply(replyText + usageInfo || '抱歉，我没有理解你的问题', true)

    } catch (error) {
      logger.error('[AI-Chat] Error:', error)
      await e.reply(`出错了: ${error.message}`, true)
    }

    return true
  }

  /**
   * Clear chat history
   * @param {*} e Yunzai event
   */
  async clearHistory(e) {
    try {
      const { chatService } = await import('../src/services/ChatService.js')

      const userId = e.user_id || e.sender?.user_id || 'unknown'
      const groupId = e.group_id || (e.isGroup ? e.group_id : null)
      const fullUserId = groupId ? `${groupId}_${userId}` : userId

      await chatService.clearHistory(fullUserId)
      await e.reply('已清除对话历史', true)
    } catch (error) {
      logger.error('[AI-Chat] Clear history error:', error)
      await e.reply('清除历史失败: ' + error.message, true)
    }

    return true
  }
}
