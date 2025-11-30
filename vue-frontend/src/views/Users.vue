<script setup>
import { ref, onMounted, h, computed } from 'vue'
import { NCard, NDataTable, NSpace, NButton, NInput, NTag, NModal, NForm, NFormItem, NInputNumber, NSwitch, NPopconfirm, NEmpty, NIcon, NDescriptions, NDescriptionsItem, useMessage } from 'naive-ui'
import { SearchOutlined, RefreshOutlined, PersonOutlined } from '@vicons/material'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const users = ref([])
const searchQuery = ref('')
const showDetailModal = ref(false)
const selectedUser = ref(null)
const showSettingsModal = ref(false)

// 用户设置表单
const userSettings = ref({
  blocked: false
})

const columns = [
  {
    title: '用户ID',
    key: 'userId',
    width: 150,
    ellipsis: { tooltip: true }
  },
  {
    title: '昵称',
    key: 'nickname',
    width: 120,
    ellipsis: { tooltip: true }
  },
  {
    title: '对话数',
    key: 'conversationCount',
    width: 80,
    align: 'center'
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
    width: 140,
    render: (row) => formatTime(row.lastActivity)
  },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (row) => {
      if (row.blocked) {
        return h(NTag, { type: 'error', size: 'small' }, () => '已封禁')
      }
      return h(NTag, { type: 'success', size: 'small' }, () => '正常')
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    render: (row) => {
      return h(NSpace, { size: 'small' }, () => [
        h(NButton, {
          size: 'small',
          onClick: () => viewUser(row)
        }, () => '详情'),
        h(NButton, {
          size: 'small',
          type: 'info',
          onClick: () => openSettings(row)
        }, () => '设置'),
        h(NPopconfirm, {
          onPositiveClick: () => clearUserData(row.userId)
        }, {
          trigger: () => h(NButton, { size: 'small', type: 'warning' }, () => '清除'),
          default: () => '确定清除该用户的所有数据？'
        })
      ])
    }
  }
]

const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value
  const query = searchQuery.value.toLowerCase()
  return users.value.filter(u => 
    u.userId?.toLowerCase().includes(query) ||
    u.nickname?.toLowerCase().includes(query)
  )
})

async function fetchUsers() {
  loading.value = true
  try {
    const res = await axios.get('/api/users/list')
    if (res.data.code === 0) {
      users.value = res.data.data || []
    }
  } catch (err) {
    message.error('获取用户列表失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

function viewUser(user) {
  selectedUser.value = user
  showDetailModal.value = true
}

function openSettings(user) {
  selectedUser.value = user
  userSettings.value = {
    blocked: user.blocked || false
  }
  showSettingsModal.value = true
}

async function saveSettings() {
  try {
    const res = await axios.put(`/api/users/${selectedUser.value.userId}/settings`, userSettings.value)
    if (res.data.code === 0) {
      message.success('设置已保存')
      showSettingsModal.value = false
      fetchUsers()
    }
  } catch (err) {
    message.error('保存失败: ' + err.message)
  }
}

async function clearUserData(userId) {
  try {
    const res = await axios.delete(`/api/users/${userId}/data`)
    if (res.data.code === 0) {
      message.success('用户数据已清除')
      fetchUsers()
    }
  } catch (err) {
    message.error('清除失败: ' + err.message)
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

onMounted(() => {
  fetchUsers()
})
</script>

<template>
  <n-space vertical size="large">
    <n-card title="用户管理">
      <template #header-extra>
        <n-space>
          <n-input
            v-model:value="searchQuery"
            placeholder="搜索用户ID或昵称"
            clearable
            style="width: 200px"
          >
            <template #prefix>
              <n-icon><SearchOutlined /></n-icon>
            </template>
          </n-input>
          <n-button @click="fetchUsers" :loading="loading">
            <template #icon><n-icon><RefreshOutlined /></n-icon></template>
            刷新
          </n-button>
        </n-space>
      </template>

      <n-empty v-if="users.length === 0" description="暂无用户数据" />
      <n-data-table
        v-else
        :columns="columns"
        :data="filteredUsers"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :bordered="false"
        striped
      />
    </n-card>

    <!-- 用户详情弹窗 -->
    <n-modal v-model:show="showDetailModal" preset="card" title="用户详情" style="width: 500px">
      <n-descriptions v-if="selectedUser" :column="1" label-placement="left" bordered>
        <n-descriptions-item label="用户ID">{{ selectedUser.userId }}</n-descriptions-item>
        <n-descriptions-item label="昵称">{{ selectedUser.nickname || '-' }}</n-descriptions-item>
        <n-descriptions-item label="对话数">{{ selectedUser.conversationCount || 0 }}</n-descriptions-item>
        <n-descriptions-item label="消息数">{{ selectedUser.messageCount || 0 }}</n-descriptions-item>
        <n-descriptions-item label="Token使用">{{ selectedUser.tokenUsage || 0 }}</n-descriptions-item>
        <n-descriptions-item label="首次活动">{{ formatTime(selectedUser.firstActivity) }}</n-descriptions-item>
        <n-descriptions-item label="最后活动">{{ formatTime(selectedUser.lastActivity) }}</n-descriptions-item>
        <n-descriptions-item label="状态">
          <n-tag :type="selectedUser.blocked ? 'error' : 'success'" size="small">
            {{ selectedUser.blocked ? '已封禁' : '正常' }}
          </n-tag>
        </n-descriptions-item>
      </n-descriptions>
    </n-modal>

    <!-- 用户设置弹窗 -->
    <n-modal v-model:show="showSettingsModal" preset="card" title="用户设置" style="width: 350px">
      <n-form label-placement="left" label-width="80">
        <n-form-item label="封禁用户">
          <n-switch v-model:value="userSettings.blocked" />
          <span style="margin-left: 10px; color: #999">{{ userSettings.blocked ? '已封禁' : '正常' }}</span>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showSettingsModal = false">取消</n-button>
          <n-button type="primary" @click="saveSettings">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>
