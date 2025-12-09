<script setup>
import { ref, h, onMounted } from 'vue'
import { NCard, NSpace, NInput, NButton, NDataTable, useMessage, NModal, NForm, NFormItem, NSelect, NEmpty, NTag, NPopconfirm, NIcon, NAlert, NStatistic, NGrid, NGridItem } from 'naive-ui'
import { SearchOutlined, DeleteOutlined, RefreshOutlined, AddOutlined } from '@vicons/material'
import axios from 'axios'

const message = useMessage()
const userId = ref('')
const memories = ref([])
const userList = ref([])
const loading = ref(false)
const showAddModal = ref(false)
const newMemory = ref({ content: '', metadata: '{}' })
const stats = ref({ totalUsers: 0, totalMemories: 0 })

const columns = [
    { 
        title: 'ID', 
        key: 'id',
        width: 80,
        ellipsis: { tooltip: true }
    },
    { 
        title: '内容', 
        key: 'content',
        ellipsis: { tooltip: true },
        render: (row) => {
            const content = typeof row.content === 'string' ? row.content : JSON.stringify(row.content)
            return content.length > 100 ? content.substring(0, 100) + '...' : content
        }
    },
    { 
        title: '相似度', 
        key: 'score',
        width: 80,
        render: (row) => row.score ? (row.score * 100).toFixed(1) + '%' : '-'
    },
    { 
        title: '时间', 
        key: 'timestamp', 
        width: 160,
        render: (row) => row.timestamp ? new Date(row.timestamp).toLocaleString('zh-CN') : '-'
    },
    {
        title: '操作',
        key: 'actions',
        width: 100,
        render(row) {
            return h(NPopconfirm, {
                onPositiveClick: () => deleteMemory(row.id)
            }, {
                trigger: () => h(NButton, {
                    size: 'small',
                    type: 'error'
                }, { default: () => '删除' }),
                default: () => '确定删除此记忆？'
            })
        }
    }
]

// 获取用户列表
async function fetchUserList() {
    try {
        const res = await axios.get('/api/memory/users')
        if (res.data.code === 0) {
            userList.value = res.data.data || []
            stats.value.totalUsers = userList.value.length
        }
    } catch (error) {
        console.error('获取用户列表失败:', error)
    }
}

async function fetchMemories() {
    if (!userId.value) {
        message.warning('请选择或输入用户ID')
        return
    }

    loading.value = true
    try {
        const res = await axios.get(`/api/memory/${userId.value}`)
        if (res.data.code === 0) {
            memories.value = res.data.data || []
            stats.value.totalMemories = memories.value.length
        } else {
            memories.value = []
        }
    } catch (error) {
        message.error('获取记忆失败: ' + (error.response?.data?.message || error.message))
        memories.value = []
    } finally {
        loading.value = false
    }
}

async function addMemory() {
    if (!newMemory.value.content.trim()) {
        message.warning('请输入记忆内容')
        return
    }

    try {
        let metadata = {}
        try {
            metadata = JSON.parse(newMemory.value.metadata)
        } catch (e) {
            // ignore
        }

        const res = await axios.post('/api/memory', {
            userId: userId.value,
            content: newMemory.value.content,
            metadata
        })
        
        if (res.data.code === 0) {
            message.success('添加成功')
            showAddModal.value = false
            newMemory.value = { content: '', metadata: '{}' }
            fetchMemories()
        } else {
            message.error('添加失败: ' + res.data.message)
        }
    } catch (error) {
        message.error('添加失败: ' + (error.response?.data?.message || error.message))
    }
}

async function deleteMemory(id) {
    try {
        const res = await axios.delete(`/api/memory/${userId.value}/${id}`)
        if (res.data.code === 0) {
            message.success('删除成功')
            fetchMemories()
        } else {
            message.error('删除失败: ' + res.data.message)
        }
    } catch (error) {
        message.error('删除失败: ' + (error.response?.data?.message || error.message))
    }
}

async function clearAllMemories() {
    if (!userId.value) return
    
    try {
        const res = await axios.delete(`/api/memory/${userId.value}`)
        if (res.data.code === 0) {
            message.success('清空成功')
            memories.value = []
        } else {
            message.error('清空失败: ' + res.data.message)
        }
    } catch (error) {
        message.error('清空失败: ' + (error.response?.data?.message || error.message))
    }
}

// 一键清空所有用户记忆
async function clearAllUsersMemories() {
    loading.value = true
    try {
        const res = await axios.delete('/api/memory/clear-all')
        if (res.data.code === 0) {
            const count = res.data.data?.deletedCount ?? res.data.deletedCount ?? 0
            message.success(`清空成功，共清空 ${count} 个用户的记忆`)
            memories.value = []
            await fetchUserList()
        } else {
            message.error('清空失败: ' + res.data.message)
        }
    } catch (error) {
        message.error('清空失败: ' + (error.response?.data?.message || error.message))
    } finally {
        loading.value = false
    }
}

onMounted(() => {
    fetchUserList()
})
</script>

<template>
    <n-space vertical size="large">
        <!-- 统计卡片 -->
        <n-grid :cols="3" :x-gap="16">
            <n-grid-item>
                <n-card size="small">
                    <n-statistic label="用户数" :value="stats.totalUsers" />
                </n-card>
            </n-grid-item>
            <n-grid-item>
                <n-card size="small">
                    <n-statistic label="当前用户记忆数" :value="memories.length" />
                </n-card>
            </n-grid-item>
            <n-grid-item>
                <n-card size="small">
                    <n-statistic label="已选用户" :value="userId || '-'" />
                </n-card>
            </n-grid-item>
        </n-grid>

        <n-card title="记忆管理">
            <template #header-extra>
                <n-space>
                    <n-button size="small" @click="fetchUserList">
                        <template #icon><n-icon><RefreshOutlined /></n-icon></template>
                        刷新用户
                    </n-button>
                    <n-popconfirm @positive-click="clearAllUsersMemories">
                        <template #trigger>
                            <n-button size="small" type="error">
                                <template #icon><n-icon><DeleteOutlined /></n-icon></template>
                                清空所有记忆
                            </n-button>
                        </template>
                        确定清空所有用户的记忆？此操作不可恢复！
                    </n-popconfirm>
                </n-space>
            </template>

            <n-space vertical size="large">
                <!-- 搜索栏 -->
                <n-space>
                    <n-select
                        v-model:value="userId"
                        :options="userList.map(u => ({ label: u, value: u }))"
                        placeholder="选择用户"
                        filterable
                        tag
                        clearable
                        style="width: 250px"
                    />
                    <n-button type="primary" @click="fetchMemories" :loading="loading">
                        <template #icon><n-icon><SearchOutlined /></n-icon></template>
                        查询记忆
                    </n-button>
                    <n-button @click="showAddModal = true" :disabled="!userId">
                        <template #icon><n-icon><AddOutlined /></n-icon></template>
                        添加记忆
                    </n-button>
                    <n-popconfirm @positive-click="clearAllMemories" v-if="memories.length > 0">
                        <template #trigger>
                            <n-button type="error">
                                <template #icon><n-icon><DeleteOutlined /></n-icon></template>
                                清空记忆
                            </n-button>
                        </template>
                        确定清空该用户的所有记忆？
                    </n-popconfirm>
                </n-space>

                <!-- 记忆列表 -->
                <n-empty v-if="!userId" description="请选择或输入用户ID查询记忆" />
                <n-data-table 
                    v-else
                    :columns="columns" 
                    :data="memories" 
                    :loading="loading"
                    :pagination="{ pageSize: 20 }"
                    :bordered="false"
                    striped
                />
            </n-space>
        </n-card>

        <!-- 添加记忆弹窗 -->
        <n-modal v-model:show="showAddModal" preset="card" title="添加记忆" style="width: 500px">
            <n-form label-placement="top">
                <n-form-item label="记忆内容">
                    <n-input 
                        v-model:value="newMemory.content" 
                        type="textarea" 
                        :autosize="{ minRows: 3, maxRows: 8 }"
                        placeholder="输入要记住的内容..."
                    />
                </n-form-item>
                <n-form-item label="元数据 (可选, JSON格式)">
                    <n-input 
                        v-model:value="newMemory.metadata" 
                        type="textarea" 
                        :autosize="{ minRows: 2, maxRows: 4 }"
                        placeholder='{"type": "fact", "importance": "high"}'
                    />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="showAddModal = false">取消</n-button>
                    <n-button type="primary" @click="addMemory">添加</n-button>
                </n-space>
            </template>
        </n-modal>
    </n-space>
</template>
