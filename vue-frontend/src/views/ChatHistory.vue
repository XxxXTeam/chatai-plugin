<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NDataTable, NSpace, NButton, NInput, NSelect, NModal, NList, NListItem, NThing, NTag, NEmpty, NIcon, NPopconfirm, useMessage } from 'naive-ui'
import { SearchOutlined, DeleteOutlined, RefreshOutlined, DownloadOutlined } from '@vicons/material'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const conversations = ref([])
const searchQuery = ref('')
const selectedConversation = ref(null)
const showDetailModal = ref(false)
const conversationMessages = ref([])

// 表格列定义
const columns = [
  {
    title: '会话ID',
    key: 'id',
    width: 200,
    ellipsis: { tooltip: true },
    render: (row) => row.id?.substring(0, 16) + '...'
  },
  {
    title: '用户',
    key: 'userId',
    width: 150,
    ellipsis: { tooltip: true }
  },
  {
    title: '消息数',
    key: 'messageCount',
    width: 80,
    align: 'center'
  },
  {
    title: '最后活动',
    key: 'lastActivity',
    width: 160,
    render: (row) => formatTime(row.lastActivity)
  },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row) => {
      return h(NSpace, { size: 'small' }, () => [
        h(NButton, {
          size: 'small',
          onClick: () => viewConversation(row)
        }, () => '查看'),
        h(NButton, {
          size: 'small',
          type: 'info',
          onClick: () => exportConversation(row)
        }, () => '导出'),
        h(NPopconfirm, {
          onPositiveClick: () => deleteConversation(row.id)
        }, {
          trigger: () => h(NButton, { size: 'small', type: 'error' }, () => '删除'),
          default: () => '确定删除此会话？'
        })
      ])
    }
  }
]

// 过滤后的会话列表
const filteredConversations = computed(() => {
  if (!searchQuery.value) return conversations.value
  const query = searchQuery.value.toLowerCase()
  return conversations.value.filter(c => 
    c.id?.toLowerCase().includes(query) ||
    c.userId?.toLowerCase().includes(query)
  )
})

async function fetchConversations() {
  loading.value = true
  try {
    const res = await axios.get('/api/conversations/list')
    if (res.data.code === 0) {
      conversations.value = res.data.data || []
    }
  } catch (err) {
    message.error('获取会话列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function viewConversation(conv) {
  selectedConversation.value = conv
  try {
    const res = await axios.get(`/api/conversations/${conv.id}/messages`)
    if (res.data.code === 0) {
      conversationMessages.value = res.data.data || []
      showDetailModal.value = true
    }
  } catch (err) {
    message.error('获取会话详情失败: ' + err.message)
  }
}

async function deleteConversation(id) {
  try {
    const res = await axios.delete(`/api/conversations/${id}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      fetchConversations()
    } else {
      message.error('删除失败: ' + res.data.message)
    }
  } catch (err) {
    message.error('删除失败: ' + err.message)
  }
}

// 一键清空所有对话
async function clearAllConversations() {
  loading.value = true
  try {
    const res = await axios.delete('/api/conversations/clear-all')
    if (res.data.code === 0) {
      const count = res.data.data?.deletedCount ?? res.data.deletedCount ?? 0
      message.success(`清空成功，共删除 ${count} 条对话`)
      conversations.value = []
    } else {
      message.error('清空失败: ' + res.data.message)
    }
  } catch (err) {
    message.error('清空失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getMessageContent(msg) {
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n')
  }
  return JSON.stringify(msg.content)
}

// 导出对话
async function exportConversation(conv) {
  try {
    const res = await axios.get(`/api/conversations/${conv.id}/messages`)
    if (res.data.code === 0) {
      const messages = res.data.data || []
      
      // 格式化为文本
      const content = messages.map(msg => {
        const role = msg.role === 'user' ? '👤 用户' : msg.role === 'assistant' ? '🤖 助手' : '📋 系统'
        const text = getMessageContent(msg)
        const time = formatTime(msg.timestamp)
        return `${role} [${time}]\n${text}\n`
      }).join('\n---\n\n')

      // 创建下载
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `conversation_${conv.userId}_${new Date().toISOString().slice(0, 10)}.txt`
      a.click()
      URL.revokeObjectURL(url)
      
      message.success('导出成功')
    }
  } catch (err) {
    message.error('导出失败: ' + err.message)
  }
}

import { h } from 'vue'

onMounted(() => {
  fetchConversations()
})
</script>

<template>
  <n-space vertical size="large">
    <n-card title="对话历史">
      <template #header-extra>
        <n-space>
          <n-input
            v-model:value="searchQuery"
            placeholder="搜索会话ID或用户"
            clearable
            style="width: 200px"
          >
            <template #prefix>
              <n-icon><SearchOutlined /></n-icon>
            </template>
          </n-input>
          <n-button @click="fetchConversations" :loading="loading">
            <template #icon>
              <n-icon><RefreshOutlined /></n-icon>
            </template>
            刷新
          </n-button>
          <n-popconfirm @positive-click="clearAllConversations">
            <template #trigger>
              <n-button type="error" :disabled="conversations.length === 0">
                <template #icon>
                  <n-icon><DeleteOutlined /></n-icon>
                </template>
                清空所有
              </n-button>
            </template>
            确定清空所有对话历史？此操作不可恢复！
          </n-popconfirm>
        </n-space>
      </template>

      <n-data-table
        :columns="columns"
        :data="filteredConversations"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :bordered="false"
        striped
      />
    </n-card>

    <!-- 会话详情弹窗 -->
    <n-modal
      v-model:show="showDetailModal"
      preset="card"
      :title="`会话详情 - ${selectedConversation?.userId || ''}`"
      style="width: 700px; max-height: 80vh;"
    >
      <div style="max-height: 60vh; overflow-y: auto;">
        <n-empty v-if="conversationMessages.length === 0" description="暂无消息" />
        <n-list v-else>
          <n-list-item v-for="(msg, idx) in conversationMessages" :key="idx">
            <n-thing>
              <template #header>
                <n-space align="center" :size="8">
                  <n-tag :type="msg.role === 'user' ? 'info' : msg.role === 'assistant' ? 'success' : 'warning'" size="small">
                    {{ msg.role }}
                  </n-tag>
                  <span style="color: #999; font-size: 12px;">{{ formatTime(msg.timestamp) }}</span>
                </n-space>
              </template>
              <template #description>
                <div style="white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto;">
                  {{ getMessageContent(msg) }}
                </div>
              </template>
            </n-thing>
          </n-list-item>
        </n-list>
      </div>
    </n-modal>
  </n-space>
</template>

<style scoped>
:deep(.n-list-item) {
  padding: 12px 0;
}
</style>
