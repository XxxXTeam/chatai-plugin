<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NForm, NFormItem, NSwitch, NInput, NSelect, NButton, NSpace, NDivider, NAlert, NDynamicTags, NTag, NSlider, NGrid, NGridItem, useMessage } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

// 触发配置（新结构）
const triggerConfig = ref({
    private: { enabled: true, mode: 'always' },
    group: { enabled: true, at: true, prefix: true, keyword: false, random: false, randomRate: 0.05 },
    prefixes: ['#chat'],
    keywords: [],
    collectGroupMsg: true,
    blacklistUsers: [],
    whitelistUsers: [],
    blacklistGroups: [],
    whitelistGroups: []
})

// 私聊模式选项
const privateModeOptions = [
    { label: '总是响应', value: 'always' },
    { label: '需要前缀', value: 'prefix' },
    { label: '关闭', value: 'off' }
]

// API 请求头
const getHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
})

// 前缀文本处理
const prefixesText = computed({
    get: () => (triggerConfig.value.prefixes || []).join(', '),
    set: (val) => {
        triggerConfig.value.prefixes = val.split(/[,，]\s*/).filter(Boolean)
    }
})

// 关键词文本处理
const keywordsText = computed({
    get: () => (triggerConfig.value.keywords || []).join(', '),
    set: (val) => {
        triggerConfig.value.keywords = val.split(/[,，]\s*/).filter(Boolean)
    }
})

// 加载配置
async function loadConfig() {
    loading.value = true
    try {
        const res = await axios.get('/api/trigger/config', { headers: getHeaders() })
        if (res.data?.data) {
            const data = res.data.data
            triggerConfig.value = { 
                ...triggerConfig.value, 
                ...data,
                private: data.private || { enabled: true, mode: 'always' },
                group: data.group || { enabled: true, at: true, prefix: true, keyword: false, random: false, randomRate: 0.05 },
                prefixes: data.prefixes || ['#chat'],
                keywords: data.keywords || [],
                collectGroupMsg: data.collectGroupMsg ?? true,
                whitelistGroups: data.whitelistGroups || [],
                blacklistGroups: data.blacklistGroups || [],
                whitelistUsers: data.whitelistUsers || [],
                blacklistUsers: data.blacklistUsers || []
            }
        }
    } catch (err) {
        message.error('加载配置失败: ' + err.message)
    } finally {
        loading.value = false
    }
}

// 保存配置
async function saveConfig() {
    saving.value = true
    try {
        await axios.put('/api/trigger/config', triggerConfig.value, { headers: getHeaders() })
        message.success('配置已保存')
    } catch (err) {
        message.error('保存失败: ' + err.message)
    } finally {
        saving.value = false
    }
}

onMounted(() => {
    loadConfig()
})
</script>

<template>
    <div>
        <n-space vertical size="large">
            <n-card title="AI触发配置">
                <n-alert type="info" style="margin-bottom: 16px;">
                    配置机器人何时响应消息。私聊和群聊可独立配置触发方式。
                </n-alert>
                
                <n-form label-placement="left" label-width="150px">
                    <!-- 私聊配置 -->
                    <n-divider title-placement="left">私聊触发</n-divider>
                    
                    <n-form-item label="响应私聊">
                        <n-switch v-model:value="triggerConfig.private.enabled" />
                    </n-form-item>
                    <n-form-item label="私聊模式" v-if="triggerConfig.private.enabled">
                        <n-select 
                            v-model:value="triggerConfig.private.mode" 
                            :options="privateModeOptions"
                            style="width: 180px;"
                        />
                    </n-form-item>
                    
                    <!-- 群聊配置 -->
                    <n-divider title-placement="left">群聊触发</n-divider>
                    
                    <n-form-item label="响应群聊">
                        <n-switch v-model:value="triggerConfig.group.enabled" />
                    </n-form-item>
                    
                    <template v-if="triggerConfig.group.enabled">
                        <n-form-item label="@机器人触发">
                            <n-switch v-model:value="triggerConfig.group.at" />
                        </n-form-item>
                        <n-form-item label="前缀触发">
                            <n-switch v-model:value="triggerConfig.group.prefix" />
                        </n-form-item>
                        <n-form-item label="关键词触发">
                            <n-switch v-model:value="triggerConfig.group.keyword" />
                        </n-form-item>
                        <n-form-item label="随机触发">
                            <n-space align="center">
                                <n-switch v-model:value="triggerConfig.group.random" />
                                <template v-if="triggerConfig.group.random">
                                    <n-slider v-model:value="triggerConfig.group.randomRate" :min="0" :max="0.5" :step="0.01" style="width: 120px;" />
                                    <span>{{ (triggerConfig.group.randomRate * 100).toFixed(0) }}%</span>
                                </template>
                            </n-space>
                        </n-form-item>
                    </template>
                    
                    <!-- 触发词配置 -->
                    <n-divider title-placement="left">触发词</n-divider>
                    
                    <n-form-item label="触发前缀">
                        <n-input v-model:value="prefixesText" placeholder="多个用逗号分隔，如: #chat, 小助手" style="width: 300px;" />
                    </n-form-item>
                    <n-form-item label="触发关键词" v-if="triggerConfig.group.keyword">
                        <n-input v-model:value="keywordsText" placeholder="消息包含这些词时触发" style="width: 300px;" />
                    </n-form-item>
                    
                    <!-- 其他 -->
                    <n-divider title-placement="left">其他</n-divider>
                    
                    <n-form-item label="采集群消息">
                        <n-switch v-model:value="triggerConfig.collectGroupMsg" />
                    </n-form-item>
                </n-form>
            </n-card>
            
            <!-- 访问控制 -->
            <n-card title="访问控制">
                <n-alert type="warning" style="margin-bottom: 16px;">
                    白名单优先于黑名单。设置白名单后，只有名单内的才会触发。
                </n-alert>
                
                <n-grid :cols="2" :x-gap="24" responsive="screen">
                    <n-grid-item>
                        <n-form-item label="群白名单">
                            <n-dynamic-tags v-model:value="triggerConfig.whitelistGroups" />
                        </n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item label="群黑名单">
                            <n-dynamic-tags v-model:value="triggerConfig.blacklistGroups" />
                        </n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item label="用户白名单">
                            <n-dynamic-tags v-model:value="triggerConfig.whitelistUsers" />
                        </n-form-item>
                    </n-grid-item>
                    <n-grid-item>
                        <n-form-item label="用户黑名单">
                            <n-dynamic-tags v-model:value="triggerConfig.blacklistUsers" />
                        </n-form-item>
                    </n-grid-item>
                </n-grid>
            </n-card>
            
            <!-- 配置预览 -->
            <n-card title="当前状态">
                <n-space>
                    <n-tag :type="triggerConfig.private.enabled ? 'success' : 'default'">
                        私聊: {{ triggerConfig.private.enabled ? triggerConfig.private.mode : '关闭' }}
                    </n-tag>
                    <n-tag :type="triggerConfig.group.enabled ? 'success' : 'default'">
                        群聊: {{ triggerConfig.group.enabled ? '开启' : '关闭' }}
                    </n-tag>
                    <n-tag v-if="triggerConfig.group.at" type="info">@触发</n-tag>
                    <n-tag v-if="triggerConfig.group.prefix" type="info">前缀触发</n-tag>
                    <n-tag v-if="triggerConfig.group.keyword" type="info">关键词触发</n-tag>
                    <n-tag v-if="triggerConfig.group.random" type="warning">随机{{ (triggerConfig.group.randomRate * 100).toFixed(0) }}%</n-tag>
                </n-space>
            </n-card>
            
            <!-- 保存按钮 -->
            <n-space justify="center">
                <n-button type="primary" size="large" @click="saveConfig" :loading="saving">
                    保存配置
                </n-button>
                <n-button size="large" @click="loadConfig" :loading="loading">
                    重新加载
                </n-button>
            </n-space>
        </n-space>
    </div>
</template>
