import axios from 'axios'
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''
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
  // 触发器配置
  getTriggers: () => api.get('/api/config/triggers'),
  updateTriggers: <T extends object>(data: T) => api.put('/api/config/triggers', data as Record<string, unknown>),
  // 上下文配置
  getContext: () => api.get('/api/config/context'),
  updateContext: <T extends object>(data: T) => api.put('/api/config/context', data as Record<string, unknown>),
  // 登录链接配置
  getLinks: () => api.get('/api/config/links'),
  updateLinks: (data: { loginLinks?: string[]; publicUrl?: string }) => api.put('/api/config/links', data),
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
  login: (password: string) => api.post('/api/auth/login', { password }),
  loginWithToken: (token: string) => api.post('/api/auth/login', { token }),
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
  getToolCallRecords: (filter?: { 
    limit?: number; 
    toolName?: string; 
    success?: boolean; 
    userId?: string; 
    groupId?: string;
    keyword?: string;
    startTime?: number;
    endTime?: number;
  }) => {
    const params = new URLSearchParams()
    if (filter?.limit) params.set('limit', String(filter.limit))
    if (filter?.toolName) params.set('toolName', filter.toolName)
    if (filter?.success !== undefined) params.set('success', String(filter.success))
    if (filter?.userId) params.set('userId', filter.userId)
    if (filter?.groupId) params.set('groupId', filter.groupId)
    if (filter?.keyword) params.set('keyword', filter.keyword)
    if (filter?.startTime) params.set('startTime', String(filter.startTime))
    if (filter?.endTime) params.set('endTime', String(filter.endTime))
    return api.get(`/api/stats/tool-calls/records?${params.toString()}`)
  },
  getToolCallRecord: (id: string) => api.get(`/api/stats/tool-calls/record/${id}`),
  getToolCallErrors: (limit = 50) => api.get(`/api/stats/tool-calls/errors?limit=${limit}`),
  clearToolCalls: () => api.post('/api/stats/tool-calls/clear'),
  // API调用统计
  getApiCalls: (params?: { page?: number; limit?: number; channelId?: string; success?: boolean; startTime?: number; endTime?: number }) => {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.limit) searchParams.set('limit', String(params.limit))
    if (params?.channelId) searchParams.set('channelId', params.channelId)
    if (params?.success !== undefined) searchParams.set('success', String(params.success))
    if (params?.startTime) searchParams.set('startTime', String(params.startTime))
    if (params?.endTime) searchParams.set('endTime', String(params.endTime))
    return api.get(`/api/stats/api-calls?${searchParams.toString()}`)
  },
  getChannelStats: () => api.get('/api/stats/channels'),
  getModelStats: () => api.get('/api/stats/models'),
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getFetchHeaders(_method: string, _path: string, _body?: unknown): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  const token = typeof window !== 'undefined' ? localStorage.getItem('chatai_token') : null
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  return headers
}

