import { Chaite } from 'chaite'

/**
 * 将e中的消息转换为chaite的UserMessage
 *
 * @param e
 * @param {{
 *   handleReplyText: boolean,
 *   handleReplyImage: boolean,
 *   useRawMessage: boolean,
 *   handleAtMsg: boolean,
 *   excludeAtBot: boolean,
 *   toggleMode: 'at' | 'prefix',
 *   togglePrefix: string
 * }} options
 * @returns {Promise<import('chaite').UserMessage>}
 */
export async function intoUserMessage (e, options = {}) {
  const {
    handleReplyText = false,
    handleReplyImage = true,
    useRawMessage = false,
    handleAtMsg = true,
    excludeAtBot = false,
    toggleMode = 'at',
    togglePrefix = null
  } = options
  const contents = []
  let text = ''
  if (e.source && (handleReplyImage || handleReplyText)) {
    let seq = e.isGroup ? e.source.seq : e.source.time
    let reply = e.isGroup
      ? (await e.group.getChatHistory(seq, 1)).pop()?.message
      : (await e.friend.getChatHistory(seq, 1)).pop()?.message
    if (reply) {
      for (let val of reply) {
        if (val.type === 'image' && handleReplyImage) {
          contents.push({
            type: 'image',
            url: val.url
          })
        } else if (val.type === 'text' && handleReplyText) {
          text = `本条消息对以下消息进行了引用回复：${val.text}\n\n本条消息内容：\n`
        }
      }
    }
  }
  if (useRawMessage) {
    text += e.raw_message
  } else {
    for (let val of e.message) {
      switch (val.type) {
        case 'at': {
          if (handleAtMsg) {
            const { qq, text: atCard } = val
            if ((toggleMode === 'at' || excludeAtBot) && qq === e.bot.uin) {
              break
            }
            text += ` @${atCard || qq} `
          }
          break
        }
        case 'text': {
          text += val.text
          break
        }
        default:
      }
    }
  }
  e.message?.filter(element => element.type === 'image').forEach(element => {
    contents.push({
      type: 'image',
      url: element.url
    })
  })
  if (toggleMode === 'prefix') {
    const regex = new RegExp(`^#?(图片)?${togglePrefix}[^gpt]`)
    text = text.replace(regex, '')
  }
  if (text) {
    contents.push({
      type: 'text',
      text
    })
  }
  return {
    role: 'user',
    content: contents
  }
}

/**
 * 找到本次对话使用的预设
 * @param e
 * @param {string} presetId
 * @param {'at' | 'prefix'} toggleMode
 * @param {string} togglePrefix
 * @returns {Promise<import('chaite').ChatPreset | null>}
 */
export async function getPreset (e, presetId, toggleMode, togglePrefix) {
  const isValidChat = checkChatMsg(e, toggleMode, togglePrefix)
  const manager = Chaite.getInstance().getChatPresetManager()
  const presets = await manager.getAllPresets()
  const prefixHitPresets = presets.filter(p => e.msg.startsWith(p.prefix))
  if (!isValidChat && prefixHitPresets.length === 0) {
    return null
  }
  let preset
  // 如果不是at且不满足通用前缀，查看是否满足其他预设
  if (!isValidChat) {
    // 找到其中prefix最长的
    if (prefixHitPresets.length > 1) {
      preset = prefixHitPresets.sort((a, b) => b.prefix.length - a.prefix.length)[0]
    } else {
      preset = prefixHitPresets[0]
    }
  } else {
    // 命中at或通用前缀，直接走用户默认预设
    preset = await manager.getInstance(presetId)
  }
  // 如果没找到再查一次
  if (!preset) {
    preset = await manager.getInstance(presetId)
  }
  return preset
}

/**
 *
 * @param e
 * @param {'at' | 'prefix'} toggleMode
 * @param {string} togglePrefix
 * @returns {boolean}
 */
export function checkChatMsg (e, toggleMode, togglePrefix) {
  if (toggleMode === 'at' && (e.atBot || e.isPrivate)) {
    return true
  }
  const prefixReg = new RegExp(`^#?(图片)?${togglePrefix}[^gpt][sS]*`)
  if (toggleMode === 'prefix' && e.msg.startsWith(prefixReg)) {
    return true
  }
  return false
}
