/**
 * @typedef {import('./models').Feature} Feature
 * @typedef {import('./models').HistoryMessage} HistoryMessage
 * @typedef {import('./tools').Tool} Tool
 * @typedef {import('./adapter').HistoryManager} HistoryManager
 * @typedef {import('./adapter').SendMessageOption} SendMessageOption
 * @typedef {import('./processors').PostProcessor} PostProcessor
 * @typedef {import('./processors').PreProcessor} PreProcessor
 * @typedef {import('../adapters').AbstractClient} AbstractClient
 * @typedef {import('../core').Chaite} Chaite
 */

export const MultipleKeyStrategyChoice = {
    RANDOM: 'random',
    ROUND_ROBIN: 'round-robin',
    CONVERSATION_HASH: 'conversation-hash',
}

/**
 * @typedef {'random' | 'round-robin' | 'conversation-hash'} MultipleKeyStrategy
 */

export class BaseClientOptions {
    /**
     * @param {Partial<BaseClientOptions>} [options]
     */
    constructor(options) {
        if (options) {
            this.features = options.features || []
            this.tools = options.tools || []
            this.baseUrl = options.baseUrl || ''
            this.apiKey = options.apiKey || ''
            this.multipleKeyStrategy = options.multipleKeyStrategy
            this.proxy = options.proxy
            this.preProcessorIds = options.preProcessorIds
            this.postProcessorIds = options.postProcessorIds
            if (options.historyManager) {
                this.historyManager = options.historyManager
            }
            this.logger = options.logger
            this.init()
        }
    }

    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @returns {BaseClientOptions}
     */
    static create(options) {
        return options instanceof BaseClientOptions ? options : new BaseClientOptions(options)
    }

    /** @type {Promise<void>} */
    initPromise

    async ready() {
        return this.initPromise
    }

    /**
     * @param {HistoryManager} historyManager
     */
    setHistoryManager(historyManager) {
        this.historyManager = historyManager
    }

    /**
     * @param {ILogger} logger
     */
    setLogger(logger) {
        this.logger = logger
    }

    /**
     * @returns {PostProcessor[]}
     */
    getPostProcessors() {
        return this.postProcessors || []
    }

    /**
     * @returns {PreProcessor[]}
     */
    getPreProcessors() {
        return this.preProcessors || []
    }

    async init() {
        this.initPromise = (async () => {
        })()
    }

    toString() {
        const json = {
            features: this.features,
            tools: this.tools,
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
            multipleKeyStrategy: this.multipleKeyStrategy,
            proxy: this.proxy,
            // historyManager: this.historyManager,
            // logger: this.logger,
            postProcessors: this.postProcessors?.map(p => p.id),
            preProcessors: this.preProcessors?.map(p => p.id),
        }
        return JSON.stringify(json)
    }

    /**
     * @param {string} str
     * @returns {BaseClientOptions}
     */
    fromString(str) {
        const json = JSON.parse(str)
        return new BaseClientOptions(json)
    }
}

/**
 * @typedef {Object} ILogger
 * @property {(msg: object | string, ...args: never[]) => void} debug
 * @property {(msg: object | string, ...args: never[]) => void} info
 * @property {(msg: object | string, ...args: never[]) => void} warn
 * @property {(msg: object | string, ...args: never[]) => void} error
 */

export const DefaultLogger = new class DefaultLogger {
    static COLORS = {
        reset: '\x1b[0m',
        debug: '\x1b[36m', // 青色
        info: '\x1b[32m',  // 绿色
        warn: '\x1b[33m',  // 黄色
        error: '\x1b[31m', // 红色
    }

    constructor(name = 'Chaite', enableColors = true) {
        this.name = name
        this.enableColors = enableColors
    }

    formatDate() {
        const now = new Date()
        const hours = now.getHours().toString().padStart(2, '0')
        const minutes = now.getMinutes().toString().padStart(2, '0')
        const seconds = now.getSeconds().toString().padStart(2, '0')
        const milliseconds = now.getMilliseconds().toString().padStart(3, '0')

        return `${hours}:${minutes}:${seconds}.${milliseconds}`
    }

    formatMessage(level, msg, args) {
        // 格式化前缀
        const prefix = `[${this.name}][${this.formatDate()}][${level}]`

        // 格式化消息内容
        const formattedMsg = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)

        // 添加颜色（如果启用）
        if (this.enableColors) {
            const color = DefaultLogger.COLORS[level.toLowerCase()] || ''
            return `${color}${prefix}${DefaultLogger.COLORS.reset} ${formattedMsg}`
        }

        return `${prefix} ${formattedMsg}`
    }

    debug(msg, ...args) {
        console.log(this.formatMessage('DEBUG', msg, args), ...args)
    }

    error(msg, ...args) {
        console.log(this.formatMessage('ERROR', msg, args), ...args)
    }

    info(msg, ...args) {
        console.log(this.formatMessage('INFO', msg, args), ...args)
    }

    warn(msg, ...args) {
        console.log(this.formatMessage('WARN', msg, args), ...args)
    }
}()

export class ChaiteContext {
    /**
     * @param {ILogger} [logger]
     */
    constructor(logger) {
        this.logger = logger
    }

    /**
     * @param {HistoryMessage[]} histories
     */
    setHistoryMessages(histories) {
        this.historyMessages = histories
    }

    /**
     * @returns {HistoryMessage[] | undefined}
     */
    getHistoryMessages() {
        return this.historyMessages
    }

    /**
     * @param {SendMessageOption} options
     */
    setOptions(options) {
        this.options = options
    }

    /**
     * @returns {SendMessageOption | undefined}
     */
    getOptions() {
        return this.options
    }

    /**
     * @param {import('./external').EventMessage} event
     */
    setEvent(event) {
        this.event = event
    }

    /**
     * @param {Chaite} chaite
     */
    setChaite(chaite) {
        this.chaite = chaite
    }

    /**
     * @returns {import('./external').EventMessage | undefined}
     */
    getEvent() {
        return this.event
    }

    /**
     * @param {Record<string, any>} data
     */
    setData(data) {
        this.data = data
    }

    /**
     * @returns {Record<string, any> | undefined}
     */
    getData() {
        return this.data
    }

    /**
     * @param {AbstractClient} client
     */
    setClient(client) {
        this.client = client
    }

    /**
     * @returns {AbstractClient | undefined}
     */
    getClient() {
        return this.client
    }

    /**
     * @returns {Chaite}
     */
    getChaite() {
        return this.chaite
    }
}
