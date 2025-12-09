import axios from 'axios'

// 静态导出时使用空字符串，API 请求使用相对路径
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - add auth token
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('chaite_token') : null
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor - extract data and handle errors
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login (避免在登录页循环)
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        localStorage.removeItem('chaite_token')
        window.location.href = '/login/'
      }
    }
    throw error
  }
)

// Config API
export const configApi = {
  get: () => api.get('/api/config'),
  update: (data: any) => api.post('/api/config', data),
  getAdvanced: () => api.get('/api/config/advanced'),
  updateAdvanced: (data: any) => api.put('/api/config/advanced', data),
}

// Channels API
export const channelsApi = {
  list: (withStats = false) => api.get(`/api/channels/list?withStats=${withStats}`),
  get: (id: string) => api.get(`/api/channels/${id}`),
  create: (data: any) => api.post('/api/channels', data),
  update: (id: string, data: any) => api.put(`/api/channels/${id}`, data),
  delete: (id: string) => api.delete(`/api/channels/${id}`),
  test: (data: any) => api.post('/api/channels/test', data),
  fetchModels: (data: any) => api.post('/api/channels/fetch-models', data),
  getStats: () => api.get('/api/channels/stats'),
}

// Auth API
export const authApi = {
  login: (password: string) => api.post('/api/auth/login', { password }),
  loginWithToken: (token: string) => api.post('/api/auth/login', { token }),
  verifyToken: (token: string) => api.get(`/api/auth/verify-token?token=${token}`),
  generateToken: () => api.get('/api/auth/token/generate'),
}

// Conversations API
export const conversationsApi = {
  list: () => api.get('/api/conversations/list'),
  getMessages: (id: string) => api.get(`/api/conversations/${id}/messages`),
  delete: (id: string) => api.delete(`/api/conversations/${id}`),
  clearAll: () => api.delete('/api/conversations/clear-all'),
}

// Presets API (后端用 /api/preset 单数)
export const presetsApi = {
  list: () => api.get('/api/preset/list'),
  get: (id: string) => api.get(`/api/preset/${id}`),
  create: (data: any) => api.post('/api/preset/', data),
  update: (id: string, data: any) => api.put(`/api/preset/${id}`, data),
  delete: (id: string) => api.delete(`/api/preset/${id}`),
  getPrompt: (id: string) => api.get(`/api/preset/${id}/prompt`),
  getConfig: () => api.get('/api/presets/config'),
  updateConfig: (data: any) => api.put('/api/presets/config', data),
}

// Tools API
export const toolsApi = {
  list: () => api.get('/api/tools/list'),
  getBuiltinConfig: () => api.get('/api/tools/builtin/config'),
  updateBuiltinConfig: (data: any) => api.put('/api/tools/builtin/config', data),
  getBuiltinList: () => api.get('/api/tools/builtin/list'),
  refreshBuiltin: () => api.post('/api/tools/builtin/refresh'),
  getCustom: () => api.get('/api/tools/custom'),
  createCustom: (data: any) => api.post('/api/tools/custom', data),
  updateCustom: (name: string, data: any) => api.put(`/api/tools/custom/${name}`, data),
  deleteCustom: (name: string) => api.delete(`/api/tools/custom/${name}`),
  getJs: () => api.get('/api/tools/js'),
  getJsDetail: (name: string) => api.get(`/api/tools/js/${name}`),
  updateJs: (name: string, data: any) => api.put(`/api/tools/js/${name}`, data),
  createJs: (data: any) => api.post('/api/tools/js', data),
  deleteJs: (name: string) => api.delete(`/api/tools/js/${name}`),
  reloadJs: () => api.post('/api/tools/js/reload'),
  test: (data: any) => api.post('/api/tools/test', data),
  getLogs: () => api.get('/api/tools/logs'),
  clearLogs: () => api.delete('/api/tools/logs'),
}

// MCP API
export const mcpApi = {
  listServers: () => api.get('/api/mcp/servers'),
  getServer: (name: string) => api.get(`/api/mcp/servers/${name}`),
  createServer: (data: any) => api.post('/api/mcp/servers', data),
  updateServer: (name: string, data: any) => api.put(`/api/mcp/servers/${name}`, data),
  deleteServer: (name: string) => api.delete(`/api/mcp/servers/${name}`),
  reconnectServer: (name: string) => api.post(`/api/mcp/servers/${name}/reconnect`),
  importConfig: (data: any) => api.post('/api/mcp/import', data),
  getResources: () => api.get('/api/mcp/resources'),
  readResource: (data: any) => api.post('/api/mcp/resources/read', data),
  getPrompts: () => api.get('/api/mcp/prompts'),
  getPrompt: (data: any) => api.post('/api/mcp/prompts/get', data),
}

// Context API
export const contextApi = {
  list: () => api.get('/api/context/list'),
  clear: (data: any) => api.post('/api/context/clear', data),
}

// Memory API
export const memoryApi = {
  getUsers: () => api.get('/api/memory/users'),
  get: (userId: string) => api.get(`/api/memory/${userId}`),
  create: (data: any) => api.post('/api/memory', data),
  delete: (userId: string, memoryId: string) => api.delete(`/api/memory/${userId}/${memoryId}`),
  clearAll: () => api.delete('/api/memory/clear-all'),
  clearUser: (userId: string) => api.delete(`/api/memory/${userId}`),
  search: (data: any) => api.post('/api/memory/search', data),
}

// Scope API
export const scopeApi = {
  // 用户人格
  getUsers: () => api.get('/api/scope/users'),
  getUser: (userId: string) => api.get(`/api/scope/user/${userId}`),
  updateUser: (userId: string, data: any) => api.put(`/api/scope/user/${userId}`, data),
  deleteUser: (userId: string) => api.delete(`/api/scope/user/${userId}`),
  // 群组人格
  getGroups: () => api.get('/api/scope/groups'),
  getGroup: (groupId: string) => api.get(`/api/scope/group/${groupId}`),
  updateGroup: (groupId: string, data: any) => api.put(`/api/scope/group/${groupId}`, data),
  deleteGroup: (groupId: string) => api.delete(`/api/scope/group/${groupId}`),
  // 群内用户人格
  getGroupUsers: () => api.get('/api/scope/group-users'),
  getGroupUser: (groupId: string, userId: string) => api.get(`/api/scope/group/${groupId}/user/${userId}`),
  updateGroupUser: (groupId: string, userId: string, data: any) => api.put(`/api/scope/group/${groupId}/user/${userId}`, data),
  deleteGroupUser: (groupId: string, userId: string) => api.delete(`/api/scope/group/${groupId}/user/${userId}`),
  // 其他
  getEffective: (userId: string) => api.get(`/api/scope/effective/${userId}`),
  getPersonalityConfig: () => api.get('/api/config/personality'),
  updatePersonalityConfig: (data: any) => api.patch('/api/config/personality', data),
}

// System API
export const systemApi = {
  getHealth: () => api.get('/api/health'),
  getMetrics: () => api.get('/api/metrics'),
  getState: () => api.get('/api/state'),
}

// Auth Token Management API
export const tokenApi = {
  generatePermanent: () => api.post('/api/auth/token/permanent'),
  revokePermanent: () => api.delete('/api/auth/token/permanent'),
  getStatus: () => api.get('/api/auth/token/status'),
}
