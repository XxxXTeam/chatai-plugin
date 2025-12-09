<script setup>
import { ref, onMounted, computed, h } from 'vue'
import { 
  NSpace, NCard, NDataTable, NButton, NTag, NInput, NSelect, 
  NModal, NForm, NFormItem, NSpin, useMessage, NPopconfirm, NCollapse, NCollapseItem,
  NSwitch, NDynamicTags, NAlert
} from 'naive-ui'
import axios from 'axios'
import CodeBlock from '../components/CodeBlock.vue'

const message = useMessage()
const tools = ref([])
const loading = ref(false)
const searchText = ref('')
const filterServer = ref(null)
const filterType = ref(null)
const showDetailModal = ref(false)
const selectedTool = ref(null)
const showTestModal = ref(false)
const testArgs = ref('{}')
const testResult = ref('')
const testLoading = ref(false)
const showConfigModal = ref(false)

// 内置工具配置
const builtinConfig = ref({
  enabled: true,
  allowedTools: [],
  disabledTools: [],
  dangerousTools: ['kick_member', 'mute_member', 'recall_message'],
  allowDangerous: false
})

const columns = [
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
    render: (row) => {
      return row.serverName || 'builtin'
    }
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
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row) => {
      return h(NSpace, {}, {
        default: () => [
          h(NButton, {
            size: 'small',
            onClick: () => viewDetail(row)
          }, { default: () => '详情' }),
          h(NButton, {
            size: 'small',
            type: 'primary',
            onClick: () => openTestModal(row)
          }, { default: () => '测试' })
        ]
      })
    }
  }
]

// Computed
const serverOptions = computed(() => {
  const servers = new Set()
  tools.value.forEach(t => {
    servers.add(t.serverName || 'builtin')
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

// Methods
async function fetchTools() {
  loading.value = true
  try {
    const res = await axios.get('/api/tools/list')
    if (res.data.code === 0) {
      tools.value = res.data.data || []
      message.success(`成功加载 ${tools.value.length} 个工具`)
    }
  } catch (err) {
    message.error('获取工具列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
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
      if (prop.type === 'string') {
        args[key] = prop.default || ''
      } else if (prop.type === 'number') {
        args[key] = prop.default || 0
      } else if (prop.type === 'boolean') {
        args[key] = prop.default || false
      } else if (prop.type === 'array') {
        args[key] = prop.default || []
      } else if (prop.type === 'object') {
        args[key] = prop.default || {}
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
      message.success('工具测试成功')
    } else {
      testResult.value = `Error: ${res.data.message}`
      message.error('工具测试失败: ' + res.data.message)
    }
  } catch (err) {
    testResult.value = `Error: ${err.message}`
    message.error('工具测试失败: ' + err.message)
  } finally {
    testLoading.value = false
  }
}

async function refreshTools() {
  await fetchTools()
}

async function fetchBuiltinConfig() {
  try {
    const res = await axios.get('/api/tools/builtin/config')
    if (res.data.code === 0) {
      builtinConfig.value = res.data.data
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
    message.error('保存失败: ' + err.message)
  }
}

async function refreshBuiltinTools() {
  try {
    const res = await axios.post('/api/tools/builtin/refresh')
    if (res.data.code === 0) {
      message.success(`已刷新 ${res.data.data.count} 个内置工具`)
      await fetchTools()
    }
  } catch (err) {
    message.error('刷新失败: ' + err.message)
  }
}

onMounted(() => {
  fetchTools()
  fetchBuiltinConfig()
})
</script>

<template>
  <n-space vertical>
    <!-- 内置工具配置 -->
    <n-card title="内置工具配置" size="small">
      <n-space align="center">
        <n-form-item label="启用内置工具" label-placement="left">
          <n-switch v-model:value="builtinConfig.enabled" @update:value="saveBuiltinConfig" />
        </n-form-item>
        <n-form-item label="允许危险操作" label-placement="left">
          <n-switch v-model:value="builtinConfig.allowDangerous" @update:value="saveBuiltinConfig" />
        </n-form-item>
        <n-button @click="showConfigModal = true">高级配置</n-button>
        <n-button @click="refreshBuiltinTools">刷新内置工具</n-button>
      </n-space>
      <n-alert v-if="!builtinConfig.enabled" type="warning" style="margin-top: 12px">
        内置工具已禁用，AI将无法使用QQ相关功能
      </n-alert>
    </n-card>

    <!-- 工具列表 -->
    <n-card title="工具管理">
      <template #header-extra>
        <n-space>
          <n-tag type="success">内置: {{ builtinToolsCount }}</n-tag>
          <n-tag type="info">MCP: {{ mcpToolsCount }}</n-tag>
          <n-button type="primary" @click="refreshTools" :loading="loading">刷新</n-button>
        </n-space>
      </template>

      <n-space vertical>
        <!-- Filters -->
        <n-space>
          <n-input 
            v-model:value="searchText" 
            placeholder="搜索工具..." 
            style="width: 250px"
            clearable
          />
          <n-select 
            v-model:value="filterType" 
            :options="typeOptions" 
            placeholder="类型"
            style="width: 120px"
            clearable
          />
          <n-select 
            v-model:value="filterServer" 
            :options="serverOptions" 
            placeholder="来源"
            style="width: 150px"
            clearable
          />
        </n-space>

      <!-- Tools Table -->
      <n-spin :show="loading">
        <n-data-table 
          :columns="columns" 
          :data="filteredTools" 
          :pagination="{ pageSize: 10 }"
          :bordered="false"
        />
      </n-spin>
    </n-space>

    <!-- Detail Modal -->
    <n-modal v-model:show="showDetailModal" preset="card" title="工具详情" style="width: 600px">
      <n-space vertical v-if="selectedTool">
        <div>
          <strong>名称:</strong> {{ selectedTool.name }}
        </div>
        <div>
          <strong>描述:</strong> {{ selectedTool.description }}
        </div>
        <div>
          <strong>来源:</strong> <n-tag type="info">{{ selectedTool.serverName || 'System' }}</n-tag>
        </div>
        <div>
          <strong>输入参数:</strong>
          <CodeBlock :code="JSON.stringify(selectedTool.inputSchema || selectedTool.parameters || {}, null, 2)" language="json" />
        </div>
      </n-space>
    </n-modal>

    <!-- Test Modal -->
    <n-modal v-model:show="showTestModal" preset="card" title="测试工具" style="width: 700px">
      <n-space vertical v-if="selectedTool">
        <div>
          <strong>工具:</strong> {{ selectedTool.name }}
        </div>
        
        <n-form>
          <n-form-item label="参数 (JSON)">
            <n-input 
              v-model:value="testArgs" 
              type="textarea" 
              :rows="8"
              placeholder='{"key": "value"}'
            />
          </n-form-item>
        </n-form>

        <n-space>
          <n-button type="primary" @click="testTool" :loading="testLoading">
            执行测试
          </n-button>
          <n-button @click="testArgs = JSON.stringify(getDefaultArgs(selectedTool), null, 2)">
            重置参数
          </n-button>
        </n-space>

        <div v-if="testResult">
          <strong>测试结果:</strong>
          <CodeBlock :code="testResult" language="json" style="margin-top: 8px" />
        </div>
      </n-space>
    </n-modal>
    </n-card>

    <!-- 内置工具高级配置 Modal -->
    <n-modal v-model:show="showConfigModal" preset="card" title="内置工具高级配置" style="width: 600px">
      <n-form label-placement="left" label-width="120">
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
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showConfigModal = false">取消</n-button>
          <n-button type="primary" @click="saveBuiltinConfig(); showConfigModal = false">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>
