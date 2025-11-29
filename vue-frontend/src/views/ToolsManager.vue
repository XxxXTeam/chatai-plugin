<script setup>
import { ref, onMounted, computed, h } from 'vue'
import { 
  NSpace, NCard, NDataTable, NButton, NTag, NInput, NSelect, 
  NModal, NForm, NFormItem, NSpin, useMessage, NPopconfirm, NCode, 
  NSwitch, NDynamicTags, NAlert, NTabs, NTabPane, NInputNumber,
  NGrid, NGridItem, NStatistic, NDivider, NCollapse, NCollapseItem,
  NText, NScrollbar
} from 'naive-ui'
import axios from 'axios'

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
      message.success('配置已保存')
      await fetchTools()
    }
  } catch (err) {
    message.error('保存失败')
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
      message.success('测试成功')
    } else {
      testResult.value = `Error: ${res.data.message}`
    }
  } catch (err) {
    testResult.value = `Error: ${err.message}`
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

onMounted(() => {
  fetchTools()
  fetchServers()
  fetchBuiltinConfig()
  fetchCustomTools()
})
</script>

<template>
  <n-space vertical :size="16">
    <!-- 统计卡片 -->
    <n-grid :cols="4" :x-gap="16">
      <n-grid-item>
        <n-card size="small">
          <n-statistic label="内置工具" :value="builtinToolsCount" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card size="small">
          <n-statistic label="MCP工具" :value="mcpToolsCount" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card size="small">
          <n-statistic label="MCP服务器" :value="mcpServers.length" />
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card size="small">
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
        <n-code :code="JSON.stringify(selectedTool.inputSchema || {}, null, 2)" language="json" />
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
          <n-code :code="testResult" language="json" style="margin-top: 8px" />
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
            <n-input 
              v-model:value="customToolForm.parameters" 
              type="textarea" 
              :rows="8" 
              placeholder='{
  "type": "object",
  "properties": {
    "param1": { "type": "string", "description": "参数说明" }
  },
  "required": ["param1"]
}'
              style="font-family: monospace"
            />
          </n-card>

          <!-- 代码编辑器 -->
          <n-card size="small" title="工具代码 (JavaScript)">
            <template #header-extra>
              <n-space>
                <n-text depth="3" style="font-size: 12px">可用变量: args, ctx</n-text>
              </n-space>
            </template>
            <n-input 
              v-model:value="customToolForm.handler" 
              type="textarea" 
              :rows="15" 
              placeholder="// 编写工具逻辑
// args: 用户传入的参数
// ctx: 上下文对象
//   - ctx.getBot(): 获取 Bot 实例
//   - ctx.getEvent(): 获取当前事件

return { text: '结果', data: {} }"
              style="font-family: monospace"
            />
          </n-card>

          <!-- 帮助信息 -->
          <n-collapse>
            <n-collapse-item title="📖 编写指南" name="help">
              <n-space vertical>
                <n-alert type="info" title="可用变量">
                  <ul style="margin: 0; padding-left: 20px">
                    <li><code>args</code> - 用户传入的参数对象</li>
                    <li><code>ctx.getBot()</code> - 获取 Bot 实例，可调用 QQ API</li>
                    <li><code>ctx.getEvent()</code> - 获取当前消息事件</li>
                    <li><code>fetch</code> - 发送 HTTP 请求</li>
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
  </n-space>
</template>
