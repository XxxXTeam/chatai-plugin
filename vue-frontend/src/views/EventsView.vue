<script setup>
import { ref, onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import axios from 'axios'
import { 
    RefreshOutlined,
    PlayArrowOutlined
} from '@vicons/material'

const message = useMessage()
const loading = ref(false)
const config = ref({
    poke: {
        enabled: false,      // 默认关闭
        pokeBack: false,
        message: '别戳了~'
    },
    reaction: {
        enabled: false       // 默认关闭
    },
    voiceReply: {
        enabled: false,
        ttsProvider: 'system',
        triggerOnTool: false,
        triggerAlways: false,
        maxTextLength: 500
    }
})

// 事件日志
const eventLogs = ref([])
const maxLogs = 50

// 获取配置
async function fetchConfig() {
    loading.value = true
    try {
        const res = await axios.get('/api/config')
        if (res.data.code === 0 && res.data.data?.features) {
            const features = res.data.data.features
            if (features.poke) config.value.poke = { ...config.value.poke, ...features.poke }
            if (features.reaction) config.value.reaction = { ...config.value.reaction, ...features.reaction }
            if (features.voiceReply) config.value.voiceReply = { ...config.value.voiceReply, ...features.voiceReply }
        }
    } catch (err) {
        message.error('获取配置失败: ' + err.message)
    } finally {
        loading.value = false
    }
}

// 保存配置
async function saveConfig() {
    loading.value = true
    try {
        const res = await axios.post('/api/config', {
            features: {
                poke: config.value.poke,
                reaction: config.value.reaction,
                voiceReply: config.value.voiceReply
            }
        })
        if (res.data.code === 0) {
            message.success('保存成功')
        } else {
            message.error('保存失败: ' + res.data.message)
        }
    } catch (err) {
        message.error('保存失败: ' + err.message)
    } finally {
        loading.value = false
    }
}

// 添加日志
function addLog(type, content) {
    const now = new Date()
    eventLogs.value.unshift({
        id: Date.now(),
        time: now.toLocaleTimeString(),
        type,
        content
    })
    // 限制日志数量
    if (eventLogs.value.length > maxLogs) {
        eventLogs.value.pop()
    }
}

// 清空日志
function clearLogs() {
    eventLogs.value = []
    message.success('日志已清空')
}

// 测试戳一戳
async function testPoke() {
    try {
        const res = await axios.post('/api/test/poke')
        if (res.data.code === 0) {
            addLog('poke', '测试戳一戳成功')
            message.success('测试成功')
        } else {
            message.error('测试失败: ' + res.data.message)
        }
    } catch (err) {
        message.error('测试失败: ' + err.message)
    }
}

onMounted(() => {
    fetchConfig()
})
</script>

<template>
    <n-space vertical size="large">
        <!-- 页面标题 -->
        <n-card title="事件处理配置">
            <template #header-extra>
                <n-space>
                    <n-button @click="fetchConfig" :loading="loading">
                        <template #icon><n-icon><RefreshOutlined /></n-icon></template>
                        刷新
                    </n-button>
                    <n-button type="primary" @click="saveConfig" :loading="loading">
                        保存配置
                    </n-button>
                </n-space>
            </template>
            
            <n-alert type="info" style="margin-bottom: 16px">
                配置各种事件的响应方式，包括戳一戳、表情回应等。
            </n-alert>
            
            <n-tabs type="line">
                <!-- 戳一戳配置 -->
                <n-tab-pane name="poke" tab="戳一戳">
                    <n-space vertical size="large">
                        <n-alert type="info" style="margin-bottom: 8px">
                            开启后，当有人戳机器人时，会根据当前人设生成回复。
                        </n-alert>
                        
                        <n-card size="small">
                            <n-form label-placement="left" label-width="120">
                                <n-form-item label="启用响应">
                                    <n-switch v-model:value="config.poke.enabled" />
                                    <span style="margin-left: 12px; color: #999">
                                        收到戳一戳时使用AI人设回复
                                    </span>
                                </n-form-item>
                                
                                <n-form-item label="自动回戳">
                                    <n-switch v-model:value="config.poke.pokeBack" :disabled="!config.poke.enabled" />
                                    <span style="margin-left: 12px; color: #999">
                                        回复后自动戳回去
                                    </span>
                                </n-form-item>
                                
                                <n-form-item label="备用回复">
                                    <n-input
                                        v-model:value="config.poke.message"
                                        type="textarea"
                                        :rows="2"
                                        placeholder="AI回复失败时的备用回复"
                                        :disabled="!config.poke.enabled"
                                    />
                                </n-form-item>
                            </n-form>
                        </n-card>
                    </n-space>
                </n-tab-pane>
                
                <!-- 表情回应配置 -->
                <n-tab-pane name="reaction" tab="表情回应">
                    <n-space vertical>
                        <n-alert type="info" style="margin-bottom: 8px">
                            开启后，当有人对机器人的消息做出表情回应时，会根据人设决定是否回复。
                        </n-alert>
                        
                        <n-card size="small">
                            <n-form label-placement="left" label-width="120">
                                <n-form-item label="启用处理">
                                    <n-switch v-model:value="config.reaction.enabled" />
                                    <span style="margin-left: 12px; color: #999">
                                        处理消息的表情回应（使用AI人设）
                                    </span>
                                </n-form-item>
                            </n-form>
                        </n-card>
                        
                        <n-alert type="warning">
                            表情回应功能需要适配器支持（NapCat 等），icqq 适配器可能无法收到此事件。
                        </n-alert>
                    </n-space>
                </n-tab-pane>
                
                <!-- 语音回复配置 -->
                <n-tab-pane name="voice" tab="语音回复">
                    <n-space vertical>
                        <n-card size="small">
                            <n-form label-placement="left" label-width="120">
                                <n-form-item label="启用语音">
                                    <n-switch v-model:value="config.voiceReply.enabled" />
                                    <span style="margin-left: 12px; color: #999">
                                        启用语音回复功能
                                    </span>
                                </n-form-item>
                                
                                <n-form-item label="TTS提供者">
                                    <n-select
                                        v-model:value="config.voiceReply.ttsProvider"
                                        :options="[
                                            { label: '系统TTS', value: 'system' },
                                            { label: 'Edge TTS', value: 'edge' },
                                            { label: 'OpenAI TTS', value: 'openai' }
                                        ]"
                                        :disabled="!config.voiceReply.enabled"
                                        style="width: 200px"
                                    />
                                </n-form-item>
                                
                                <n-form-item label="最大文本长度">
                                    <n-input-number
                                        v-model:value="config.voiceReply.maxTextLength"
                                        :min="100"
                                        :max="2000"
                                        :disabled="!config.voiceReply.enabled"
                                    />
                                    <span style="margin-left: 12px; color: #999">
                                        超过此长度不转语音
                                    </span>
                                </n-form-item>
                            </n-form>
                        </n-card>
                        
                        <n-alert type="info">
                            语音回复功能需要配置TTS服务。
                        </n-alert>
                    </n-space>
                </n-tab-pane>
            </n-tabs>
        </n-card>
        
        <!-- 事件日志 -->
        <n-card title="事件日志">
            <template #header-extra>
                <n-button size="small" @click="clearLogs">清空日志</n-button>
            </template>
            
            <n-empty v-if="eventLogs.length === 0" description="暂无事件日志" />
            
            <n-list v-else bordered>
                <n-list-item v-for="log in eventLogs" :key="log.id">
                    <template #prefix>
                        <n-tag :type="log.type === 'poke' ? 'info' : 'warning'" size="small">
                            {{ log.type }}
                        </n-tag>
                    </template>
                    <n-thing :title="log.content" :description="log.time" />
                </n-list-item>
            </n-list>
        </n-card>
    </n-space>
</template>

<style scoped>
.n-card {
    margin-bottom: 16px;
}
</style>
