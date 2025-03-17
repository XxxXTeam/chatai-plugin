import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

class ChatGPTConfig {
  /**
   * 版本号
   * @type {string}
   */
  version = '3.0.0'

  /**
   * 基本配置
   * @type {{
   *   toggleMode: 'at' | 'prefix',
   *   debug: boolean,
   * }}
   */
  basic = {
    // 触发方式，at触发或者前缀触发
    toggleMode: 'at',
    // 触发前缀，仅在前缀触发时有效
    togglePrefix: '#chat',
    // 是否开启调试模式
    debug: false,
    // 一般命令的开头
    commandPrefix: '^#chatgpt'
  }

  /**
   * 伪人模式，基于框架实现，因此机器人开启前缀后依然需要带上前缀。
   * @type {{
   *   enable: boolean,
   *   hit: string[],
   *   probability: number,
   *   defaultPreset: string,
   *   presetPrefix?: string,
   *   presetMap: Array<{
   *     keywords: string[],
   *     presetId: string,
   *     priority: number,
   *     recall?: boolean
   *   }>,
   *   maxTokens: number,
   *   temperature: number,
   *   sendReasoning: boolean
   * }}
   * }}
   */
  bym = {
    // 开关
    enable: false,
    // 伪人必定触发词
    hit: ['bym'],
    // 不包含伪人必定触发词时的概率
    probability: 0.02,
    // 伪人模式的默认预设
    defaultPreset: '',
    // 伪人模式的预设前缀，会加在在所有其他预设前。例如此处可以用于配置通用的伪人发言风格（随意、模仿群友等），presetMap中专心配置角色设定即可
    presetPrefix: '',
    // 包含关键词与预设的对应关系。包含特定触发词使用特定的预设，按照优先级排序
    presetMap: [],
    // 如果大于0，会覆盖preset中的maxToken，用于控制伪人模式发言长度
    maxTokens: 0,
    // 如果大于等于0，会覆盖preset中的temperature，用于控制伪人模式发言随机性
    temperature: -1,
    // 是否发送思考内容
    sendReasoning: false
  }

  /**
   * 模型和对话相关配置
   * @type {{
   *   defaultModel: string,
   *   embeddingModel: string,
   *   defaultChatPresetId: string,
   *   enableCustomPreset: boolean,
   *   customPresetUserWhiteList: string[],
   *   customPresetUserBlackList: string[],
   *   promptBlockWords: string[],
   *   responseBlockWords: string[],
   *   blockStrategy: 'full' | 'mask',
   *   blockWordMask: string
   * }}
   */
  llm = {
    // 默认模型，初始化构建预设使用
    defaultModel: '',
    // 嵌入模型
    embeddingModel: 'gemini-embedding-exp-03-07',
    // 嵌入结果维度，0表示自动
    dimensions: 0,
    // 默认对话预设ID
    defaultChatPresetId: '',
    // 是否启用允许其他人切换预设
    enableCustomPreset: false,
    // 允许切换预设的用户白名单
    customPresetUserWhiteList: [],
    // 禁止切换预设的用户黑名单
    customPresetUserBlackList: [],
    // 用户对话屏蔽词
    promptBlockWords: [],
    // 机器人回复屏蔽词
    responseBlockWords: [],
    // 触发屏蔽词的策略，完全屏蔽或仅屏蔽关键词
    blockStrategy: 'full',
    // 如果blockStrategy为mask，屏蔽词的替换字符
    blockWordMask: '***'
  }

  /**
   * 管理相关配置
   * @type {{
   *   blackGroups: number[],
   *   whiteGroups: number[],
   *   blackUsers: string[],
   *   whiteUsers: string[],
   *   defaultRateLimit: number
   * }}
   */
  management = {
    blackGroups: [],
    whiteGroups: [],
    blackUsers: [],
    whiteUsers: [],
    // 默认对话速率限制，0表示不限制，数字表示每分钟最多对话次数
    defaultRateLimit: 0
  }

  /**
   * chaite相关配置
   * @type {
   * {  dataDir: string,
   *   processorsDirPath: string,
   *   toolsDirPath: string,
   *   cloudBaseUrl: string,
   *   cloudApiKey: string,
   *   authKey: string,
   *   host: string,
   *   port: number}}
   */
  chaite = {
    // 数据目录，相对于插件下
    dataDir: 'data',
    // 处理器目录，相对于插件下
    processorsDirPath: 'utils/processors',
    // 工具目录，相对于插件目录下
    toolsDirPath: 'utils/tools',
    // 云端API url
    cloudBaseUrl: '',
    // 云端API Key
    cloudApiKey: '',
    // jwt key，非必要勿修改，修改需重启
    authKey: '',
    // 管理面板监听地址
    host: '',
    // 管理面板监听端口
    port: 48370
  }

  constructor () {
    this.version = '3.0.0'
    this.watcher = null
    this.configPath = ''
  }

  /**
   * Start config file sync
   * call once!
   * @param {string} configDir Directory containing config files
   */
  startSync (configDir) {
    const jsonPath = path.join(configDir, 'config.json')
    const yamlPath = path.join(configDir, 'config.yaml')

    // Determine which config file to use
    if (fs.existsSync(jsonPath)) {
      this.configPath = jsonPath
    } else if (fs.existsSync(yamlPath)) {
      this.configPath = yamlPath
    } else {
      this.configPath = jsonPath
      this.saveToFile()
    }

    // Load initial config
    this.loadFromFile()

    // Watch for file changes
    this.watcher = fs.watchFile(this.configPath, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        this.loadFromFile()
      }
    })

    const createDeepProxy = (obj, handler) => {
      if (obj === null || typeof obj !== 'object') return obj

      for (let key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          obj[key] = createDeepProxy(obj[key], handler)
        }
      }

      return new Proxy(obj, handler)
    }

    // 创建处理器
    const handler = {
      set: (target, prop, value) => {
        if (prop !== 'watcher' && prop !== 'configPath') {
          target[prop] = typeof value === 'object' && value !== null
            ? createDeepProxy(value, handler)
            : value
          this.saveToFile()
        }
        return true
      }
    }

    // 为所有嵌套对象创建Proxy
    this.basic = createDeepProxy(this.basic, handler)
    this.bym = createDeepProxy(this.bym, handler)
    this.llm = createDeepProxy(this.llm, handler)
    this.management = createDeepProxy(this.management, handler)
    this.chaite = createDeepProxy(this.chaite, handler)

    // 返回最外层的Proxy
    return new Proxy(this, handler)
  }

  /**
   * Load config from file
   */
  loadFromFile () {
    try {
      const content = fs.readFileSync(this.configPath, 'utf8')
      const config = this.configPath.endsWith('.json')
        ? JSON.parse(content)
        : yaml.load(content)

      Object.assign(this, config)
    } catch (error) {
      console.error('Failed to load config:', error)
    }
  }

  /**
   * Save config to file
   */
  saveToFile () {
    try {
      const config = {
        version: this.version,
        basic: this.basic,
        bym: this.bym,
        llm: this.llm,
        management: this.management,
        chaite: this.chaite
      }

      const content = this.configPath.endsWith('.json')
        ? JSON.stringify(config, null, 2)
        : yaml.dump(config)

      fs.writeFileSync(this.configPath, content, 'utf8')
    } catch (error) {
      console.error('Failed to save config:', error)
    }
  }
}

export default new ChatGPTConfig()
