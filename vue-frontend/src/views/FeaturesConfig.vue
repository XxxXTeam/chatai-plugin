<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NForm, NFormItem, NSwitch, NInput, NInputNumber, NSelect, NButton, NSpace, NDivider, NAlert, NGrid, NGi, useMessage } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

// 功能配置
const features = ref({
    voiceReply: {
        enabled: false,
        triggerOnTool: true,
        triggerAlways: false,
        ttsProvider: 'miao',
        maxTextLength: 500
    },
    groupContext: {
        enabled: true,
        maxMessages: 20
    },
    autoMemory: {
        enabled: true,
        extractOnChat: true
    },
    replyQuote: {
        enabled: true,
        handleText: true,
        handleImage: true,
        handleFile: true,
        handleForward: true
    },
    atTrigger: {
        enabled: true,
        requireAt: true,
        prefix: ''
    }
})

// Token 状态
const tokenStatus = ref({
    hasPermanentToken: false,
    tempTokenCount: 0
})

// TTS 提供者选项
const ttsProviderOptions = [
    { label: 'Miao-Yunzai TTS', value: 'miao' },
    { label: 'VITS', value: 'vits' },
    { label: 'Edge TTS', value: 'edge' },
    { label: 'OpenAI TTS', value: 'openai' },
    { label: '系统默认', value: 'system' }
]

// API 请求头
const getHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
})

// 加载配置
async function loadFeatures() {
    loading.value = true
    try {
        const [featuresRes, tokenRes] = await Promise.all([
            axios.get('/api/features', { headers: getHeaders() }),
            axios.get('/api/auth/token/status', { headers: getHeaders() })
        ])
        
        if (featuresRes.data?.data) {
            features.value = { ...features.value, ...featuresRes.data.data }
        }
        
        if (tokenRes.data?.data) {
            tokenStatus.value = tokenRes.data.data
        }
    } catch (err) {
        message.error('加载配置失败: ' + err.message)
    } finally {
        loading.value = false
    }
}

// 保存配置
async function saveFeatures() {
    saving.value = true
    try {
        await axios.put('/api/features', features.value, { headers: getHeaders() })
        message.success('配置已保存')
    } catch (err) {
        message.error('保存失败: ' + err.message)
    } finally {
        saving.value = false
    }
}

// 生成永久Token
async function generatePermanentToken() {
    try {
        const res = await axios.post('/api/auth/token/permanent', {}, { headers: getHeaders() })
        if (res.data?.data?.token) {
            message.success('永久Token已生成')
            tokenStatus.value.hasPermanentToken = true
            
            // 复制到剪贴板
            await navigator.clipboard.writeText(res.data.data.token)
            message.info('Token已复制到剪贴板')
        }
    } catch (err) {
        message.error('生成失败: ' + err.message)
    }
}

// 撤销永久Token
async function revokePermanentToken() {
    try {
        await axios.delete('/api/auth/token/permanent', { headers: getHeaders() })
        message.success('永久Token已撤销')
        tokenStatus.value.hasPermanentToken = false
    } catch (err) {
        message.error('撤销失败: ' + err.message)
    }
}

onMounted(() => {
    loadFeatures()
})
</script>

<template>
    <div>
        <n-space vertical size="large">
            <!-- Token 管理 -->
            <n-card title="管理面板认证">
                <n-alert type="info" style="margin-bottom: 16px;">
                    永久Token可以让你无需每次都重新获取临时链接即可访问管理面板。
                </n-alert>
                <n-space>
                    <n-button 
                        type="primary" 
                        @click="generatePermanentToken"
                        :disabled="tokenStatus.hasPermanentToken"
                    >
                        {{ tokenStatus.hasPermanentToken ? '已有永久Token' : '生成永久Token' }}
                    </n-button>
                    <n-button 
                        type="error"
                        @click="revokePermanentToken"
                        :disabled="!tokenStatus.hasPermanentToken"
                    >
                        撤销永久Token
                    </n-button>
                </n-space>
            </n-card>
            
            <!-- 语音回复配置 -->
            <n-card title="语音回复">
                <n-form label-placement="left" label-width="150px">
                    <n-form-item label="启用语音回复">
                        <n-switch v-model:value="features.voiceReply.enabled" />
                    </n-form-item>
                    <template v-if="features.voiceReply.enabled">
                        <n-form-item label="工具调用后触发">
                            <n-switch v-model:value="features.voiceReply.triggerOnTool" />
                        </n-form-item>
                        <n-form-item label="始终语音回复">
                            <n-switch v-model:value="features.voiceReply.triggerAlways" />
                        </n-form-item>
                        <n-form-item label="TTS 提供者">
                            <n-select 
                                v-model:value="features.voiceReply.ttsProvider" 
                                :options="ttsProviderOptions"
                                style="width: 200px;"
                            />
                        </n-form-item>
                        <n-form-item label="最大文本长度">
                            <n-input-number 
                                v-model:value="features.voiceReply.maxTextLength" 
                                :min="100" 
                                :max="2000"
                                style="width: 150px;"
                            />
                        </n-form-item>
                    </template>
                </n-form>
            </n-card>
            
            <!-- 引用消息配置 -->
            <n-card title="引用消息处理">
                <n-form label-placement="left" label-width="150px">
                    <n-form-item label="启用引用处理">
                        <n-switch v-model:value="features.replyQuote.enabled" />
                    </n-form-item>
                    <template v-if="features.replyQuote.enabled">
                        <n-grid :cols="2" :x-gap="24">
                            <n-gi>
                                <n-form-item label="处理引用文本">
                                    <n-switch v-model:value="features.replyQuote.handleText" />
                                </n-form-item>
                            </n-gi>
                            <n-gi>
                                <n-form-item label="处理引用图片">
                                    <n-switch v-model:value="features.replyQuote.handleImage" />
                                </n-form-item>
                            </n-gi>
                            <n-gi>
                                <n-form-item label="处理引用文件">
                                    <n-switch v-model:value="features.replyQuote.handleFile" />
                                </n-form-item>
                            </n-gi>
                            <n-gi>
                                <n-form-item label="处理转发消息">
                                    <n-switch v-model:value="features.replyQuote.handleForward" />
                                </n-form-item>
                            </n-gi>
                        </n-grid>
                    </template>
                </n-form>
            </n-card>
            
            <!-- @触发配置 -->
            <n-card title="@触发配置">
                <n-form label-placement="left" label-width="150px">
                    <n-form-item label="启用@触发">
                        <n-switch v-model:value="features.atTrigger.enabled" />
                    </n-form-item>
                    <template v-if="features.atTrigger.enabled">
                        <n-form-item label="需要@机器人">
                            <n-switch v-model:value="features.atTrigger.requireAt" />
                        </n-form-item>
                        <n-form-item label="触发前缀">
                            <n-input 
                                v-model:value="features.atTrigger.prefix" 
                                placeholder="可选，如 #ai"
                                style="width: 200px;"
                            />
                        </n-form-item>
                    </template>
                </n-form>
            </n-card>
            
            <!-- 群聊上下文配置 -->
            <n-card title="群聊上下文">
                <n-form label-placement="left" label-width="150px">
                    <n-form-item label="启用群聊上下文">
                        <n-switch v-model:value="features.groupContext.enabled" />
                    </n-form-item>
                    <template v-if="features.groupContext.enabled">
                        <n-form-item label="最大消息数">
                            <n-input-number 
                                v-model:value="features.groupContext.maxMessages" 
                                :min="5" 
                                :max="100"
                                style="width: 150px;"
                            />
                        </n-form-item>
                    </template>
                </n-form>
            </n-card>
            
            <!-- 自动记忆配置 -->
            <n-card title="自动记忆">
                <n-form label-placement="left" label-width="150px">
                    <n-form-item label="启用自动记忆">
                        <n-switch v-model:value="features.autoMemory.enabled" />
                    </n-form-item>
                    <template v-if="features.autoMemory.enabled">
                        <n-form-item label="聊天时自动提取">
                            <n-switch v-model:value="features.autoMemory.extractOnChat" />
                        </n-form-item>
                    </template>
                </n-form>
            </n-card>
            
            <!-- 保存按钮 -->
            <n-space justify="center">
                <n-button type="primary" size="large" @click="saveFeatures" :loading="saving">
                    保存所有配置
                </n-button>
                <n-button size="large" @click="loadFeatures" :loading="loading">
                    重新加载
                </n-button>
            </n-space>
        </n-space>
    </div>
</template>
