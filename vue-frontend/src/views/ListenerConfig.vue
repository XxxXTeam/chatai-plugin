<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NForm, NFormItem, NSwitch, NInput, NSelect, NButton, NSpace, NDivider, NAlert, NDynamicTags, NTag, useMessage } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

// 监听配置
const listenerConfig = ref({
    enabled: true,
    priority: -Infinity,
    triggerMode: 'at',
    triggerPrefix: '',
    whitelistGroups: [],
    blacklistGroups: [],
    whitelistUsers: [],
    blacklistUsers: []
})

// 触发模式选项
const triggerModeOptions = [
    { label: '仅@机器人触发', value: 'at' },
    { label: '仅前缀触发', value: 'prefix' },
    { label: '@或前缀触发', value: 'at_or_prefix' },
    { label: '始终触发（所有消息）', value: 'always' }
]

// API 请求头
const getHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
})

// 加载配置
async function loadConfig() {
    loading.value = true
    try {
        const res = await axios.get('/api/listener/config', { headers: getHeaders() })
        if (res.data?.data) {
            listenerConfig.value = { 
                ...listenerConfig.value, 
                ...res.data.data,
                // 确保数组字段存在
                whitelistGroups: res.data.data.whitelistGroups || [],
                blacklistGroups: res.data.data.blacklistGroups || [],
                whitelistUsers: res.data.data.whitelistUsers || [],
                blacklistUsers: res.data.data.blacklistUsers || []
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
        await axios.put('/api/listener/config', listenerConfig.value, { headers: getHeaders() })
        message.success('配置已保存')
    } catch (err) {
        message.error('保存失败: ' + err.message)
    } finally {
        saving.value = false
    }
}

// 是否显示前缀输入
const showPrefixInput = computed(() => {
    return ['prefix', 'at_or_prefix'].includes(listenerConfig.value.triggerMode)
})

onMounted(() => {
    loadConfig()
})
</script>

<template>
    <div>
        <n-space vertical size="large">
            <!-- 基础配置 -->
            <n-card title="监听器基础配置">
                <n-alert type="info" style="margin-bottom: 16px;">
                    监听器用于接收群聊/私聊消息并触发AI回复。优先级设置为最低（-Infinity）可确保在其他插件之后处理。
                </n-alert>
                
                <n-form label-placement="left" label-width="150px">
                    <n-form-item label="启用监听">
                        <n-switch v-model:value="listenerConfig.enabled" />
                    </n-form-item>
                    
                    <n-form-item label="触发模式">
                        <n-select 
                            v-model:value="listenerConfig.triggerMode" 
                            :options="triggerModeOptions"
                            style="width: 250px;"
                        />
                    </n-form-item>
                    
                    <n-form-item label="触发前缀" v-if="showPrefixInput">
                        <n-input 
                            v-model:value="listenerConfig.triggerPrefix" 
                            placeholder="如: #ai 或 /chat"
                            style="width: 200px;"
                        />
                    </n-form-item>
                </n-form>
            </n-card>
            
            <!-- 群组黑白名单 -->
            <n-card title="群组过滤">
                <n-alert type="warning" style="margin-bottom: 16px;">
                    如果设置了白名单，则只有白名单内的群组才会触发AI；如果只设置黑名单，则黑名单内的群组不会触发AI。
                </n-alert>
                
                <n-form label-placement="top">
                    <n-form-item label="群组白名单（留空表示不限制）">
                        <n-dynamic-tags v-model:value="listenerConfig.whitelistGroups" />
                        <template #feedback>
                            输入群号后按回车添加
                        </template>
                    </n-form-item>
                    
                    <n-form-item label="群组黑名单">
                        <n-dynamic-tags v-model:value="listenerConfig.blacklistGroups" />
                        <template #feedback>
                            输入群号后按回车添加
                        </template>
                    </n-form-item>
                </n-form>
            </n-card>
            
            <!-- 用户黑白名单 -->
            <n-card title="用户过滤">
                <n-alert type="warning" style="margin-bottom: 16px;">
                    如果设置了白名单，则只有白名单内的用户才会触发AI；如果只设置黑名单，则黑名单内的用户不会触发AI。
                </n-alert>
                
                <n-form label-placement="top">
                    <n-form-item label="用户白名单（留空表示不限制）">
                        <n-dynamic-tags v-model:value="listenerConfig.whitelistUsers" />
                        <template #feedback>
                            输入QQ号后按回车添加
                        </template>
                    </n-form-item>
                    
                    <n-form-item label="用户黑名单">
                        <n-dynamic-tags v-model:value="listenerConfig.blacklistUsers" />
                        <template #feedback>
                            输入QQ号后按回车添加
                        </template>
                    </n-form-item>
                </n-form>
            </n-card>
            
            <!-- 当前配置预览 -->
            <n-card title="配置预览">
                <n-space vertical>
                    <div>
                        <n-tag :type="listenerConfig.enabled ? 'success' : 'error'">
                            {{ listenerConfig.enabled ? '监听已启用' : '监听已禁用' }}
                        </n-tag>
                    </div>
                    <div>
                        <strong>触发模式：</strong>
                        {{ triggerModeOptions.find(o => o.value === listenerConfig.triggerMode)?.label || '未知' }}
                        <span v-if="showPrefixInput && listenerConfig.triggerPrefix">
                            （前缀：{{ listenerConfig.triggerPrefix }}）
                        </span>
                    </div>
                    <div v-if="listenerConfig.whitelistGroups.length">
                        <strong>群组白名单：</strong>
                        <n-tag v-for="g in listenerConfig.whitelistGroups" :key="g" size="small" style="margin-right: 4px;">
                            {{ g }}
                        </n-tag>
                    </div>
                    <div v-if="listenerConfig.blacklistGroups.length">
                        <strong>群组黑名单：</strong>
                        <n-tag v-for="g in listenerConfig.blacklistGroups" :key="g" size="small" type="error" style="margin-right: 4px;">
                            {{ g }}
                        </n-tag>
                    </div>
                    <div v-if="listenerConfig.whitelistUsers.length">
                        <strong>用户白名单：</strong>
                        <n-tag v-for="u in listenerConfig.whitelistUsers" :key="u" size="small" style="margin-right: 4px;">
                            {{ u }}
                        </n-tag>
                    </div>
                    <div v-if="listenerConfig.blacklistUsers.length">
                        <strong>用户黑名单：</strong>
                        <n-tag v-for="u in listenerConfig.blacklistUsers" :key="u" size="small" type="error" style="margin-right: 4px;">
                            {{ u }}
                        </n-tag>
                    </div>
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
