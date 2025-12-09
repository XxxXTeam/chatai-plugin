<script setup>
import { ref, onMounted } from 'vue'
import { NCard, NSpace, NDataTable, NTag, useMessage } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const stats = ref([])
const loading = ref(false)

const columns = [
    { title: 'ID', key: 'id' },
    { title: '名称', key: 'name' },
    { 
        title: '状态', 
        key: 'status',
        render(row) {
            return h(NTag, {
                type: row.status === 'active' ? 'success' : row.status === 'error' ? 'error' : 'default'
            }, { default: () => row.status })
        }
    },
    { title: '优先级', key: 'priority' },
    {
        title: '今日用量',
        key: 'usage',
        render(row) {
            if (!row.usage) return '0'
            let text = `${row.usage.count} 次`
            if (row.quota && row.quota.daily) {
                const percent = Math.round((row.usage.count / row.quota.daily) * 100)
                text += ` (${percent}%)`
            }
            return text
        }
    },
    { 
        title: '最后检查', 
        key: 'lastHealthCheck',
        render: (row) => row.lastHealthCheck ? new Date(row.lastHealthCheck).toLocaleString() : '-'
    }
]

async function fetchStats() {
    loading.value = true
    try {
        const token = localStorage.getItem('token')
        const res = await axios.get('/api/stats/load-balancing', {
            headers: { Authorization: `Bearer ${token}` }
        })
        stats.value = res.data.data
    } catch (error) {
        message.error('获取统计失败: ' + (error.response?.data?.message || error.message))
    } finally {
        loading.value = false
    }
}

onMounted(() => {
    fetchStats()
})
</script>

<template>
    <n-space vertical>
        <n-card title="负载均衡监控">
            <n-data-table :columns="columns" :data="stats" :loading="loading" />
        </n-card>
    </n-space>
</template>
