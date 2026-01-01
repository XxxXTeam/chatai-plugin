import axios from 'axios'
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''
const SIGNATURE_SECRET = 'chatai-signature-key-2026'
function generateFingerprint(): string {
  if (typeof window === 'undefined') return ''
  
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 'unknown',
    (() => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.textBaseline = 'top'
          ctx.font = '14px Arial'
          ctx.fillText('fingerprint', 2, 2)
          return canvas.toDataURL().slice(-50)
        }
      } catch { /* ignore */ }
      return 'no-canvas'
    })()
  ]
  
  const str = components.join('|')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}
function generateNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}
let cachedFingerprint: string | null = null
function getFingerprint(): string {
  if (!cachedFingerprint && typeof window !== 'undefined') {
    cachedFingerprint = generateFingerprint()
  }
  return cachedFingerprint || ''
}
function sha256(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]
  
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n))
  const ch = (x: number, y: number, z: number) => (x & y) ^ (~x & z)
  const maj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z)
  const sigma0 = (x: number) => rotr(2, x) ^ rotr(13, x) ^ rotr(22, x)
  const sigma1 = (x: number) => rotr(6, x) ^ rotr(11, x) ^ rotr(25, x)
  const gamma0 = (x: number) => rotr(7, x) ^ rotr(18, x) ^ (x >>> 3)
  const gamma1 = (x: number) => rotr(17, x) ^ rotr(19, x) ^ (x >>> 10)
  
  const bytes: number[] = []
  for (let i = 0; i < message.length; i++) {
    const c = message.charCodeAt(i)
    if (c < 128) bytes.push(c)
    else if (c < 2048) bytes.push((c >> 6) | 192, (c & 63) | 128)
    else bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128)
  }
  
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while ((bytes.length % 64) !== 56) bytes.push(0)
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff)
  
  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]
  
  for (let i = 0; i < bytes.length; i += 64) {
    const w: number[] = []
    for (let j = 0; j < 16; j++) {
      w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) |
             (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3]
    }
    for (let j = 16; j < 64; j++) {
      w[j] = (gamma1(w[j - 2]) + w[j - 7] + gamma0(w[j - 15]) + w[j - 16]) >>> 0
    }
    
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7]
    for (let j = 0; j < 64; j++) {
      const t1 = (h + sigma1(e) + ch(e, f, g) + K[j] + w[j]) >>> 0
      const t2 = (sigma0(a) + maj(a, b, c)) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(h => h.toString(16).padStart(8, '0')).join('')
}

function generateSignature(
  method: string,
  path: string,
  timestamp: string,
  bodyHash: string,
  nonce: string
): string {
  const signatureString = `${SIGNATURE_SECRET}|${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}|${nonce}`
  return sha256(signatureString)
}

function calculateBodyHash(body: unknown): string {
  if (!body) return ''
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body)
  return sha256(bodyString)
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('chatai_token') : null
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (typeof window !== 'undefined') {
    config.headers['X-Client-Fingerprint'] = getFingerprint()
    if (config.method !== 'get') {
      const timestamp = Date.now().toString()
      const nonce = generateNonce()
      const path = config.url?.startsWith('/') ? config.url : `/${config.url || ''}`
      const bodyHash = config.data ? calculateBodyHash(config.data) : ''
      const signature = generateSignature(
        config.method?.toUpperCase() || 'GET',
        path,
        timestamp,
        bodyHash,
        nonce
      )
      
      config.headers['X-Timestamp'] = timestamp
      config.headers['X-Nonce'] = nonce
      config.headers['X-Body-Hash'] = bodyHash
      config.headers['X-Signature'] = signature
    }
  }
  
  return config
})
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        localStorage.removeItem('chatai_token')
        window.location.href = '/login/'
      }
    }
    throw error
  }
)
export const configApi = {
  get: () => api.get('/api/config'),
  update: <T extends object>(data: T) => api.post('/api/config', data as Record<string, unknown>),
  getAdvanced: () => api.get('/api/config/advanced'),
  updateAdvanced: <T extends object>(data: T) => api.put('/api/config/advanced', data as Record<string, unknown>),
}
export const channelsApi = {
  list: (withStats = false) => api.get(`/api/channels/list?withStats=${withStats}`),
  get: (id: string) => api.get(`/api/channels/${id}`),
  create: (data: Record<string, unknown>) => api.post('/api/channels', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/api/channels/${id}`, data),
  delete: (id: string) => api.delete(`/api/channels/${id}`),
  test: (data: Record<string, unknown>) => api.post('/api/channels/test', data),
  testModel: (data: { channelId: string; model: string }) => api.post('/api/channels/test-model', data),
  batchTest: (data: { channelId: string; models: string[]; concurrency?: number }) => 
    api.post('/api/channels/batch-test', data),
  fetchModels: (data: Record<string, unknown>) => api.post('/api/channels/fetch-models', data),
  getStats: () => api.get('/api/channels/stats'),
}
export const authApi = {
  login: (password: string) => api.post('/api/auth/login', { 
    password, 
    fingerprint: typeof window !== 'undefined' ? getFingerprint() : undefined 
  }),
  loginWithToken: (token: string) => api.post('/api/auth/login', { 
    token, 
    fingerprint: typeof window !== 'undefined' ? getFingerprint() : undefined 
  }),
  verifyToken: (token: string) => api.get(`/api/auth/verify-token?token=${token}`),
  generateToken: () => api.get('/api/auth/token/generate'),
}

// Conversations API
export const conversationsApi = {
  list: () => api.get('/api/conversations/list'),
  getMessages: (id: string, limit = 100) => api.get(`/api/conversations/${id}/messages?limit=${limit}`),
  delete: (id: string) => api.delete(`/api/conversations/${id}`),
  clearAll: () => api.delete('/api/conversations/clear-all'),
}
export const presetsApi = {
  list: () => api.get('/api/preset/list'),
  get: (id: string) => api.get(`/api/preset/${id}`),
  create: (data: Record<string, unknown>) => api.post('/api/preset/', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/api/preset/${id}`, data),
  delete: (id: string) => api.delete(`/api/preset/${id}`),
  setDefault: (id: string) => api.post(`/api/preset/${id}/default`),
  getPrompt: (id: string) => api.get(`/api/preset/${id}/prompt`),
  getConfig: () => api.get('/api/presets/config'),
  updateConfig: (data: Record<string, unknown>) => api.put('/api/presets/config', data),
  // 内置预设库 API
  listBuiltin: () => api.get('/api/presets/builtin'),
  getCategories: () => api.get('/api/presets/categories'),
  createFromBuiltin: (builtinId: string, overrides?: Record<string, unknown>) => 
    api.post(`/api/preset/from-builtin/${builtinId}`, overrides || {}),
  // 知识库关联
  getKnowledge: (id: string) => api.get(`/api/preset/${id}/knowledge`),
}

// Knowledge API (知识库)
export const knowledgeApi = {
  list: () => api.get('/api/knowledge'),
  get: (id: string) => api.get(`/api/knowledge/${id}`),
  create: (data: Record<string, unknown>) => api.post('/api/knowledge', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/api/knowledge/${id}`, data),
  delete: (id: string) => api.delete(`/api/knowledge/${id}`),
  search: (query: string, options?: { presetId?: string; limit?: number }) => 
    api.get('/api/knowledge/search', { params: { q: query, ...options } }),
  linkToPreset: (docId: string, presetId: string) => 
    api.post(`/api/knowledge/${docId}/link/${presetId}`),
  unlinkFromPreset: (docId: string, presetId: string) => 
    api.delete(`/api/knowledge/${docId}/link/${presetId}`),
  // 导入知识库（支持 OpenIE 等格式）
  import: (data: { 
    data: unknown; 
    format?: 'openie' | 'raw'; 
    name?: string; 
    tags?: string[];
    presetIds?: string[];
    mergeMode?: 'create' | 'merge' | 'replace';
  }) => api.post('/api/knowledge/import', data),
}

// Tools API
export const toolsApi = {
  list: () => api.get('/api/tools/list'),
  getBuiltinConfig: () => api.get('/api/tools/builtin/config'),
  updateBuiltinConfig: <T extends object>(data: T) => api.put('/api/tools/builtin/config', data as Record<string, unknown>),
  getBuiltinList: () => api.get('/api/tools/builtin/list'),
  refreshBuiltin: () => api.post('/api/tools/builtin/refresh'),
  // 工具类别和开关
  getCategories: () => api.get('/api/tools/builtin/categories'),
  toggleCategory: (category: string, enabled: boolean) => 
    api.post('/api/tools/builtin/category/toggle', { category, enabled }),
  toggleTool: (toolName: string, enabled: boolean) => 
    api.post('/api/tools/builtin/tool/toggle', { toolName, enabled }),
  // 自定义工具
  getCustom: () => api.get('/api/tools/custom'),
  createCustom: (data: Record<string, unknown>) => api.post('/api/tools/custom', data),
  updateCustom: (name: string, data: Record<string, unknown>) => api.put(`/api/tools/custom/${name}`, data),
  deleteCustom: (name: string) => api.delete(`/api/tools/custom/${name}`),
  getJs: () => api.get('/api/tools/js'),
  getJsDetail: (name: string) => api.get(`/api/tools/js/${name}`),
  updateJs: (name: string, data: Record<string, unknown>) => api.put(`/api/tools/js/${name}`, data),
  createJs: (data: Record<string, unknown>) => api.post('/api/tools/js', data),
  deleteJs: (name: string) => api.delete(`/api/tools/js/${name}`),
  reloadJs: () => api.post('/api/tools/js/reload'),
  test: (data: Record<string, unknown>) => api.post('/api/tools/test', data),
  getLogs: () => api.get('/api/tools/logs'),
  clearLogs: () => api.delete('/api/tools/logs'),
}

// MCP API
export const mcpApi = {
  listServers: () => api.get('/api/mcp/servers'),
  getServer: (name: string) => api.get(`/api/mcp/servers/${name}`),
  createServer: (data: Record<string, unknown>) => api.post('/api/mcp/servers', data),
  updateServer: (name: string, data: Record<string, unknown>) => api.put(`/api/mcp/servers/${name}`, data),
  deleteServer: (name: string) => api.delete(`/api/mcp/servers/${name}`),
  reconnectServer: (name: string) => api.post(`/api/mcp/servers/${name}/reconnect`),
  importConfig: (data: Record<string, unknown>) => api.post('/api/mcp/import', data),
  getResources: () => api.get('/api/mcp/resources'),
  readResource: (data: Record<string, unknown>) => api.post('/api/mcp/resources/read', data),
  getPrompts: () => api.get('/api/mcp/prompts'),
  getPrompt: (data: Record<string, unknown>) => api.post('/api/mcp/prompts/get', data),
}

// Context API
export const contextApi = {
  list: () => api.get('/api/context/list'),
  clear: (data: Record<string, unknown>) => api.post('/api/context/clear', data),
}

// Memory API
export const memoryApi = {
  getUsers: () => api.get('/api/memory/users'),
  get: (userId: string) => api.get(`/api/memory/${userId}`),
  create: (data: Record<string, unknown>) => api.post('/api/memory', data),
  delete: (userId: string, memoryId: string) => api.delete(`/api/memory/${userId}/${memoryId}`),
  clearAll: () => api.delete('/api/memory/clear-all'),
  clearUser: (userId: string) => api.delete(`/api/memory/${userId}`),
  search: (data: Record<string, unknown>) => api.post('/api/memory/search', data),
  // 手动触发记忆总结（覆盖式）
  summarize: (userId: string) => api.post(`/api/memory/${userId}/summarize`),
  summarizeGroup: (groupId: string) => api.post(`/api/memory/group/${groupId}/summarize`),
}

// Scope API
export const scopeApi = {
  // 用户人格（全局）
  getUsers: () => api.get('/api/scope/users'),
  getUser: (userId: string) => api.get(`/api/scope/user/${userId}`),
  updateUser: <T extends object>(userId: string, data: T) => api.put(`/api/scope/user/${userId}`, data as Record<string, unknown>),
  deleteUser: (userId: string) => api.delete(`/api/scope/user/${userId}`),
  // 群组人格
  getGroups: () => api.get('/api/scope/groups'),
  getGroup: (groupId: string) => api.get(`/api/scope/group/${groupId}`),
  updateGroup: <T extends object>(groupId: string, data: T) => api.put(`/api/scope/group/${groupId}`, data as Record<string, unknown>),
  deleteGroup: (groupId: string) => api.delete(`/api/scope/group/${groupId}`),
  // 群内用户人格
  getGroupUsers: () => api.get('/api/scope/group-users'),
  getGroupUser: (groupId: string, userId: string) => api.get(`/api/scope/group/${groupId}/user/${userId}`),
  updateGroupUser: <T extends object>(groupId: string, userId: string, data: T) => api.put(`/api/scope/group/${groupId}/user/${userId}`, data as Record<string, unknown>),
  deleteGroupUser: (groupId: string, userId: string) => api.delete(`/api/scope/group/${groupId}/user/${userId}`),
  // 私聊人格
  getPrivates: () => api.get('/api/scope/privates'),
  getPrivate: (userId: string) => api.get(`/api/scope/private/${userId}`),
  updatePrivate: <T extends object>(userId: string, data: T) => api.put(`/api/scope/private/${userId}`, data as Record<string, unknown>),
  deletePrivate: (userId: string) => api.delete(`/api/scope/private/${userId}`),
  // 群组知识库与继承
  getGroupKnowledge: (groupId: string) => api.get(`/api/scope/group/${groupId}/knowledge`),
  setGroupKnowledge: (groupId: string, knowledgeIds: string[]) => 
    api.put(`/api/scope/group/${groupId}/knowledge`, { knowledgeIds }),
  addGroupKnowledge: (groupId: string, knowledgeId: string) => 
    api.post(`/api/scope/group/${groupId}/knowledge/${knowledgeId}`),
  removeGroupKnowledge: (groupId: string, knowledgeId: string) => 
    api.delete(`/api/scope/group/${groupId}/knowledge/${knowledgeId}`),
  setGroupInheritance: (groupId: string, inheritFrom: string[]) => 
    api.put(`/api/scope/group/${groupId}/inheritance`, { inheritFrom }),
  addGroupInheritance: (groupId: string, source: string) => 
    api.post(`/api/scope/group/${groupId}/inheritance`, { source }),
  removeGroupInheritance: (groupId: string, source: string) => 
    api.delete(`/api/scope/group/${groupId}/inheritance`, { data: { source } }),
  getGroupResolved: (groupId: string) => api.get(`/api/scope/group/${groupId}/resolved`),
  getGroupBymConfig: (groupId: string, userId?: string) => 
    api.get(`/api/scope/group/${groupId}/bym-config${userId ? `?userId=${userId}` : ''}`),
  // 其他
  getEffective: (userId: string) => api.get(`/api/scope/effective/${userId}`),
  getPersonalityConfig: () => api.get('/api/config/personality'),
  updatePersonalityConfig: <T extends object>(data: T) => api.patch('/api/config/personality', data as Record<string, unknown>),
}

export const systemApi = {
  getHealth: () => api.get('/api/health'),
  getMetrics: () => api.get('/api/metrics'),
  getState: () => api.get('/api/state'),
  getServerMode: () => api.get('/api/system/server-mode'),
  setServerMode: (sharePort: boolean) => api.put('/api/system/server-mode', { sharePort }),
  restart: (type: 'reload' | 'full' = 'reload') => api.post('/api/system/restart', { type }),
  getVersion: () => api.get('/api/system/version'),
}

export const tokenApi = {
  generatePermanent: (forceNew = false) => api.post('/api/auth/token/permanent', { forceNew }),
  revokePermanent: () => api.delete('/api/auth/token/permanent'),
  getStatus: () => api.get('/api/auth/token/status'),
}
export interface ProxyProfile {
  id: string
  name: string
  type: 'http' | 'https' | 'socks5' | 'socks4'
  host: string
  port: number
  username?: string
  password?: string
  enabled: boolean
  createdAt?: number
}

export interface ProxyScope {
  enabled: boolean
  profileId: string | null
}

export interface ProxyConfig {
  enabled: boolean
  profiles: ProxyProfile[]
  scopes: {
    browser: ProxyScope
    api: ProxyScope
    channel: ProxyScope
  }
}

export const proxyApi = {
  get: () => api.get('/api/proxy'),
  update: (data: { enabled: boolean }) => api.put('/api/proxy', data),
  getProfiles: () => api.get('/api/proxy/profiles'),
  addProfile: (profile: Omit<ProxyProfile, 'id' | 'createdAt'>) => api.post('/api/proxy/profiles', profile),
  updateProfile: (id: string, updates: Partial<ProxyProfile>) => api.put(`/api/proxy/profiles/${id}`, updates),
  deleteProfile: (id: string) => api.delete(`/api/proxy/profiles/${id}`),
  setScope: (scope: 'browser' | 'api' | 'channel', profileId: string | null, enabled: boolean) => 
    api.put(`/api/proxy/scopes/${scope}`, { profileId, enabled }),
  test: (data: { profileId?: string; type?: string; host?: string; port?: number; username?: string; password?: string; testUrl?: string }) => 
    api.post('/api/proxy/test', data),
}
export const logsApi = {
  list: () => api.get('/api/logs'),
  getRecent: (lines = 100) => api.get(`/api/logs/recent?lines=${lines}`),
}
export const placeholdersApi = {
  list: () => api.get('/api/placeholders'),
  preview: (template: string, context?: Record<string, string>) => 
    api.post('/api/placeholders/preview', { template, context }),
}

export const statsApi = {
  getOverview: () => api.get('/api/stats'),
  getFull: () => api.get('/api/stats/full'),
  reset: () => api.post('/api/stats/reset'),
  getUnified: () => api.get('/api/stats/unified'),
  getToolCalls: () => api.get('/api/stats/tool-calls'),
  getToolCallRecords: (filter?: { limit?: number; toolName?: string; success?: boolean; userId?: string; groupId?: string }) => {
    const params = new URLSearchParams()
    if (filter?.limit) params.set('limit', String(filter.limit))
    if (filter?.toolName) params.set('toolName', filter.toolName)
    if (filter?.success !== undefined) params.set('success', String(filter.success))
    if (filter?.userId) params.set('userId', filter.userId)
    if (filter?.groupId) params.set('groupId', filter.groupId)
    return api.get(`/api/stats/tool-calls/records?${params.toString()}`)
  },
  getToolCallRecord: (id: string) => api.get(`/api/stats/tool-calls/record/${id}`),
  getToolCallErrors: (limit = 50) => api.get(`/api/stats/tool-calls/errors?limit=${limit}`),
  clearToolCalls: () => api.post('/api/stats/tool-calls/clear'),
}
export const usageStatsApi = {
  get: () => api.get('/api/stats/usage'),
  getRecent: (limit = 100, filter?: { source?: string; status?: string }) => {
    const params = new URLSearchParams()
    params.set('limit', String(limit))
    if (filter?.source) params.set('source', filter.source)
    if (filter?.status) params.set('status', filter.status)
    return api.get(`/api/stats/usage/recent?${params.toString()}`)
  },
  getChannelStats: (channelId: string) => api.get(`/api/stats/usage/channel/${channelId}`),
  clear: () => api.post('/api/stats/usage/clear'),
}

export const imageGenApi = {
  getPresets: () => api.get('/api/imagegen/presets'),
  reloadPresets: () => api.post('/api/imagegen/presets/reload'),
  updatePresets: (sourceName?: string) => api.post('/api/imagegen/presets/update', { sourceName }),
  getConfig: () => api.get('/api/imagegen/config'),
  updateConfig: (data: Record<string, unknown>) => api.put('/api/imagegen/config', data),
  addSource: (data: { name: string; url: string; enabled?: boolean }) => api.post('/api/imagegen/sources', data),
  deleteSource: (index: number) => api.delete(`/api/imagegen/sources/${index}`),
  addCustomPreset: (data: { keywords: string[]; prompt: string; needImage?: boolean }) => 
    api.post('/api/imagegen/custom-presets', data),
  deleteCustomPreset: (index: number) => api.delete(`/api/imagegen/custom-presets/${index}`),
  updateCustomPreset: (uid: string, data: { keywords: string[]; prompt: string; needImage?: boolean }) =>
    api.put(`/api/imagegen/custom-presets/${uid}`, data),
  updateRemotePreset: (source: string, uid: string, data: { keywords: string[]; prompt: string; needImage?: boolean }) =>
    api.put(`/api/imagegen/remote-presets/${encodeURIComponent(source)}/${uid}`, data),
  deleteRemotePreset: (source: string, uid: string) =>
    api.delete(`/api/imagegen/remote-presets/${encodeURIComponent(source)}/${uid}`),
  updateBuiltinPreset: (uid: string, data: { keywords: string[]; prompt: string; needImage?: boolean }) =>
    api.put(`/api/imagegen/builtin-presets/${uid}`, data),
  deleteBuiltinPreset: (uid: string) => api.delete(`/api/imagegen/builtin-presets/${uid}`),
}

export function getFetchHeaders(method: string, path: string, body?: unknown): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  const token = typeof window !== 'undefined' ? localStorage.getItem('chatai_token') : null
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  if (typeof window !== 'undefined') {
    headers['X-Client-Fingerprint'] = getFingerprint()
    
    if (method.toUpperCase() !== 'GET') {
      const timestamp = Date.now().toString()
      const nonce = generateNonce()
      const bodyHash = body ? calculateBodyHash(body) : ''
      const signature = generateSignature(
        method.toUpperCase(),
        path,
        timestamp,
        bodyHash,
        nonce
      )
      
      headers['X-Timestamp'] = timestamp
      headers['X-Nonce'] = nonce
      headers['X-Body-Hash'] = bodyHash
      headers['X-Signature'] = signature
    }
  }
  
  return headers
}

