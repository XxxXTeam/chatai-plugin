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
    debug: false
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
    // jwt key，非必要勿修改
    authKey: '',
    // 管理面板监听地址
    host: '',
    // 管理面板监听端口
    port: 48370
  }
}

export default new ChatGPTConfig()
