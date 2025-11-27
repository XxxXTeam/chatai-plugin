<script setup>
import { ref } from 'vue'
import { NCard, NSpace, NInput, NButton, NDataTable, useMessage, NModal, NForm, NFormItem } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const userId = ref('')
const memories = ref([])
const loading = ref(false)
const showAddModal = ref(false)
const newMemory = ref({ content: '', metadata: '{}' })

const columns = [
    { title: 'ID', key: 'id' },
    { title: '内容', key: 'content' },
    { title: '时间', key: 'timestamp', render: (row) => new Date(row.timestamp).toLocaleString() },
    {
        title: '操作',
        key: 'actions',
        render(row) {
            return h(NButton, {
                size: 'small',
                type: 'error',
                onClick: () => deleteMemory(row.id)
            }, { default: () => '删除' })
        }
    }
]

async function fetchMemories() {
    if (!userId.value) {
        message.warning('请输入用户ID')
        return
    }

    loading.value = true
    try {
        const token = localStorage.getItem('token')
        const res = await axios.get(`/api/memory/${userId.value}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        memories.value = res.data.data
    } catch (error) {
        message.error('获取记忆失败: ' + (error.response?.data?.message || error.message))
    } finally {
        loading.value = false
    }
}

async function addMemory() {
    try {
        const token = localStorage.getItem('token')
        let metadata = {}
        try {
            metadata = JSON.parse(newMemory.value.metadata)
        } catch (e) {
            // ignore
        }

        await axios.post('/api/memory', {
            userId: userId.value,
            content: newMemory.value.content,
            metadata
        }, {
            headers: { Authorization: `Bearer ${token}` }
        })
        message.success('添加成功')
        showAddModal.value = false
        fetchMemories()
    } catch (error) {
        message.error('添加失败: ' + (error.response?.data?.message || error.message))
    }
}

async function deleteMemory(id) {
    try {
        const token = localStorage.getItem('token')
        await axios.delete(`/api/memory/${userId.value}/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
        message.success('删除成功')
        fetchMemories()
    } catch (error) {
        message.error('删除失败: ' + (error.response?.data?.message || error.message))
    }
}
</script>

<template>
    <n-space vertical>
        <n-card title="记忆管理">
            <n-space vertical>
                <n-space>
                    <n-input v-model:value="userId" placeholder="输入用户ID" />
                    <n-button type="primary" @click="fetchMemories" :loading="loading">查询</n-button>
                    <n-button type="success" @click="showAddModal = true" :disabled="!userId">添加记忆</n-button>
                </n-space>
                <n-data-table :columns="columns" :data="memories" :loading="loading" />
            </n-space>
        </n-card>

        <n-modal v-model:show="showAddModal" preset="dialog" title="添加记忆">
            <n-form>
                <n-form-item label="内容">
                    <n-input v-model:value="newMemory.content" type="textarea" />
                </n-form-item>
                <n-form-item label="元数据 (JSON)">
                    <n-input v-model:value="newMemory.metadata" type="textarea" placeholder="{}" />
                </n-form-item>
                <n-button type="primary" block @click="addMemory">提交</n-button>
            </n-form>
        </n-modal>
    </n-space>
</template>
