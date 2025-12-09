<script setup>
import { ref, onMounted, computed } from 'vue'
import { NGrid, NGridItem, NCard, NStatistic, NNumberAnimation, NSpace, NTag, NProgress, NList, NListItem, NThing, NButton, NIcon, NEmpty, NAlert } from 'naive-ui'
import { RefreshOutlined, ChatOutlined, PersonOutlined, ApiOutlined, SettingsOutlined } from '@vicons/material'
import axios from 'axios'

const loading = ref(false)
const systemInfo = ref(null)
const channels = ref([])
const recentLogs = ref([])
const stats = ref({
  totalConversations: 0,
  activeUsers: 0,
  totalTokens: 0,
  presets: 0,
  tools: 0,
  channels: 0
})

// 渠道状态统计
const channelStats = computed(() => {
  const total = channels.value.length
  const enabled = channels.value.filter(c => c.enabled !== false).length
  const healthy = channels.value.filter(c => c.status === 'normal' || c.status === 'idle').length
  return { total, enabled, healthy }
})

async function fetchDashboard() {
  loading.value = true
  try {
    // 获取系统信息
    const sysRes = await axios.get('/api/system/info')
    if (sysRes.data.code === 0) {
      systemInfo.value = sysRes.data.data.systemInfo
      if (sysRes.data.data.stats) {
        Object.assign(stats.value, sysRes.data.data.stats)
      }
    }

    // 获取渠道列表
    const chRes = await axios.get('/api/channels/list')
    if (chRes.data.code === 0) {
      channels.value = chRes.data.data || []
      stats.value.channels = channels.value.length
    }

    // 获取工具数量
    const toolsRes = await axios.get('/api/tools/list')
    if (toolsRes.data.code === 0) {
      stats.value.tools = toolsRes.data.data?.length || 0
    }

  } catch (err) {
    console.error('Failed to fetch dashboard data', err)
  } finally {
    loading.value = false
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getChannelStatusType(status) {
  switch (status) {
    case 'normal':
    case 'idle': return 'success'
    case 'busy': return 'warning'
    case 'error': return 'error'
    default: return 'default'
  }
}

onMounted(() => {
  fetchDashboard()
})
</script>

<template>
  <n-space vertical size="large">
    <!-- 刷新按钮 -->
    <n-space justify="end">
      <n-button @click="fetchDashboard" :loading="loading" size="small">
        <template #icon>
          <n-icon><RefreshOutlined /></n-icon>
        </template>
        刷新
      </n-button>
    </n-space>

    <!-- 统计卡片 -->
    <n-grid :x-gap="16" :y-gap="16" :cols="4" responsive="screen" :item-responsive="true">
      <n-grid-item :span="1">
        <n-card class="stat-card">
          <n-statistic label="渠道数量">
            <template #prefix>
              <n-icon color="#18a058"><ApiOutlined /></n-icon>
            </template>
            <n-number-animation :from="0" :to="stats.channels" />
          </n-statistic>
          <template #footer>
            <n-space :size="4">
              <n-tag size="small" type="success">{{ channelStats.enabled }} 启用</n-tag>
              <n-tag size="small" :type="channelStats.healthy === channelStats.enabled ? 'success' : 'warning'">
                {{ channelStats.healthy }} 正常
              </n-tag>
            </n-space>
          </template>
        </n-card>
      </n-grid-item>

      <n-grid-item :span="1">
        <n-card class="stat-card">
          <n-statistic label="可用工具">
            <template #prefix>
              <n-icon color="#2080f0"><SettingsOutlined /></n-icon>
            </template>
            <n-number-animation :from="0" :to="stats.tools" />
          </n-statistic>
          <template #footer>
            <n-tag size="small" type="info">MCP 工具</n-tag>
          </template>
        </n-card>
      </n-grid-item>

      <n-grid-item :span="1">
        <n-card class="stat-card">
          <n-statistic label="对话数">
            <template #prefix>
              <n-icon color="#f0a020"><ChatOutlined /></n-icon>
            </template>
            <n-number-animation :from="0" :to="stats.totalConversations" />
          </n-statistic>
          <template #footer>
            <n-tag size="small" type="warning">今日</n-tag>
          </template>
        </n-card>
      </n-grid-item>

      <n-grid-item :span="1">
        <n-card class="stat-card">
          <n-statistic label="活跃用户">
            <template #prefix>
              <n-icon color="#d03050"><PersonOutlined /></n-icon>
            </template>
            <n-number-animation :from="0" :to="stats.activeUsers" />
          </n-statistic>
          <template #footer>
            <n-tag size="small" type="error">今日</n-tag>
          </template>
        </n-card>
      </n-grid-item>
    </n-grid>

    <!-- 渠道状态 -->
    <n-card title="渠道状态" size="small">
      <n-empty v-if="channels.length === 0" description="暂无渠道" />
      <n-list v-else>
        <n-list-item v-for="channel in channels.slice(0, 5)" :key="channel.id">
          <n-thing>
            <template #header>
              <n-space align="center" :size="8">
                <span>{{ channel.name }}</span>
                <n-tag size="tiny" :type="channel.enabled !== false ? 'success' : 'default'">
                  {{ channel.enabled !== false ? '启用' : '禁用' }}
                </n-tag>
                <n-tag size="tiny" :type="getChannelStatusType(channel.status)">
                  {{ channel.status || 'idle' }}
                </n-tag>
              </n-space>
            </template>
            <template #description>
              <n-space :size="12">
                <span style="color: #999; font-size: 12px;">{{ channel.baseUrl }}</span>
                <span style="color: #999; font-size: 12px;">{{ channel.models?.length || 0 }} 个模型</span>
              </n-space>
            </template>
          </n-thing>
        </n-list-item>
      </n-list>
      <template #footer v-if="channels.length > 5">
        <router-link to="/channels" style="color: #18a058; font-size: 13px;">
          查看全部 {{ channels.length }} 个渠道 →
        </router-link>
      </template>
    </n-card>

    <!-- 系统信息 -->
    <n-card title="系统信息" size="small" v-if="systemInfo">
      <n-grid :cols="4" :x-gap="12">
        <n-grid-item>
          <div class="info-item">
            <span class="info-label">Node.js</span>
            <span class="info-value">{{ systemInfo.nodejs }}</span>
          </div>
        </n-grid-item>
        <n-grid-item>
          <div class="info-item">
            <span class="info-label">平台</span>
            <span class="info-value">{{ systemInfo.platform }}</span>
          </div>
        </n-grid-item>
        <n-grid-item>
          <div class="info-item">
            <span class="info-label">架构</span>
            <span class="info-value">{{ systemInfo.arch }}</span>
          </div>
        </n-grid-item>
        <n-grid-item>
          <div class="info-item">
            <span class="info-label">内存</span>
            <span class="info-value">{{ systemInfo.memory?.used }} / {{ systemInfo.memory?.total }}</span>
          </div>
        </n-grid-item>
      </n-grid>
    </n-card>

    <!-- 快捷操作 -->
    <n-card title="快捷操作" size="small">
      <n-space>
        <router-link to="/channels">
          <n-button type="primary">渠道管理</n-button>
        </router-link>
        <router-link to="/tools">
          <n-button>工具管理</n-button>
        </router-link>
        <router-link to="/presets">
          <n-button>预设管理</n-button>
        </router-link>
        <router-link to="/settings">
          <n-button>系统设置</n-button>
        </router-link>
      </n-space>
    </n-card>
  </n-space>
</template>

<style scoped>
.stat-card {
  text-align: center;
}

.stat-card :deep(.n-statistic .n-statistic-value) {
  font-size: 28px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  color: #999;
}

.info-value {
  font-size: 14px;
  font-weight: 500;
}
</style>
