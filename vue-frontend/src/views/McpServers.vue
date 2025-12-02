<script setup>
import { ref, onMounted, h } from 'vue'
import { NSpace, NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect, NTag, useMessage, NPopconfirm, NTabPane, NTabs } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const servers = ref([])
const showModal = ref(false)
const showImportModal = ref(false)
const loading = ref(false)
const formRef = ref(null)
const importJson = ref('')

const formValue = ref({
  name: '',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
  headers: '',
  env: '',
  package: ''
})

const rules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' },
  type: { required: true, message: '请选择类型', trigger: 'change' }
}

const columns = [
  { title: '名称', key: 'name' },
  { title: '类型', key: 'type' },
  { 
    title: '状态', 
    key: 'status',
    render(row) {
      return h(NTag, {
        type: row.status === 'connected' ? 'success' : 'error'
      }, { default: () => row.status })
    }
  },
  { title: '工具数', key: 'toolsCount' },
  { title: '资源数', key: 'resourcesCount' },
  {
    title: '操作',
    key: 'actions',
    render(row) {
      return h(NSpace, {}, {
        default: () => [
          h(NButton, {
            size: 'small',
            onClick: () => handleReconnect(row)
          }, { default: () => '重连' }),
          h(NPopconfirm, {
            onPositiveClick: () => handleDelete(row)
          }, {
            trigger: () => h(NButton, {
              size: 'small',
              type: 'error'
            }, { default: () => '删除' }),
            default: () => '确定要删除吗？'
          })
        ]
      })
    }
  }
]

async function fetchServers() {
  try {
    const res = await axios.get('/api/mcp/servers')
    if (res.data.code === 0) {
      servers.value = res.data.data
    }
  } catch (err) {
    message.error('获取服务器列表失败')
  }
}

function addServer() {
  formValue.value = {
    name: '',
    type: 'stdio',
    command: '',
    args: '',
    url: '',
    headers: '',
    env: '',
    package: ''
  }
  showModal.value = true
}

async function handleReconnect(row) {
  try {
    const res = await axios.post(`/api/mcp/servers/${row.name}/reconnect`, {})
    if (res.data.code === 0) {
      message.success('重连成功')
      fetchServers()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('重连失败')
  }
}

async function handleDelete(row) {
  try {
    const res = await axios.delete(`/api/mcp/servers/${row.name}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      fetchServers()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('删除失败')
  }
}

async function handleSubmit() {
  formRef.value?.validate(async (errors) => {
    if (!errors) {
      try {
        const config = {
          type: formValue.value.type
        }

        if (config.type === 'stdio') {
          config.command = formValue.value.command
          if (formValue.value.args) {
            config.args = formValue.value.args.split(' ').filter(a => a)
          }
        } else if (config.type === 'npm') {
          config.package = formValue.value.package
          if (formValue.value.args) {
            config.args = formValue.value.args.split(' ').filter(a => a)
          }
        } else {
          // sse 或 http
          config.url = formValue.value.url
          if (formValue.value.headers) {
            try {
              config.headers = JSON.parse(formValue.value.headers)
            } catch (e) {
              message.error('Headers 格式错误 (JSON)')
              return
            }
          }
        }
        
        // 通用环境变量
        if (formValue.value.env) {
          try {
            config.env = JSON.parse(formValue.value.env)
          } catch (e) {
            message.error('环境变量格式错误 (JSON)')
            return
          }
        }

        const res = await axios.post('/api/mcp/servers', {
          name: formValue.value.name,
          config
        })

        if (res.data.code === 0) {
          message.success('添加成功')
          showModal.value = false
          fetchServers()
        } else {
          message.error(res.data.message)
        }
      } catch (err) {
        message.error('添加失败: ' + (err.response?.data?.message || err.message))
      }
    }
  })
}

async function handleImport() {
  if (!importJson.value.trim()) {
    message.error('请输入 JSON 配置')
    return
  }
  
  try {
    const config = JSON.parse(importJson.value)
    const res = await axios.post('/api/mcp/import', config)
    
    if (res.data.code === 0) {
      const result = res.data.data
      message.success(`导入完成: 成功 ${result.success}/${result.total}`)
      showImportModal.value = false
      importJson.value = ''
      fetchServers()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      message.error('JSON 格式错误')
    } else {
      message.error('导入失败: ' + (err.response?.data?.message || err.message))
    }
  }
}

onMounted(() => {
  fetchServers()
})
</script>

<template>
  <n-space vertical>
    <n-card title="MCP 服务器管理">
      <template #header-extra>
        <n-space>
          <n-button @click="showImportModal = true">导入配置</n-button>
          <n-button type="primary" @click="addServer">添加服务器</n-button>
        </n-space>
      </template>
      <n-data-table :columns="columns" :data="servers" />
    </n-card>

    <!-- 添加服务器模态框 -->
    <n-modal v-model:show="showModal" preset="card" title="添加 MCP 服务器" style="width: 600px">
      <n-form ref="formRef" :model="formValue" :rules="rules" label-placement="left" label-width="100">
        <n-form-item label="名称" path="name">
          <n-input v-model:value="formValue.name" placeholder="请输入服务器名称" />
        </n-form-item>
        <n-form-item label="类型" path="type">
          <n-select v-model:value="formValue.type" :options="[
            { label: 'Stdio (本地命令)', value: 'stdio' },
            { label: 'NPM 包 (npx)', value: 'npm' },
            { label: 'SSE (Server-Sent Events)', value: 'sse' },
            { label: 'HTTP', value: 'http' }
          ]" />
        </n-form-item>
        
        <!-- stdio 类型 -->
        <template v-if="formValue.type === 'stdio'">
          <n-form-item label="命令" path="command">
            <n-input v-model:value="formValue.command" placeholder="例如: node, npx, python" />
          </n-form-item>
          <n-form-item label="参数">
            <n-input v-model:value="formValue.args" placeholder="空格分隔，例如: -y @modelcontextprotocol/server-filesystem /" />
          </n-form-item>
        </template>

        <!-- npm 类型 -->
        <template v-else-if="formValue.type === 'npm'">
          <n-form-item label="NPM 包">
            <n-input v-model:value="formValue.package" placeholder="例如: @upstash/context7-mcp" />
          </n-form-item>
          <n-form-item label="参数">
            <n-input v-model:value="formValue.args" placeholder="空格分隔，例如: --api-key YOUR_KEY" />
          </n-form-item>
        </template>

        <!-- sse/http 类型 -->
        <template v-else>
          <n-form-item label="URL">
            <n-input v-model:value="formValue.url" placeholder="例如: https://mcp.context7.com/mcp" />
          </n-form-item>
          <n-form-item label="Headers">
            <n-input v-model:value="formValue.headers" type="textarea" :rows="2"
              placeholder='JSON格式，例如: {"Authorization": "Bearer xxx"}' />
          </n-form-item>
        </template>

        <!-- 通用环境变量 -->
        <n-form-item label="环境变量">
          <n-input v-model:value="formValue.env" type="textarea" :rows="2"
            placeholder='JSON格式，例如: {"API_KEY": "xxx"}' />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSubmit">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 导入配置模态框 -->
    <n-modal v-model:show="showImportModal" preset="card" title="导入 MCP 配置" style="width: 700px">
      <n-input v-model:value="importJson" type="textarea" :rows="15"
        placeholder='{
  "servers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "filesystem": {
      "type": "npm",
      "package": "@modelcontextprotocol/server-filesystem",
      "args": ["/path/to/dir"]
    }
  }
}' />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showImportModal = false">取消</n-button>
          <n-button type="primary" @click="handleImport">导入</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>
