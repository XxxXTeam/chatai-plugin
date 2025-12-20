import puppeteer from 'puppeteer'
import { marked } from 'marked'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { logService } from '../stats/LogService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Markdown渲染服务 - 将Markdown转换为图片
 * 支持群聊总结、用户画像、分析报告等场景
 */
class RenderService {
    constructor() {
        this.browser = null
        this.defaultTheme = 'light'
        this.templateDir = path.join(__dirname, '../../resources/templates')
    }

    /**
     * 获取或创建浏览器实例
     */
    async getBrowser() {
        if (!this.browser || !this.browser.isConnected()) {
            this.browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                headless: true,
                timeout: 30000
            })
        }
        return this.browser
    }

    /**
     * 关闭浏览器实例
     */
    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close()
            } catch (e) {
                logger.warn('[RenderService] 关闭浏览器失败:', e.message)
            }
            this.browser = null
        }
    }

    /**
     * 清理Markdown内容（移除代码块标记等）
     * @param {string} text 
     * @returns {string}
     */
    cleanMarkdown(text) {
        if (!text) return ''
        let clean = text.trim()
        // 移除开头的 ```markdown 或 ``` 标记
        clean = clean.replace(/^```(?:markdown|md)?\s*\n?/i, '')
        // 移除结尾的 ``` 标记
        clean = clean.replace(/\n?```\s*$/i, '')
        return clean.trim()
    }

    /**
     * 保护数学公式，避免被Markdown解析器处理
     * @param {string} text 
     * @returns {{ text: string, expressions: string[] }}
     */
    protectMathExpressions(text) {
        const expressions = []
        // 保护块级公式 $$...$$
        let protected_ = text.replace(/\$\$([\s\S]+?)\$\$/g, match => {
            expressions.push(match)
            return `MATHBLOCK${expressions.length - 1}END`
        })
        // 保护行内公式 $...$
        protected_ = protected_.replace(/\$([^$\n]+?)\$/g, match => {
            expressions.push(match)
            return `MATHINLINE${expressions.length - 1}END`
        })
        return { text: protected_, expressions }
    }

    /**
     * 恢复数学公式
     * @param {string} html 
     * @param {string[]} expressions 
     * @returns {string}
     */
    restoreMathExpressions(html, expressions) {
        let restored = html
        expressions.forEach((expr, index) => {
            restored = restored.replace(`MATHBLOCK${index}END`, expr)
            restored = restored.replace(`MATHINLINE${index}END`, expr)
        })
        return restored
    }

    /**
     * 获取主题样式
     * @param {string} theme - 'light' | 'dark' | 'auto'
     * @returns {string}
     */
    getThemeStyles(theme = 'light') {
        const themes = {
            light: {
                bg: '#f7f7f7',
                containerBg: '#ffffff',
                text: '#333333',
                heading: '#1a1a1a',
                accent: '#0056b3',
                border: 'rgba(0,0,0,0.1)',
                codeBg: '#f4f4f4'
            },
            dark: {
                bg: '#1a1a2e',
                containerBg: '#16213e',
                text: '#e4e4e4',
                heading: '#ffffff',
                accent: '#4da6ff',
                border: 'rgba(255,255,255,0.1)',
                codeBg: '#0f0f23'
            }
        }
        const t = themes[theme] || themes.light
        return `
            body { 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; 
                padding: 20px; 
                background-color: ${t.bg}; 
                color: ${t.text};
                margin: 0;
            }
            h1, h2, h3, h4 { color: ${t.heading}; margin-top: 1.5em; margin-bottom: 0.5em; }
            h1 { font-size: 1.8em; border-bottom: 2px solid ${t.accent}; padding-bottom: 0.3em; }
            h2 { font-size: 1.4em; }
            h3 { font-size: 1.2em; }
            ul, ol { padding-left: 1.5em; }
            li { margin-bottom: 0.5em; line-height: 1.6; }
            strong { color: ${t.accent}; }
            p { line-height: 1.8; margin: 0.8em 0; }
            code { 
                background: ${t.codeBg}; 
                padding: 0.2em 0.4em; 
                border-radius: 4px; 
                font-size: 0.9em;
            }
            pre { 
                background: ${t.codeBg}; 
                padding: 1em; 
                border-radius: 8px; 
                overflow-x: auto;
            }
            blockquote {
                border-left: 4px solid ${t.accent};
                margin: 1em 0;
                padding: 0.5em 1em;
                background: ${t.codeBg};
                border-radius: 0 8px 8px 0;
            }
            hr { 
                border: none; 
                border-top: 1px solid ${t.border}; 
                margin: 1.5em 0;
            }
            .container { 
                max-width: 800px; 
                margin: auto; 
                background: ${t.containerBg}; 
                padding: 30px; 
                border-radius: 12px; 
                box-shadow: 0 4px 20px ${t.border};
            }
            .header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 20px;
            }
            .header-icon {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: linear-gradient(135deg, ${t.accent}, #6366f1);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 24px;
            }
            .timestamp {
                color: ${t.text};
                opacity: 0.6;
                font-size: 0.85em;
                margin-top: 20px;
                text-align: right;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 1em 0;
            }
            th, td {
                border: 1px solid ${t.border};
                padding: 0.6em 1em;
                text-align: left;
            }
            th {
                background: ${t.codeBg};
            }
        `
    }

    /**
     * 渲染Markdown为图片
     * @param {Object} options
     * @param {string} options.markdown - Markdown内容
     * @param {string} options.title - 标题
     * @param {string} options.subtitle - 副标题
     * @param {string} options.icon - 图标emoji
     * @param {string} options.theme - 主题 'light' | 'dark'
     * @param {number} options.width - 视口宽度
     * @param {boolean} options.showTimestamp - 是否显示时间戳
     * @returns {Promise<Buffer>} 图片Buffer
     */
    async renderMarkdownToImage(options) {
        const {
            markdown,
            title = '',
            subtitle = '',
            icon = '📊',
            theme = 'light',
            width = 800,
            showTimestamp = true
        } = options

        const cleanedMd = this.cleanMarkdown(markdown)
        
        // 保护数学公式
        const { text: protectedMd, expressions } = this.protectMathExpressions(cleanedMd)
        let html = marked(protectedMd)
        // 恢复数学公式
        html = this.restoreMathExpressions(html, expressions)
        
        const styles = this.getThemeStyles(theme)
        const timestamp = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
        
        // 检测是否包含数学公式
        const hasMath = expressions.length > 0

        const styledHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                ${hasMath ? `
                <!-- KaTeX CSS -->
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
                ` : ''}
                <style>
                    ${styles}
                    ${hasMath ? `.katex { font-size: 1.1em; }` : ''}
                </style>
            </head>
            <body>
                <div class="container">
                    ${title ? `
                    <div class="header">
                        <div class="header-icon">${icon}</div>
                        <div>
                            <h1 style="margin: 0; border: none; padding: 0;">${title}</h1>
                            ${subtitle ? `<p style="margin: 0.3em 0 0 0; opacity: 0.7; font-size: 0.9em;">${subtitle}</p>` : ''}
                        </div>
                    </div>
                    <hr>
                    ` : ''}
                    ${html}
                    ${showTimestamp ? `<div class="timestamp">生成时间：${timestamp}</div>` : ''}
                </div>
                ${hasMath ? `
                <!-- KaTeX JS -->
                <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
                <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
                <script>
                    document.addEventListener("DOMContentLoaded", function() {
                        renderMathInElement(document.body, {
                            delimiters: [
                                {left: '$$', right: '$$', display: true},
                                {left: '$', right: '$', display: false}
                            ],
                            throwOnError: false
                        });
                    });
                </script>
                ` : ''}
            </body>
            </html>
        `

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width, height: 600 })
            await page.setContent(styledHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染图片失败', error)
            throw error
        }
    }

    /**
     * 渲染群聊总结
     * @param {string} markdown - 总结内容
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderGroupSummary(markdown, options = {}) {
        return this.renderMarkdownToImage({
            markdown,
            title: options.title || '群聊内容总结',
            subtitle: options.subtitle || `基于最近 ${options.messageCount || '?'} 条消息`,
            icon: '💬',
            theme: options.theme || 'light',
            ...options
        })
    }

    /**
     * 渲染用户画像
     * @param {string} markdown - 画像内容
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderUserProfile(markdown, nickname, options = {}) {
        return this.renderMarkdownToImage({
            markdown,
            title: `用户画像分析`,
            subtitle: nickname,
            icon: '👤',
            theme: options.theme || 'light',
            ...options
        })
    }

    /**
     * 渲染分析报告
     * @param {string} markdown - 报告内容
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderAnalysisReport(markdown, options = {}) {
        return this.renderMarkdownToImage({
            markdown,
            title: options.title || '分析报告',
            subtitle: options.subtitle || '',
            icon: options.icon || '📈',
            theme: options.theme || 'light',
            ...options
        })
    }

    /**
     * 渲染记忆列表
     * @param {Array} memories - 记忆数组
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderMemoryList(memories, nickname, options = {}) {
        const markdown = memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
        return this.renderMarkdownToImage({
            markdown,
            title: '记忆列表',
            subtitle: nickname,
            icon: '🧠',
            theme: options.theme || 'light',
            ...options
        })
    }
}

export const renderService = new RenderService()
