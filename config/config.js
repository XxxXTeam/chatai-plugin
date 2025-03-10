class ChatGPTConfig {
  dataDir = 'data'
  processorsDirPath = 'utils/processors'
  toolsDirPath = 'utils/tools'
  cloudBaseUrl = ''
  cloudApiKey = ''

  embeddingModel = 'gemini-embedding-exp-03-07'
  dimensions = 0

  serverAuthKey = ''
  version = '3.0.0'
}

export default new ChatGPTConfig()
