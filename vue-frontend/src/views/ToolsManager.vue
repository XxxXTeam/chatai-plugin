<script setup>
import { ref, onMounted, computed, h } from 'vue'
import { 
  NSpace, NCard, NDataTable, NButton, NTag, NInput, NSelect, 
  NModal, NForm, NFormItem, NSpin, useMessage, NPopconfirm, NCode, 
  NSwitch, NDynamicTags, NAlert, NTabs, NTabPane, NInputNumber,
  NGrid, NGridItem, NStatistic, NDivider, NCollapse, NCollapseItem
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

onMounted(() => {
  fetchTools()
  fetchServers()
  fetchBuiltinConfig()
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
  </n-space>
</template>
