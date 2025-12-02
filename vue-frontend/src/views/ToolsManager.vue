<script setup>
import { ref, onMounted, computed, h } from 'vue'
import { 
  NSpace, NCard, NDataTable, NButton, NTag, NInput, NSelect, 
  NModal, NForm, NFormItem, NSpin, useMessage, NPopconfirm, 
  NSwitch, NDynamicTags, NAlert, NTabs, NTabPane, NInputNumber,
  NGrid, NGridItem, NStatistic, NDivider, NCollapse, NCollapseItem,
  NText, NScrollbar, NEmpty, NDescriptions, NDescriptionsItem
} from 'naive-ui'
import axios from 'axios'
import CodeBlock from '../components/CodeBlock.vue'
import CodeEditor from '../components/CodeEditor.vue'

const message = useMessage()

// ==================== 状态 ====================
const loading = ref(false)
const tools = ref([])
const mcpServers = ref([])
const searchText = ref('')
const filterType = ref(null)
const filterServer = ref(null)
const activeTab = ref('tools')

// 工具详情
const showDetailModal = ref(false)
const selectedTool = ref(null)

// 工具测试
const showTestModal = ref(false)
const testArgs = ref('{}')
const testResult = ref('')
const testLoading = ref(false)

// MCP 服务器表单
const showServerModal = ref(false)
const isEditServer = ref(false)
const serverForm = ref({
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  scriptPath: ''  // 本地 JS 脚本路径
})

// 内置工具配置
const builtinConfig = ref({
  enabled: true,
  allowedTools: [],
  disabledTools: [],
  dangerousTools: ['kick_member', 'mute_member', 'recall_message', 'set_group_ban', 'set_group_whole_ban'],
  allowDangerous: false
})

// 自定义工具
const customTools = ref([])
const showCustomToolModal = ref(false)
const isEditCustomTool = ref(false)
const customToolForm = ref({
  name: '',
  description: '',
  parameters: '{}',
  handler: ''
})

// 示例工具模板
const toolTemplates = [
  {
    name: 'hello_world',
    label: 'Hello World (基础示例)',
    description: '一个简单的问候工具，返回问候语',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        name: { type: 'string', description: '要问候的名字' }
      },
      required: ['name']
    }, null, 2),
    handler: `// 这是一个简单的示例工具
// args 包含用户传入的参数
// ctx 包含上下文信息（bot, event 等）

const { name } = args
return {
  text: \`你好，\${name}！欢迎使用自定义工具。\`,
  greeting: true,
  timestamp: Date.now()
}`
  },
  {
    name: 'random_number',
    label: '随机数生成器',
    description: '生成指定范围内的随机数',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        min: { type: 'number', description: '最小值', default: 1 },
        max: { type: 'number', description: '最大值', default: 100 }
      }
    }, null, 2),
    handler: `const min = args.min || 1
const max = args.max || 100
const result = Math.floor(Math.random() * (max - min + 1)) + min

return {
  text: \`生成的随机数是: \${result}\`,
  number: result,
  range: { min, max }
}`
  },
  {
    name: 'fetch_api',
    label: 'API 请求工具',
    description: '发送 HTTP 请求获取数据',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        url: { type: 'string', description: '请求的 URL' },
        method: { type: 'string', description: '请求方法', enum: ['GET', 'POST'], default: 'GET' }
      },
      required: ['url']
    }, null, 2),
    handler: `// 使用 fetch 发送请求
const { url, method = 'GET' } = args

try {
  const response = await fetch(url, { method })
  const data = await response.json()
  return {
    text: \`请求成功，状态码: \${response.status}\`,
    data,
    status: response.status
  }
} catch (error) {
  return {
    error: \`请求失败: \${error.message}\`,
    url
  }
}`
  },
  {
    name: 'send_message_tool',
    label: '发送消息工具',
    description: '使用 Bot 发送消息到指定群',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        group_id: { type: 'string', description: '群号' },
        message: { type: 'string', description: '消息内容' }
      },
      required: ['group_id', 'message']
    }, null, 2),
    handler: `// 使用 ctx.getBot() 获取 Bot 实例
const bot = ctx.getBot()
const { group_id, message } = args

try {
  const group = bot.pickGroup(parseInt(group_id))
  const result = await group.sendMsg(message)
  return {
    text: \`消息已发送到群 \${group_id}\`,
    success: true,
    message_id: result.message_id
  }
} catch (error) {
  return {
    error: \`发送失败: \${error.message}\`
  }
}`
  },
  {
    name: 'current_time',
    label: '当前时间',
    description: '获取当前时间信息',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        format: { type: 'string', description: '时间格式', enum: ['full', 'date', 'time'], default: 'full' }
      }
    }, null, 2),
    handler: `const now = new Date()
const format = args.format || 'full'

let result
switch (format) {
  case 'date':
    result = now.toLocaleDateString('zh-CN')
    break
  case 'time':
    result = now.toLocaleTimeString('zh-CN')
    break
  default:
    result = now.toLocaleString('zh-CN')
}

return {
  text: \`当前时间: \${result}\`,
  timestamp: now.getTime(),
  formatted: result
}`
  },
  {
    name: 'redis_cache',
    label: 'Redis 缓存操作',
    description: '使用 Redis 存取数据',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型', enum: ['get', 'set', 'del'] },
        key: { type: 'string', description: '缓存键名' },
        value: { type: 'string', description: '缓存值（set时需要）' },
        ttl: { type: 'number', description: '过期时间（秒）', default: 3600 }
      },
      required: ['action', 'key']
    }, null, 2),
    handler: `const { action, key, value, ttl = 3600 } = args

await runtime.Redis.init()

switch (action) {
  case 'get': {
    const data = await runtime.Redis.get(key)
    return { text: data ? \`获取成功: \${data}\` : '键不存在', data }
  }
  case 'set': {
    await runtime.Redis.set(key, value, ttl)
    return { text: \`已设置 \${key}，有效期 \${ttl} 秒\` }
  }
  case 'del': {
    await runtime.Redis.del(key)
    return { text: \`已删除 \${key}\` }
  }
  default:
    return { error: '未知操作' }
}`
  },
  {
    name: 'call_other_tool',
    label: '调用其他工具',
    description: '链式调用其他MCP工具',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: '要调用的工具名称' },
        tool_args: { type: 'object', description: '传递给工具的参数' }
      },
      required: ['tool_name']
    }, null, 2),
    handler: `const { tool_name, tool_args = {} } = args

try {
  const result = await runtime.mcp.callTool(tool_name, tool_args)
  return {
    text: \`工具 \${tool_name} 执行完成\`,
    result
  }
} catch (error) {
  return { error: \`调用失败: \${error.message}\` }
}`
  },
  {
    name: 'execute_command',
    label: '执行系统命令',
    description: '执行shell命令（注意安全）',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' }
      },
      required: ['command']
    }, null, 2),
    handler: `const { command } = args

// 安全检查 - 禁止危险命令
const dangerous = ['rm -rf', 'mkfs', 'dd if=', ':(){', 'chmod -R 777']
if (dangerous.some(d => command.includes(d))) {
  return { error: '检测到危险命令，已拒绝执行' }
}

try {
  const { stdout, stderr } = await runtime.utils.exec(command)
  return {
    text: stdout || '命令执行完成',
    stdout,
    stderr
  }
} catch (error) {
  return { error: \`执行失败: \${error.message}\` }
}`
  }
]

// ==================== 计算属性 ====================
const serverOptions = computed(() => {
  const servers = new Set(['builtin'])
  tools.value.forEach(t => {
    if (t.serverName) servers.add(t.serverName)
  })
  return [
    { label: '全部', value: null },
    ...Array.from(servers).map(s => ({ label: s, value: s }))
  ]
})

const typeOptions = [
  { label: '全部', value: null },
  { label: '内置工具', value: 'builtin' },
  { label: 'MCP工具', value: 'mcp' }
]

const filteredTools = computed(() => {
  let result = tools.value
  
  if (searchText.value) {
    const search = searchText.value.toLowerCase()
    result = result.filter(t => 
      t.name.toLowerCase().includes(search) || 
      t.description?.toLowerCase().includes(search)
    )
  }
  
  if (filterServer.value) {
    result = result.filter(t => (t.serverName || 'builtin') === filterServer.value)
  }
  
  if (filterType.value === 'builtin') {
    result = result.filter(t => t.isBuiltin)
  } else if (filterType.value === 'mcp') {
    result = result.filter(t => !t.isBuiltin)
  }
  
  return result
})

const builtinToolsCount = computed(() => tools.value.filter(t => t.isBuiltin).length)
const mcpToolsCount = computed(() => tools.value.filter(t => !t.isBuiltin).length)
const connectedServers = computed(() => mcpServers.value.filter(s => s.status === 'connected').length)

// ==================== 工具表格列 ====================
const toolColumns = [
  { title: '名称', key: 'name', width: 180, ellipsis: { tooltip: true } },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  { 
    title: '类型', 
    key: 'type', 
    width: 80,
    render: (row) => {
      if (row.isBuiltin) {
        return h(NTag, { type: 'success', size: 'small' }, { default: () => '内置' })
      }
      return h(NTag, { type: 'info', size: 'small' }, { default: () => 'MCP' })
    }
  },
  { 
    title: '来源', 
    key: 'serverName', 
    width: 120,
    render: (row) => row.serverName || 'builtin'
  },
  { 
    title: '危险', 
    key: 'dangerous', 
    width: 60,
    render: (row) => {
      if (builtinConfig.value.dangerousTools?.includes(row.name)) {
        return h(NTag, { type: 'error', size: 'small' }, { default: () => '是' })
      }
      return ''
    }
  },
  {
    title: '状态',
    key: 'enabled',
    width: 80,
    render: (row) => {
      if (!row.isBuiltin) return '-'
      const disabled = builtinConfig.value.disabledTools?.includes(row.name)
      return h(NSwitch, {
        size: 'small',
        value: !disabled,
        onUpdateValue: () => toggleTool(row.name)
      })
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row) => {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => viewDetail(row) }, { default: () => '详情' }),
          h(NButton, { size: 'small', type: 'primary', onClick: () => openTestModal(row) }, { default: () => '测试' })
        ]
      })
    }
  }
]

// ==================== MCP 服务器表格列 ====================
const serverColumns = [
  { title: '名称', key: 'name', width: 150 },
  { 
    title: '类型', 
    key: 'type',
    width: 100,
    render: (row) => {
      const typeMap = { stdio: '本地进程', sse: 'SSE', http: 'HTTP', js: 'JS脚本' }
      return typeMap[row.type] || row.type
    }
  },
  { 
    title: '状态', 
    key: 'status',
    width: 100,
    render: (row) => {
      const type = row.status === 'connected' ? 'success' : row.status === 'error' ? 'error' : 'warning'
      return h(NTag, { type, size: 'small' }, { default: () => row.status || 'unknown' })
    }
  },
  { title: '工具数', key: 'toolsCount', width: 80 },
  { title: '资源数', key: 'resourcesCount', width: 80 },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row) => {
      const isBuiltin = row.name === 'builtin'
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { 
            size: 'small', 
            onClick: () => handleReconnect(row),
            disabled: isBuiltin
          }, { default: () => '重连' }),
          h(NButton, { 
            size: 'small', 
            onClick: () => editServer(row),
            disabled: isBuiltin
          }, { default: () => '编辑' }),
          h(NPopconfirm, {
            onPositiveClick: () => handleDeleteServer(row)
          }, {
            trigger: () => h(NButton, { 
              size: 'small', 
              type: 'error',
              disabled: isBuiltin
            }, { default: () => '删除' }),
            default: () => '确定要删除吗？'
          })
        ]
      })
    }
  }
]

// ==================== 方法 ====================
async function fetchTools() {
  loading.value = true
  try {
    const res = await axios.get('/api/tools/list')
    if (res.data.code === 0) {
      tools.value = res.data.data || []
    }
  } catch (err) {
    message.error('获取工具列表失败')
  } finally {
    loading.value = false
  }
}

async function fetchServers() {
  try {
    const res = await axios.get('/api/mcp/servers')
    if (res.data.code === 0) {
      mcpServers.value = res.data.data || []
    }
  } catch (err) {
    message.error('获取服务器列表失败')
  }
}

async function fetchBuiltinConfig() {
  try {
    const res = await axios.get('/api/tools/builtin/config')
    if (res.data.code === 0) {
      builtinConfig.value = { ...builtinConfig.value, ...res.data.data }
    }
  } catch (err) {
    console.error('Failed to fetch builtin config', err)
  }
}

async function saveBuiltinConfig() {
  try {
    const res = await axios.put('/api/tools/builtin/config', builtinConfig.value)
    if (res.data.code === 0) {
      message.success('✓ 配置已保存', { duration: 2000 })
      await fetchTools()
    }
  } catch (err) {
    message.error('保存失败: ' + err.message)
  }
}

// 批量启用所有工具
function enableAllTools() {
  builtinConfig.value.disabledTools = []
  builtinConfig.value.allowedTools = []
  saveBuiltinConfig()
}

// 批量禁用危险工具
function disableDangerousTools() {
  builtinConfig.value.disabledTools = [...builtinConfig.value.dangerousTools]
  builtinConfig.value.allowDangerous = false
  saveBuiltinConfig()
}

// 切换工具启用状态
function toggleTool(toolName) {
  const idx = builtinConfig.value.disabledTools.indexOf(toolName)
  if (idx >= 0) {
    builtinConfig.value.disabledTools.splice(idx, 1)
  } else {
    builtinConfig.value.disabledTools.push(toolName)
  }
  saveBuiltinConfig()
}

// 检查工具是否禁用
function isToolDisabled(toolName) {
  return builtinConfig.value.disabledTools?.includes(toolName)
}

function viewDetail(tool) {
  selectedTool.value = tool
  showDetailModal.value = true
}

function openTestModal(tool) {
  selectedTool.value = tool
  testArgs.value = JSON.stringify(getDefaultArgs(tool), null, 2)
  testResult.value = ''
  showTestModal.value = true
}

function getDefaultArgs(tool) {
  const params = tool.inputSchema || tool.parameters || {}
  const args = {}
  if (params.properties) {
    Object.keys(params.properties).forEach(key => {
      const prop = params.properties[key]
      if (prop.default !== undefined) {
        args[key] = prop.default
      } else if (prop.type === 'string') {
        args[key] = ''
      } else if (prop.type === 'number' || prop.type === 'integer') {
        args[key] = 0
      } else if (prop.type === 'boolean') {
        args[key] = false
      }
    })
  }
  return args
}

async function testTool() {
  testLoading.value = true
  testResult.value = ''
  try {
    const args = JSON.parse(testArgs.value)
    const res = await axios.post('/api/tools/test', {
      toolName: selectedTool.value.name,
      arguments: args
    })
    if (res.data.code === 0) {
      testResult.value = JSON.stringify(res.data.data, null, 2)
      message.success('✓ 执行成功', { duration: 2000 })
    } else {
      testResult.value = `Error: ${res.data.message}`
      message.error('执行失败')
    }
  } catch (err) {
    testResult.value = `Error: ${err.message}`
    message.error('执行失败: ' + err.message)
  } finally {
    testLoading.value = false
  }
}

// MCP 服务器操作
function addServer() {
  isEditServer.value = false
  serverForm.value = {
    name: '',
    type: 'stdio',
    command: '',
    args: '',
    url: '',
    env: '',
    scriptPath: ''
  }
  showServerModal.value = true
}

function editServer(row) {
  isEditServer.value = true
  serverForm.value = {
    name: row.name,
    type: row.type || 'stdio',
    command: row.config?.command || '',
    args: row.config?.args?.join(' ') || '',
    url: row.config?.url || '',
    env: row.config?.env ? JSON.stringify(row.config.env) : '',
    scriptPath: row.config?.scriptPath || ''
  }
  showServerModal.value = true
}

async function handleReconnect(row) {
  try {
    const res = await axios.post(`/api/mcp/servers/${row.name}/reconnect`)
    if (res.data.code === 0) {
      message.success('重连成功')
      fetchServers()
      fetchTools()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('重连失败: ' + err.message)
  }
}

async function handleDeleteServer(row) {
  try {
    const res = await axios.delete(`/api/mcp/servers/${row.name}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      fetchServers()
      fetchTools()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('删除失败')
  }
}

async function handleSubmitServer() {
  try {
    const config = { type: serverForm.value.type }
    
    if (serverForm.value.type === 'stdio') {
      config.command = serverForm.value.command
      if (serverForm.value.args) {
        config.args = serverForm.value.args.split(' ').filter(Boolean)
      }
      if (serverForm.value.env) {
        config.env = JSON.parse(serverForm.value.env)
      }
    } else if (serverForm.value.type === 'js') {
      config.scriptPath = serverForm.value.scriptPath
    } else {
      config.url = serverForm.value.url
    }
    
    const url = isEditServer.value 
      ? `/api/mcp/servers/${serverForm.value.name}`
      : '/api/mcp/servers'
    const method = isEditServer.value ? 'put' : 'post'
    
    const res = await axios[method](url, {
      name: serverForm.value.name,
      config
    })
    
    if (res.data.code === 0) {
      message.success(isEditServer.value ? '更新成功' : '添加成功')
      showServerModal.value = false
      fetchServers()
      fetchTools()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('操作失败: ' + err.message)
  }
}

async function refreshBuiltinTools() {
  try {
    const res = await axios.post('/api/tools/builtin/refresh')
    if (res.data.code === 0) {
      message.success(`已刷新 ${res.data.data?.count || 0} 个内置工具`)
      await fetchTools()
    }
  } catch (err) {
    message.error('刷新失败')
  }
}

// ==================== 自定义工具方法 ====================
async function fetchCustomTools() {
  try {
    const res = await axios.get('/api/tools/custom')
    if (res.data.code === 0) {
      customTools.value = res.data.data || []
    }
  } catch (err) {
    console.error('Failed to fetch custom tools', err)
  }
}

function addCustomTool() {
  isEditCustomTool.value = false
  customToolForm.value = {
    name: '',
    description: '',
    parameters: JSON.stringify({ type: 'object', properties: {}, required: [] }, null, 2),
    handler: `// 在这里编写工具逻辑
// args: 用户传入的参数对象
// ctx: 上下文对象，包含 getBot(), getEvent() 等方法

return {
  text: '工具执行成功',
  data: args
}`
  }
  showCustomToolModal.value = true
}

function editCustomTool(tool) {
  isEditCustomTool.value = true
  customToolForm.value = {
    name: tool.name,
    description: tool.description,
    parameters: typeof tool.parameters === 'string' ? tool.parameters : JSON.stringify(tool.parameters || {}, null, 2),
    handler: tool.handler || ''
  }
  showCustomToolModal.value = true
}

function applyTemplate(template) {
  customToolForm.value = {
    name: template.name,
    description: template.description,
    parameters: template.parameters,
    handler: template.handler
  }
  message.success(`已应用模板: ${template.label}`)
}

async function saveCustomTool() {
  if (!customToolForm.value.name || !customToolForm.value.description) {
    message.error('名称和描述不能为空')
    return
  }

  try {
    // 验证 JSON
    let params
    try {
      params = JSON.parse(customToolForm.value.parameters)
    } catch (e) {
      message.error('参数格式错误，请输入有效的 JSON')
      return
    }

    const data = {
      name: customToolForm.value.name,
      description: customToolForm.value.description,
      parameters: params,
      handler: customToolForm.value.handler
    }

    const url = isEditCustomTool.value 
      ? `/api/tools/custom/${customToolForm.value.name}`
      : '/api/tools/custom'
    const method = isEditCustomTool.value ? 'put' : 'post'

    const res = await axios[method](url, data)
    if (res.data.code === 0) {
      message.success(isEditCustomTool.value ? '更新成功' : '创建成功')
      showCustomToolModal.value = false
      await fetchCustomTools()
      await fetchTools()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('保存失败: ' + err.message)
  }
}

async function deleteCustomTool(name) {
  try {
    const res = await axios.delete(`/api/tools/custom/${name}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      await fetchCustomTools()
      await fetchTools()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('删除失败')
  }
}

// 自定义工具表格列
const customToolColumns = [
  { title: '名称', key: 'name', width: 150 },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  { 
    title: '创建时间', 
    key: 'createdAt',
    width: 180,
    render: (row) => row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : '-'
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row) => {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => editCustomTool(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'primary', onClick: () => openTestModal(row) }, { default: () => '测试' }),
          h(NPopconfirm, {
            onPositiveClick: () => deleteCustomTool(row.name)
          }, {
            trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
            default: () => '确定要删除吗？'
          })
        ]
      })
    }
  }
]

// ==================== JS 工具文件管理 ====================
const jsTools = ref([])
const showJsToolModal = ref(false)
const isEditJsTool = ref(false)
const jsToolForm = ref({
  name: '',
  source: ''
})
const jsToolLoading = ref(false)

async function fetchJsTools() {
  try {
    const res = await axios.get('/api/tools/js')
    if (res.data.code === 0) {
      jsTools.value = res.data.data || []
    }
  } catch (err) {
    console.error('Failed to fetch JS tools', err)
  }
}

async function reloadJsTools() {
  jsToolLoading.value = true
  try {
    const res = await axios.post('/api/tools/js/reload')
    if (res.data.code === 0) {
      message.success('✓ ' + (res.data.data?.message || '热重载成功'), { duration: 2000 })
      await fetchJsTools()
      await fetchTools()
    }
  } catch (err) {
    message.error('重载失败: ' + err.message)
  } finally {
    jsToolLoading.value = false
  }
}

function addJsTool() {
  isEditJsTool.value = false
  jsToolForm.value = { name: '', source: '' }
  showJsToolModal.value = true
}

async function editJsTool(tool) {
  isEditJsTool.value = true
  jsToolLoading.value = true
  try {
    const res = await axios.get(`/api/tools/js/${tool.name}`)
    if (res.data.code === 0) {
      jsToolForm.value = {
        name: res.data.data.name,
        source: res.data.data.source
      }
      showJsToolModal.value = true
    }
  } catch (err) {
    message.error('加载源码失败: ' + err.message)
  } finally {
    jsToolLoading.value = false
  }
}

async function saveJsTool() {
  if (!jsToolForm.value.name) {
    message.error('请输入工具名称')
    return
  }
  
  jsToolLoading.value = true
  try {
    if (isEditJsTool.value) {
      const res = await axios.put(`/api/tools/js/${jsToolForm.value.name}`, {
        source: jsToolForm.value.source
      })
      if (res.data.code === 0) {
        message.success('✓ 保存成功，已热重载', { duration: 2000 })
        showJsToolModal.value = false
        await fetchJsTools()
        await fetchTools()
      } else {
        message.error(res.data.message)
      }
    } else {
      const res = await axios.post('/api/tools/js', {
        name: jsToolForm.value.name,
        source: jsToolForm.value.source || undefined
      })
      if (res.data.code === 0) {
        message.success('✓ 工具已创建', { duration: 2000 })
        showJsToolModal.value = false
        await fetchJsTools()
        await fetchTools()
      } else {
        message.error(res.data.message)
      }
    }
  } catch (err) {
    message.error('保存失败: ' + err.message)
  } finally {
    jsToolLoading.value = false
  }
}

async function deleteJsTool(name) {
  try {
    const res = await axios.delete(`/api/tools/js/${name}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      await fetchJsTools()
      await fetchTools()
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  }
}

const jsToolColumns = [
  { title: '工具名', key: 'name', width: 150 },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  { title: '文件', key: 'filename', width: 140 },
  { 
    title: '修改时间', 
    key: 'modifiedAt',
    width: 160,
    render: (row) => new Date(row.modifiedAt).toLocaleString('zh-CN')
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row) => {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => editJsTool(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'primary', onClick: () => openTestModal({ name: row.name, inputSchema: {} }) }, { default: () => '测试' }),
          h(NPopconfirm, {
            onPositiveClick: () => deleteJsTool(row.name)
          }, {
            trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
            default: () => '确定删除工具文件吗？'
          })
        ]
      })
    }
  }
]

// ==================== 调用日志 ====================
const toolLogs = ref([])
const logLoading = ref(false)
const logFilter = ref({ tool: null })
const logToolOptions = computed(() => {
  const tools = new Set(toolLogs.value.map(l => l.toolName))
  return Array.from(tools).map(t => ({ label: t, value: t }))
})

const logColumns = [
  {
    title: '时间',
    key: 'timestamp',
    width: 160,
    render: (row) => new Date(row.timestamp).toLocaleString('zh-CN')
  },
  {
    title: '工具',
    key: 'toolName',
    width: 150,
    render: (row) => h(NTag, { type: 'info', size: 'small' }, () => row.toolName)
  },
  {
    title: '状态',
    key: 'success',
    width: 70,
    render: (row) => h(NTag, { 
      type: row.success ? 'success' : 'error',
      size: 'small'
    }, () => row.success ? '成功' : '失败')
  },
  {
    title: '耗时',
    key: 'duration',
    width: 70,
    render: (row) => row.duration ? `${row.duration}ms` : '-'
  },
  {
    title: '操作',
    key: 'actions',
    width: 60,
    render: (row) => h(NButton, {
      size: 'small',
      onClick: () => viewLogDetail(row)
    }, () => '详情')
  }
]

const showLogDetailModal = ref(false)
const selectedLog = ref(null)

async function fetchToolLogs() {
  logLoading.value = true
  try {
    const params = {}
    if (logFilter.value.tool) params.tool = logFilter.value.tool
    const res = await axios.get('/api/tools/logs', { params })
    if (res.data.code === 0) {
      toolLogs.value = res.data.data || []
    }
  } catch (err) {
    message.error('获取日志失败')
  } finally {
    logLoading.value = false
  }
}

async function clearToolLogs() {
  try {
    const res = await axios.delete('/api/tools/logs')
    if (res.data.code === 0) {
      message.success('日志已清空')
      toolLogs.value = []
    }
  } catch (err) {
    message.error('清空失败')
  }
}

function viewLogDetail(log) {
  selectedLog.value = log
  showLogDetailModal.value = true
}

onMounted(() => {
  fetchTools()
  fetchServers()
  fetchBuiltinConfig()
  fetchCustomTools()
  fetchJsTools()
  fetchToolLogs()
})
</script>

<template>
  <n-space vertical :size="16">
    <!-- 统计卡片 -->
    <n-grid :cols="4" :x-gap="12" :y-gap="12" responsive="screen" item-responsive>
      <n-grid-item span="0:2 400:1">
        <n-card size="small" hoverable>
          <n-statistic label="内置工具" :value="builtinToolsCount" />
        </n-card>
      </n-grid-item>
      <n-grid-item span="0:2 400:1">
        <n-card size="small" hoverable>
          <n-statistic label="MCP工具" :value="mcpToolsCount" />
        </n-card>
      </n-grid-item>
      <n-grid-item span="0:2 400:1">
        <n-card size="small" hoverable>
          <n-statistic label="MCP服务器" :value="mcpServers.length" />
        </n-card>
      </n-grid-item>
      <n-grid-item span="0:2 400:1">
        <n-card size="small" hoverable>
          <n-statistic label="已连接" :value="connectedServers" />
        </n-card>
      </n-grid-item>
    </n-grid>

    <!-- 主内容区 -->
    <n-card>
      <n-tabs v-model:value="activeTab" type="line">
        <!-- 工具列表 -->
        <n-tab-pane name="tools" tab="工具列表">
          <n-space vertical :size="12">
            <n-space justify="space-between">
              <n-space>
                <n-input v-model:value="searchText" placeholder="搜索工具..." style="width: 200px" clearable />
                <n-select v-model:value="filterType" :options="typeOptions" placeholder="类型" style="width: 120px" clearable />
                <n-select v-model:value="filterServer" :options="serverOptions" placeholder="来源" style="width: 150px" clearable />
              </n-space>
              <n-space>
                <n-button @click="enableAllTools">全部启用</n-button>
                <n-button @click="disableDangerousTools" type="warning">禁用危险工具</n-button>
                <n-button @click="fetchTools" :loading="loading">刷新</n-button>
              </n-space>
            </n-space>
            
            <n-data-table :columns="toolColumns" :data="filteredTools" :loading="loading" :pagination="{ pageSize: 15 }" size="small" />
          </n-space>
        </n-tab-pane>

        <!-- MCP 服务器 -->
        <n-tab-pane name="servers" tab="MCP服务器">
          <n-space vertical :size="12">
            <n-space justify="end">
              <n-button type="primary" @click="addServer">添加服务器</n-button>
            </n-space>
            <n-data-table :columns="serverColumns" :data="mcpServers" size="small" />
          </n-space>
        </n-tab-pane>

        <!-- 内置工具配置 -->
        <n-tab-pane name="builtin" tab="内置工具配置">
          <n-space vertical :size="16">
            <n-alert v-if="!builtinConfig.enabled" type="warning">
              内置工具已禁用，AI将无法使用QQ相关功能
            </n-alert>
            
            <n-form label-placement="left" label-width="140">
              <n-form-item label="启用内置工具">
                <n-switch v-model:value="builtinConfig.enabled" />
              </n-form-item>
              <n-form-item label="允许危险操作">
                <n-switch v-model:value="builtinConfig.allowDangerous" />
                <template #feedback>危险操作包括踢人、禁言、撤回等</template>
              </n-form-item>
              <n-form-item label="危险工具列表">
                <n-dynamic-tags v-model:value="builtinConfig.dangerousTools" />
              </n-form-item>
              <n-form-item label="允许的工具">
                <n-dynamic-tags v-model:value="builtinConfig.allowedTools" />
                <template #feedback>留空表示允许所有工具</template>
              </n-form-item>
              <n-form-item label="禁用的工具">
                <n-dynamic-tags v-model:value="builtinConfig.disabledTools" />
              </n-form-item>
              <n-form-item>
                <n-space>
                  <n-button type="primary" @click="saveBuiltinConfig">保存配置</n-button>
                  <n-button @click="refreshBuiltinTools">刷新内置工具</n-button>
                </n-space>
              </n-form-item>
            </n-form>
          </n-space>
        </n-tab-pane>

        <!-- 自定义工具 -->
        <n-tab-pane name="custom" tab="自定义工具">
          <n-space vertical :size="16">
            <n-alert type="info">
              自定义工具允许你使用 JavaScript 编写自己的 MCP 工具。工具代码在服务端执行，可以访问 Bot API 和网络请求。
            </n-alert>

            <n-space justify="space-between">
              <n-text>共 {{ customTools.length }} 个自定义工具</n-text>
              <n-button type="primary" @click="addCustomTool">创建工具</n-button>
            </n-space>

            <n-data-table :columns="customToolColumns" :data="customTools" size="small" />

            <!-- 示例模板 -->
            <n-collapse>
              <n-collapse-item title="📚 示例模板 (点击展开)" name="templates">
                <n-grid :cols="2" :x-gap="12" :y-gap="12">
                  <n-grid-item v-for="tpl in toolTemplates" :key="tpl.name">
                    <n-card size="small" hoverable @click="() => { addCustomTool(); applyTemplate(tpl) }">
                      <template #header>
                        <n-text strong>{{ tpl.label }}</n-text>
                      </template>
                      <n-text depth="3">{{ tpl.description }}</n-text>
                    </n-card>
                  </n-grid-item>
                </n-grid>
              </n-collapse-item>
            </n-collapse>
          </n-space>
        </n-tab-pane>

        <!-- JS 工具文件 -->
        <n-tab-pane name="jstools" tab="JS工具文件">
          <n-space vertical :size="16">
            <n-alert type="info">
              JS 工具文件存放在 <code>data/tools/</code> 目录下，支持热重载。工具会自动注入 Bot、logger、redis、segment、common 等全局变量。
            </n-alert>

            <n-space justify="space-between">
              <n-text>共 {{ jsTools.length }} 个 JS 工具文件</n-text>
              <n-space>
                <n-button @click="reloadJsTools" :loading="jsToolLoading">热重载</n-button>
                <n-button type="primary" @click="addJsTool">创建工具</n-button>
              </n-space>
            </n-space>

            <n-data-table :columns="jsToolColumns" :data="jsTools" size="small" />
          </n-space>
        </n-tab-pane>

        <!-- 调用日志 -->
        <n-tab-pane name="logs" tab="调用日志">
          <n-space vertical :size="12">
            <n-space justify="space-between">
              <n-space>
                <n-select
                  v-model:value="logFilter.tool"
                  :options="logToolOptions"
                  placeholder="筛选工具"
                  clearable
                  style="width: 180px"
                  @update:value="fetchToolLogs"
                />
              </n-space>
              <n-space>
                <n-button @click="fetchToolLogs" :loading="logLoading">刷新</n-button>
                <n-button type="error" @click="clearToolLogs" v-if="toolLogs.length > 0">清空</n-button>
              </n-space>
            </n-space>
            
            <n-empty v-if="toolLogs.length === 0" description="暂无日志记录" />
            <n-data-table
              v-else
              :columns="logColumns"
              :data="toolLogs"
              :loading="logLoading"
              :pagination="{ pageSize: 30 }"
              size="small"
              max-height="50vh"
            />
          </n-space>
        </n-tab-pane>
      </n-tabs>
    </n-card>

    <!-- 工具详情 Modal -->
    <n-modal v-model:show="showDetailModal" preset="card" title="工具详情" style="width: 650px">
      <n-space vertical v-if="selectedTool">
        <div><strong>名称:</strong> {{ selectedTool.name }}</div>
        <div><strong>描述:</strong> {{ selectedTool.description }}</div>
        <div><strong>来源:</strong> <n-tag type="info" size="small">{{ selectedTool.serverName || 'builtin' }}</n-tag></div>
        <n-divider />
        <div><strong>输入参数:</strong></div>
        <CodeBlock :code="JSON.stringify(selectedTool.inputSchema || {}, null, 2)" language="json" />
      </n-space>
    </n-modal>

    <!-- 工具测试 Modal -->
    <n-modal v-model:show="showTestModal" preset="card" title="测试工具" style="width: 700px">
      <n-space vertical v-if="selectedTool">
        <div><strong>工具:</strong> {{ selectedTool.name }}</div>
        <n-form-item label="参数 (JSON)">
          <n-input v-model:value="testArgs" type="textarea" :rows="8" placeholder='{"key": "value"}' />
        </n-form-item>
        <n-space>
          <n-button type="primary" @click="testTool" :loading="testLoading">执行测试</n-button>
          <n-button @click="testArgs = JSON.stringify(getDefaultArgs(selectedTool), null, 2)">重置参数</n-button>
        </n-space>
        <div v-if="testResult">
          <strong>测试结果:</strong>
          <CodeBlock :code="testResult" language="json" style="margin-top: 8px" />
        </div>
      </n-space>
    </n-modal>

    <!-- MCP 服务器表单 Modal -->
    <n-modal v-model:show="showServerModal" preset="card" :title="isEditServer ? '编辑服务器' : '添加服务器'" style="width: 600px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="名称" required>
          <n-input v-model:value="serverForm.name" placeholder="服务器名称" :disabled="isEditServer" />
        </n-form-item>
        <n-form-item label="类型" required>
          <n-select v-model:value="serverForm.type" :options="[
            { label: 'Stdio (本地进程)', value: 'stdio' },
            { label: 'JS脚本 (本地JS)', value: 'js' },
            { label: 'SSE', value: 'sse' },
            { label: 'HTTP', value: 'http' }
          ]" />
        </n-form-item>
        
        <template v-if="serverForm.type === 'stdio'">
          <n-form-item label="命令">
            <n-input v-model:value="serverForm.command" placeholder="例如: node, python, npx" />
          </n-form-item>
          <n-form-item label="参数">
            <n-input v-model:value="serverForm.args" placeholder="空格分隔，例如: -m mcp_server" />
          </n-form-item>
          <n-form-item label="环境变量">
            <n-input v-model:value="serverForm.env" type="textarea" placeholder='JSON格式: {"KEY": "VALUE"}' :rows="3" />
          </n-form-item>
        </template>
        
        <template v-else-if="serverForm.type === 'js'">
          <n-form-item label="脚本路径">
            <n-input v-model:value="serverForm.scriptPath" placeholder="本地JS文件路径，如: ./mcp/my-server.js" />
          </n-form-item>
          <n-alert type="info" style="margin-top: 8px">
            JS脚本需要导出一个包含 listTools 和 callTool 方法的对象
          </n-alert>
        </template>
        
        <template v-else>
          <n-form-item label="URL">
            <n-input v-model:value="serverForm.url" placeholder="服务器地址" />
          </n-form-item>
        </template>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showServerModal = false">取消</n-button>
          <n-button type="primary" @click="handleSubmitServer">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 自定义工具编辑 Modal -->
    <n-modal v-model:show="showCustomToolModal" preset="card" :title="isEditCustomTool ? '编辑自定义工具' : '创建自定义工具'" style="width: 900px; max-height: 90vh">
      <n-scrollbar style="max-height: calc(90vh - 120px)">
        <n-space vertical :size="16">
          <!-- 基本信息 -->
          <n-form label-placement="left" label-width="80">
            <n-form-item label="工具名称" required>
              <n-input v-model:value="customToolForm.name" placeholder="使用英文和下划线，如: my_tool" :disabled="isEditCustomTool" />
            </n-form-item>
            <n-form-item label="描述" required>
              <n-input v-model:value="customToolForm.description" type="textarea" :rows="2" placeholder="描述工具的功能，AI 会根据描述决定何时使用此工具" />
            </n-form-item>
          </n-form>

          <!-- 模板选择 -->
          <n-collapse v-if="!isEditCustomTool">
            <n-collapse-item title="🎯 快速选择模板" name="tpl">
              <n-space>
                <n-button v-for="tpl in toolTemplates" :key="tpl.name" size="small" @click="applyTemplate(tpl)">
                  {{ tpl.label }}
                </n-button>
              </n-space>
            </n-collapse-item>
          </n-collapse>

          <!-- 参数定义 -->
          <n-card size="small" title="参数定义 (JSON Schema)">
            <template #header-extra>
              <n-text depth="3" style="font-size: 12px">定义工具接收的参数</n-text>
            </template>
            <CodeEditor 
              v-model="customToolForm.parameters" 
              language="json"
              :rows="8"
              placeholder='{
  "type": "object",
  "properties": {
    "param1": { "type": "string", "description": "参数说明" }
  },
  "required": ["param1"]
}'
            />
          </n-card>

          <!-- 代码编辑器 -->
          <n-card size="small" title="工具代码 (JavaScript)">
            <template #header-extra>
              <n-space>
                <n-text depth="3" style="font-size: 12px">可用变量: args, ctx</n-text>
              </n-space>
            </template>
            <CodeEditor 
              v-model="customToolForm.handler" 
              language="javascript"
              :rows="15"
              placeholder="// 编写工具逻辑
// args: 用户传入的参数
// ctx: 上下文对象
//   - ctx.getBot(): 获取 Bot 实例
//   - ctx.getEvent(): 获取当前事件

return { text: '结果', data: {} }"
            />
          </n-card>

          <!-- 帮助信息 -->
          <n-collapse>
            <n-collapse-item title="📖 编写指南" name="help">
              <n-space vertical>
                <n-alert type="info" title="基础变量">
                  <ul style="margin: 0; padding-left: 20px">
                    <li><code>args</code> - 用户传入的参数对象</li>
                    <li><code>ctx</code> - 上下文对象 (getBot, getEvent)</li>
                    <li><code>fetch</code> - 发送 HTTP 请求</li>
                    <li><code>Bot</code> - Bot 实例</li>
                    <li><code>logger</code> - 日志记录器</li>
                    <li><code>config</code> - 配置管理器</li>
                  </ul>
                </n-alert>
                <n-alert type="info" title="runtime 对象（完整 API）">
                  <ul style="margin: 0; padding-left: 20px">
                    <li><code>runtime.Redis</code> - Redis 客户端</li>
                    <li><code>runtime.services.chat</code> - 聊天服务</li>
                    <li><code>runtime.services.database</code> - 数据库服务</li>
                    <li><code>runtime.services.memory</code> - 记忆管理</li>
                    <li><code>runtime.utils.http.get/post</code> - HTTP 请求</li>
                    <li><code>runtime.utils.sendGroupMsg()</code> - 发送群消息</li>
                    <li><code>runtime.utils.sendPrivateMsg()</code> - 发送私聊</li>
                    <li><code>runtime.utils.sleep(ms)</code> - 延迟</li>
                    <li><code>runtime.utils.exec(cmd)</code> - 执行命令</li>
                    <li><code>runtime.mcp.callTool()</code> - 调用其他工具</li>
                    <li><code>runtime.mcp.listTools()</code> - 获取工具列表</li>
                  </ul>
                </n-alert>
                <n-alert type="success" title="返回格式">
                  <p style="margin: 0">返回一个对象，建议包含 <code>text</code> 字段作为文本结果：</p>
                  <n-code :code="`return {
  text: '操作结果描述',
  data: { ... }  // 其他数据
}`" language="javascript" />
                </n-alert>
                <n-alert type="warning" title="注意事项">
                  <ul style="margin: 0; padding-left: 20px">
                    <li>代码在服务端执行，请注意安全性</li>
                    <li>支持 async/await 语法</li>
                    <li>错误会被捕获并返回给 AI</li>
                    <li>exec 命令有 10 秒超时限制</li>
                  </ul>
                </n-alert>
              </n-space>
            </n-collapse-item>
          </n-collapse>
        </n-space>
      </n-scrollbar>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCustomToolModal = false">取消</n-button>
          <n-button type="primary" @click="saveCustomTool">保存工具</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- JS 工具文件编辑 Modal -->
    <n-modal v-model:show="showJsToolModal" preset="card" :title="isEditJsTool ? '编辑 JS 工具' : '创建 JS 工具'" style="width: 900px; max-height: 90vh">
      <n-scrollbar style="max-height: calc(90vh - 120px)">
        <n-space vertical :size="16">
          <n-form label-placement="left" label-width="80">
            <n-form-item label="工具名称" required>
              <n-input v-model:value="jsToolForm.name" placeholder="工具名称（不含.js后缀）" :disabled="isEditJsTool" />
            </n-form-item>
          </n-form>

          <n-card size="small" title="工具源码">
            <template #header-extra>
              <n-text depth="3" style="font-size: 12px">
                保存后自动热重载
              </n-text>
            </template>
            <CodeEditor 
              v-model="jsToolForm.source" 
              language="javascript"
              :rows="25"
              :placeholder="`/**
 * 自定义工具
 * 全局变量: Bot, logger, redis, segment, common
 */
export default {
    name: 'my_tool',
    description: '工具描述',
    inputSchema: {
        type: 'object',
        properties: {},
        required: []
    },
    
    async run(args, ctx) {
        return { text: '结果' }
    }
}`"
            />
          </n-card>

          <n-alert type="info" title="自动注入的全局变量">
            <n-space :size="8" style="flex-wrap: wrap">
              <n-tag size="small">Bot</n-tag>
              <n-tag size="small">logger</n-tag>
              <n-tag size="small">redis</n-tag>
              <n-tag size="small">segment</n-tag>
              <n-tag size="small">common</n-tag>
              <n-tag size="small">config</n-tag>
              <n-tag size="small">fetch</n-tag>
            </n-space>
          </n-alert>
        </n-space>
      </n-scrollbar>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showJsToolModal = false">取消</n-button>
          <n-button type="primary" @click="saveJsTool" :loading="jsToolLoading">
            {{ isEditJsTool ? '保存并热重载' : '创建工具' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 日志详情 Modal -->
    <n-modal v-model:show="showLogDetailModal" preset="card" title="调用详情" style="width: 700px">
      <n-descriptions v-if="selectedLog" :column="2" label-placement="left" bordered>
        <n-descriptions-item label="工具名称">
          <n-tag type="info">{{ selectedLog.toolName }}</n-tag>
        </n-descriptions-item>
        <n-descriptions-item label="状态">
          <n-tag :type="selectedLog.success ? 'success' : 'error'">
            {{ selectedLog.success ? '成功' : '失败' }}
          </n-tag>
        </n-descriptions-item>
        <n-descriptions-item label="用户ID">{{ selectedLog.userId || '-' }}</n-descriptions-item>
        <n-descriptions-item label="耗时">{{ selectedLog.duration ? selectedLog.duration + 'ms' : '-' }}</n-descriptions-item>
        <n-descriptions-item label="时间" :span="2">{{ new Date(selectedLog.timestamp).toLocaleString('zh-CN') }}</n-descriptions-item>
      </n-descriptions>

      <n-card title="请求参数" size="small" style="margin-top: 16px" v-if="selectedLog?.arguments">
        <CodeBlock :code="JSON.stringify(selectedLog.arguments, null, 2)" language="json" />
      </n-card>

      <n-card title="返回结果" size="small" style="margin-top: 16px" v-if="selectedLog?.result">
        <CodeBlock :code="JSON.stringify(selectedLog.result, null, 2)" language="json" max-height="200px" />
      </n-card>

      <n-card title="错误信息" size="small" style="margin-top: 16px" v-if="selectedLog?.error">
        <CodeBlock :code="selectedLog.error" language="text" />
      </n-card>
    </n-modal>
  </n-space>
</template>
