<script setup>
import { ref, onMounted, h } from 'vue'
import { NCard, NDataTable, NSpace, NButton, NInput, NSelect, NTag, NModal, NEmpty, NIcon, useMessage, NCode, NDescriptions, NDescriptionsItem } from 'naive-ui'
import { SearchOutlined, RefreshOutlined, DeleteOutlined } from '@vicons/material'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const logs = ref([])
const searchQuery = ref('')
const selectedTool = ref(null)
const showDetailModal = ref(false)
const selectedLog = ref(null)

const columns = [
  {
    title: '时间',
    key: 'timestamp',
    width: 160,
    render: (row) => formatTime(row.timestamp)
  },
  {
    title: '工具',
    key: 'toolName',
    width: 180,
    render: (row) => h(NTag, { type: 'info', size: 'small' }, () => row.toolName)
  },
  {
    title: '用户',
    key: 'userId',
    width: 120,
    ellipsis: { tooltip: true }
  },
  {
    title: '状态',
    key: 'success',
    width: 80,
    render: (row) => h(NTag, { 
      type: row.success ? 'success' : 'error',
      size: 'small'
    }, () => row.success ? '成功' : '失败')
  },
  {
    title: '耗时',
    key: 'duration',
    width: 80,
    render: (row) => row.duration ? `${row.duration}ms` : '-'
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render: (row) => h(NButton, {
      size: 'small',
      onClick: () => viewDetail(row)
    }, () => '详情')
  }
]

// 获取所有工具名称用于筛选
const toolOptions = ref([])

async function fetchLogs() {
  loading.value = true
  try {
    const params = {}
    if (selectedTool.value) params.tool = selectedTool.value
    if (searchQuery.value) params.search = searchQuery.value

    const res = await axios.get('/api/tools/logs', { params })
    if (res.data.code === 0) {
      logs.value = res.data.data || []
      // 提取工具名称
      const tools = new Set(logs.value.map(l => l.toolName))
      toolOptions.value = Array.from(tools).map(t => ({ label: t, value: t }))
    }
  } catch (error) {
    message.error('获取日志失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

function viewDetail(log) {
  selectedLog.value = log
  showDetailModal.value = true
}

async function clearLogs() {
  try {
    const res = await axios.delete('/api/tools/logs')
    if (res.data.code === 0) {
      message.success('日志已清空')
      logs.value = []
    }
  } catch (error) {
    message.error('清空失败: ' + error.message)
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatJson(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

onMounted(() => {
  fetchLogs()
})
</script>

<template>
  <n-space vertical size="large">
    <n-card title="工具调用日志">
      <template #header-extra>
        <n-space>
          <n-select
            v-model:value="selectedTool"
            :options="toolOptions"
            placeholder="筛选工具"
            clearable
            style="width: 180px"
            @update:value="fetchLogs"
          />
          <n-input
            v-model:value="searchQuery"
            placeholder="搜索..."
            clearable
            style="width: 150px"
            @keyup.enter="fetchLogs"
          >
            <template #prefix>
              <n-icon><SearchOutlined /></n-icon>
            </template>
          </n-input>
          <n-button @click="fetchLogs" :loading="loading">
            <template #icon><n-icon><RefreshOutlined /></n-icon></template>
            刷新
          </n-button>
          <n-button type="error" @click="clearLogs" v-if="logs.length > 0">
            <template #icon><n-icon><DeleteOutlined /></n-icon></template>
            清空
          </n-button>
        </n-space>
      </template>

      <n-empty v-if="logs.length === 0" description="暂无日志记录" />
      <n-data-table
        v-else
        :columns="columns"
        :data="logs"
        :loading="loading"
        :pagination="{ pageSize: 50 }"
        :bordered="false"
        striped
        max-height="60vh"
      />
    </n-card>

    <!-- 详情弹窗 -->
    <n-modal v-model:show="showDetailModal" preset="card" title="调用详情" style="width: 700px">
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
        <n-descriptions-item label="时间" :span="2">{{ formatTime(selectedLog.timestamp) }}</n-descriptions-item>
      </n-descriptions>

      <n-card title="请求参数" size="small" style="margin-top: 16px" v-if="selectedLog?.arguments">
        <n-code :code="formatJson(selectedLog.arguments)" language="json" />
      </n-card>

      <n-card title="返回结果" size="small" style="margin-top: 16px" v-if="selectedLog?.result">
        <n-code :code="formatJson(selectedLog.result)" language="json" style="max-height: 300px; overflow: auto;" />
      </n-card>

      <n-card title="错误信息" size="small" style="margin-top: 16px" v-if="selectedLog?.error">
        <n-code :code="selectedLog.error" language="text" />
      </n-card>
    </n-modal>
  </n-space>
</template>
