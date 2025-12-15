/**
 * 搜索工具
 * 网页搜索、知识检索等
 */

import fetch from 'node-fetch'

export const searchTools = [
    {
        name: 'web_search',
        description: '使用搜索引擎搜索内容（需要配置搜索API）',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                engine: { type: 'string', description: '搜索引擎：google, bing, duckduckgo', enum: ['google', 'bing', 'duckduckgo'] },
                count: { type: 'number', description: '返回结果数量，默认5' }
            },
            required: ['query']
        },
        handler: async (args, ctx) => {
            try {
                const query = args.query
                const count = args.count || 5
                const engine = args.engine || 'duckduckgo'
                
                // 使用 DuckDuckGo Instant Answer API（免费无需API Key）
                if (engine === 'duckduckgo') {
                    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
                    const response = await fetch(url)
                    const data = await response.json()
                    
                    const results = []
                    
                    // 添加摘要结果
                    if (data.Abstract) {
                        results.push({
                            title: data.Heading || 'Summary',
                            snippet: data.Abstract,
                            url: data.AbstractURL,
                            source: data.AbstractSource
                        })
                    }
                    
                    // 添加相关主题
                    if (data.RelatedTopics) {
                        for (const topic of data.RelatedTopics.slice(0, count - 1)) {
                            if (topic.Text && topic.FirstURL) {
                                results.push({
                                    title: topic.Text.split(' - ')[0] || topic.Text,
                                    snippet: topic.Text,
                                    url: topic.FirstURL
                                })
                            }
                        }
                    }
                    
                    return {
                        success: true,
                        query,
                        engine,
                        count: results.length,
                        results
                    }
                }
                
                // 其他搜索引擎需要配置 API
                return {
                    success: false,
                    error: `${engine} 搜索需要配置 API Key`,
                    suggestion: '请使用 duckduckgo 或在配置中添加搜索 API'
                }
            } catch (err) {
                return { success: false, error: `搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_wiki',
        description: '搜索维基百科',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                lang: { type: 'string', description: '语言代码，默认zh', enum: ['zh', 'en', 'ja'] }
            },
            required: ['query']
        },
        handler: async (args) => {
            try {
                const lang = args.lang || 'zh'
                const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.query)}`
                
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'ChatBot/1.0' }
                })
                
                if (!response.ok) {
                    if (response.status === 404) {
                        return { success: false, error: '未找到相关词条' }
                    }
                    throw new Error(`HTTP ${response.status}`)
                }
                
                const data = await response.json()
                
                return {
                    success: true,
                    title: data.title,
                    extract: data.extract,
                    url: data.content_urls?.desktop?.page,
                    thumbnail: data.thumbnail?.source,
                    description: data.description
                }
            } catch (err) {
                return { success: false, error: `Wiki搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_group_history',
        description: '搜索群聊历史记录中的关键词',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词' },
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                limit: { type: 'number', description: '返回数量，默认10' }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = args.group_id || e?.group_id
                
                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }
                
                const group = bot.pickGroup(parseInt(groupId))
                if (!group?.getChatHistory) {
                    return { success: false, error: '无法获取聊天记录' }
                }
                
                // 获取最近的消息
                const history = await group.getChatHistory(0, 100)
                const keyword = args.keyword.toLowerCase()
                const limit = args.limit || 10
                
                // 搜索包含关键词的消息
                const matches = []
                for (const msg of (history || []).reverse()) {
                    const content = msg.raw_message || msg.message?.map(m => m.text || '').join('') || ''
                    if (content.toLowerCase().includes(keyword)) {
                        matches.push({
                            time: msg.time,
                            user_id: msg.sender?.user_id || msg.user_id,
                            nickname: msg.sender?.nickname || msg.sender?.card || '',
                            content: content.substring(0, 200)
                        })
                        if (matches.length >= limit) break
                    }
                }
                
                return {
                    success: true,
                    keyword: args.keyword,
                    group_id: groupId,
                    count: matches.length,
                    messages: matches
                }
            } catch (err) {
                return { success: false, error: `搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'translate',
        description: '文本翻译',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要翻译的文本' },
                from: { type: 'string', description: '源语言，auto自动检测' },
                to: { type: 'string', description: '目标语言，默认zh' }
            },
            required: ['text']
        },
        handler: async (args) => {
            try {
                const text = args.text
                const targetLang = args.to || 'zh'
                
                // 使用免费翻译 API
                const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${args.from || 'auto'}|${targetLang}`
                
                const response = await fetch(url)
                const data = await response.json()
                
                if (data.responseStatus !== 200) {
                    return { success: false, error: data.responseDetails || '翻译失败' }
                }
                
                return {
                    success: true,
                    original: text,
                    translated: data.responseData.translatedText,
                    from: args.from || 'auto',
                    to: targetLang
                }
            } catch (err) {
                return { success: false, error: `翻译失败: ${err.message}` }
            }
        }
    }
]
