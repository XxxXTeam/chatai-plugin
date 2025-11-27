<script setup>
import { ref } from 'vue'
import { NCard, NSpace, NInput, NButton, NForm, NFormItem, useMessage } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const userId = ref('')
const loading = ref(false)

async function clearContext() {
    if (!userId.value) {
        message.warning('请输入用户ID')
        return
    }

    loading.value = true
    try {
        const token = localStorage.getItem('token')
        await axios.post('/api/context/clear', { userId: userId.value }, {
            headers: { Authorization: `Bearer ${token}` }
        })
        message.success('上下文已清除')
    } catch (error) {
        message.error('清除失败: ' + (error.response?.data?.message || error.message))
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <n-space vertical>
        <n-card title="上下文管理">
            <n-space vertical>
                <p>在此处清除特定用户的对话上下文。</p>
                <n-form inline>
                    <n-form-item label="用户ID">
                        <n-input v-model:value="userId" placeholder="输入用户ID" />
                    </n-form-item>
                    <n-form-item>
                        <n-button type="warning" @click="clearContext" :loading="loading">
                            清除上下文
                        </n-button>
                    </n-form-item>
                </n-form>
            </n-space>
        </n-card>
    </n-space>
</template>
