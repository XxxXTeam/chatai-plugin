<script setup>
import { ref, onMounted, computed } from 'vue'
import { 
  NSpace, NCard, NDataTable, NButton, NTag, NInput, NSelect, 
  NModal, NForm, NFormItem, NSpin, useMessage, NPopconfirm, NCode, NCollapse, NCollapseItem
} from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const tools = ref([])
const loading = ref(false)
const searchText = ref('')
const filterServer = ref(null)
const showDetailModal = ref(false)
const selectedTool = ref(null)
const showTestModal = ref(false)
const testArgs = ref('{}')
const testResult = ref('')
const testLoading = ref(false)

const columns = [
  { title: '名称', key: 'name', width: 200, ellipsis: { tooltip: true } },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  { 
    title: '来源服务器', 
    key: 'serverName', 
    width: 150,
    render: (row) => {
      return h(NTag, { type: 'info' }, { default: () => row.serverName || 'System' })
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
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
    servers.add(t.serverName || 'System')
  })
  return [
    { label: '全部', value: null },
    ...Array.from(servers).map(s => ({ label: s, value: s }))
  ]
})

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
    result = result.filter(t => (t.serverName || 'System') === filterServer.value)
  }

  return result
})

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

onMounted(() => {
  fetchTools()
})
</script>

<template>
  <n-card title="MCP 工具管理">
    <template #header-extra>
      <n-button type="primary" @click="refreshTools" :loading="loading">
        刷新
      </n-button>
    </template>

    <n-space vertical>
      <!-- Filters -->
      <n-space>
        <n-input 
          v-model:value="searchText" 
          placeholder="搜索工具..." 
          style="width: 300px"
          clearable
        />
        <n-select 
          v-model:value="filterServer" 
          :options="serverOptions" 
          placeholder="筛选服务器"
          style="width: 200px"
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
          <n-code :code="JSON.stringify(selectedTool.inputSchema || selectedTool.parameters || {}, null, 2)" language="json" />
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
          <n-code :code="testResult" language="json" style="margin-top: 8px" />
        </div>
      </n-space>
    </n-modal>
  </n-card>
</template>
