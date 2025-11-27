<script setup>
import { ref, onMounted } from 'vue'
import { NGrid, NGridItem, NCard, NStatistic, NNumberAnimation, NSpace, NTag } from 'naive-ui'
import axios from 'axios'

const systemInfo = ref(null)
const stats = ref({
  totalConversations: 0,
  activeUsers: 0,
  apiCalls: 0,
  presets: 0
})

async function fetchInfo() {
  try {
    const res = await axios.get('/api/system/info')
    if (res.data.code === 0) {
      systemInfo.value = res.data.data.systemInfo
      stats.value = res.data.data.stats
    }
  } catch (err) {
    console.error('Failed to fetch system info', err)
  }
}

onMounted(() => {
  fetchInfo()
})
</script>

<template>
  <n-space vertical size="large">
    <n-grid :x-gap="12" :y-gap="12" :cols="4">
      <n-grid-item>
        <n-card>
          <n-statistic label="总对话数">
            <n-number-animation :from="0" :to="stats.totalConversations" />
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card>
          <n-statistic label="活跃用户">
            <n-number-animation :from="0" :to="stats.activeUsers" />
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card>
          <n-statistic label="API调用">
            <n-number-animation :from="0" :to="stats.apiCalls" />
          </n-statistic>
        </n-card>
      </n-grid-item>
      <n-grid-item>
        <n-card>
          <n-statistic label="预设数量">
            <n-number-animation :from="0" :to="stats.presets" />
          </n-statistic>
        </n-card>
      </n-grid-item>
    </n-grid>

    <n-card title="系统信息" v-if="systemInfo">
      <n-space>
        <n-tag type="info">Node.js: {{ systemInfo.nodejs }}</n-tag>
        <n-tag type="success">Platform: {{ systemInfo.platform }}</n-tag>
        <n-tag type="warning">Arch: {{ systemInfo.arch }}</n-tag>
        <n-tag type="error">Memory: {{ systemInfo.memory.used }} / {{ systemInfo.memory.total }}</n-tag>
      </n-space>
    </n-card>
  </n-space>
</template>
