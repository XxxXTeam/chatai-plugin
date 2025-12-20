/**
 * 网页访问工具
 * 访问网页、获取内容等
 */

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import TurndownService from 'turndown'
import fetch from 'node-fetch'
import { proxyService } from '../../services/proxy/ProxyService.js'

puppeteer.use(StealthPlugin())

/**
 * 清理HTML
 */
function cleanHTML(html) {
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')

    const allowedTags = ['title', 'meta', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'img', 'video', 'audio', 'source', 'a']
    
    html = html.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (match, tagName, attrs) => {
        tagName = tagName.toLowerCase()
        if (allowedTags.includes(tagName)) {
            if (tagName === 'img' || tagName === 'video' || tagName === 'audio' || tagName === 'source') {
                return match.replace(/<(img|video|audio|source)([^>]*)>/gi, (_, tag, attributes) => {
                    let srcMatch = attributes.match(/\bsrc=["'](?!data:)[^"']+["']/i)
                    return srcMatch ? `<${tag} ${srcMatch[0]}>` : ''
                })
            } else if (tagName === 'a') {
                return match.replace(/<a([^>]*)>/gi, (_, attributes) => {
                    let hrefMatch = attributes.match(/\bhref=["'](?!data:)[^"']+["']/i)
                    return hrefMatch ? `<a ${hrefMatch[0]}>` : ''
                })
            }
            return match
        }
        return ''
    })

    return html.replace(/\s+/g, ' ').trim()
}

/**
 * HTML转Markdown
 */
function convertToMarkdown(html) {
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced'
    })
    
    turndownService.addRule('images', {
        filter: ['img'],
        replacement: (content, node) => {
            const alt = node.alt || ''
            const src = node.getAttribute('src') || ''
            return src ? `![${alt}](${src})` : ''
        }
    })
    
    return turndownService.turndown(html)
}

export const webTools = [
    {
        name: 'website',
        description: '访问网页并获取内容（支持动态渲染）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要访问的网页URL' },
                mode: { 
                    type: 'string', 
                    description: '获取模式：text(纯文本)、markdown(Markdown格式)、html(原始HTML)', 
                    enum: ['text', 'markdown', 'html']
                },
                wait: { type: 'number', description: '等待页面加载的时间(毫秒)，默认3000' },
                selector: { type: 'string', description: '等待特定元素出现（CSS选择器）' },
                max_length: { type: 'number', description: '返回内容的最大长度，默认8000' }
            },
            required: ['url']
        },
        handler: async (args) => {
            const url = args.url
            const mode = args.mode || 'markdown'
            const waitTime = args.wait || 3000
            const maxLength = args.max_length || 8000
            
            let browser = null
            try {
                // 获取代理配置
                const proxyUrl = proxyService.getBrowserProxyArgs()
                const launchOptions = {
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                }
                
                if (proxyUrl) {
                    launchOptions.args.push(`--proxy-server=${proxyUrl}`)
                }
                
                browser = await puppeteer.launch(launchOptions)
                const page = await browser.newPage()
                
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
                await page.setViewport({ width: 1920, height: 1080 })
                
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
                
                if (args.selector) {
                    await page.waitForSelector(args.selector, { timeout: 10000 }).catch(() => {})
                }
                
                await new Promise(r => setTimeout(r, waitTime))
                
                const title = await page.title()
                let content = await page.content()
                
                await browser.close()
                browser = null
                
                // 处理内容
                let result
                if (mode === 'html') {
                    result = content.substring(0, maxLength)
                } else {
                    const cleanedHtml = cleanHTML(content)
                    if (mode === 'markdown') {
                        result = convertToMarkdown(cleanedHtml)
                    } else {
                        result = cleanedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                    }
                    result = result.substring(0, maxLength)
                }
                
                return {
                    success: true,
                    url,
                    title,
                    content: result,
                    length: result.length,
                    truncated: result.length >= maxLength
                }
            } catch (err) {
                if (browser) await browser.close().catch(() => {})
                return { success: false, error: `访问网页失败: ${err.message}`, url }
            }
        }
    },

    {
        name: 'fetch_url',
        description: '简单HTTP请求获取URL内容（不渲染JavaScript）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL地址' },
                method: { type: 'string', description: 'HTTP方法', enum: ['GET', 'POST'] },
                headers: { type: 'object', description: '请求头' },
                body: { type: 'string', description: 'POST请求体' },
                max_length: { type: 'number', description: '最大返回长度，默认8000' }
            },
            required: ['url']
        },
        handler: async (args) => {
            try {
                const maxLength = args.max_length || 8000
                const options = {
                    method: args.method || 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        ...args.headers
                    }
                }
                
                if (args.body && args.method === 'POST') {
                    options.body = args.body
                }
                
                // 获取代理
                const agent = proxyService.getApiProxyAgent(args.url)
                if (agent) options.agent = agent
                
                const response = await fetch(args.url, options)
                const contentType = response.headers.get('content-type') || ''
                
                let content
                if (contentType.includes('application/json')) {
                    content = JSON.stringify(await response.json(), null, 2)
                } else {
                    content = await response.text()
                }
                
                content = content.substring(0, maxLength)
                
                return {
                    success: true,
                    url: args.url,
                    status: response.status,
                    content_type: contentType,
                    content,
                    length: content.length,
                    truncated: content.length >= maxLength
                }
            } catch (err) {
                return { success: false, error: `请求失败: ${err.message}`, url: args.url }
            }
        }
    }
]
