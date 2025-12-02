<script setup>
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import axios from 'axios'
import CodeBlock from '../components/CodeBlock.vue'
import {
    SearchOutlined,
    RefreshOutlined,
    ContentCopyOutlined,
    InfoOutlined
} from '@vicons/material'

const message = useMessage()
const loading = ref(false)

// 查询参数
const queryParams = ref({
    type: 'seq',
    value: '',
    groupId: '',
    userId: ''
})

// 查询结果
const result = ref(null)
const error = ref('')

// 平台信息
const platformInfo = ref({
    platform: 'unknown',
    version: '',
    features: []
})

// 获取平台信息
async function fetchPlatformInfo() {
    try {
        const res = await axios.get('/api/platform/info')
        if (res.data.code === 0) {
            platformInfo.value = res.data.data
        }
    } catch (err) {
        console.error('获取平台信息失败:', err)
    }
}

// 查询消息
async function queryMessage() {
    if (!queryParams.value.value) {
        message.warning('请输入消息ID或Seq')
        return
    }
    
    loading.value = true
    error.value = ''
    result.value = null
    
    try {
        const res = await axios.post('/api/message/query', {
            type: queryParams.value.type,
            value: queryParams.value.value,
            group_id: queryParams.value.groupId || undefined,
            user_id: queryParams.value.userId || undefined
        })
        
        if (res.data.code === 0) {
            result.value = res.data.data
            message.success('查询成功')
        } else {
            error.value = res.data.message || '查询失败'
            message.error(error.value)
        }
    } catch (err) {
        error.value = err.response?.data?.message || err.message
        message.error('查询失败: ' + error.value)
    } finally {
        loading.value = false
    }
}

// 复制到剪贴板
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(typeof text === 'string' ? text : JSON.stringify(text, null, 2))
        message.success('已复制到剪贴板')
    } catch (err) {
        message.error('复制失败')
    }
}

// 格式化时间
function formatTime(timestamp) {
    if (!timestamp) return 'N/A'
    const date = new Date(timestamp * 1000)
    return date.toLocaleString('zh-CN')
}

// 结果JSON
const resultJson = computed(() => {
    if (!result.value) return ''
    return JSON.stringify(result.value, null, 2)
})

fetchPlatformInfo()
</script>

<template>
    <n-space vertical size="large">
        <!-- 平台信息卡片 -->
        <n-card size="small">
            <template #header>
                <n-space align="center">
                    <n-icon><InfoOutlined /></n-icon>
                    <span>平台信息</span>
                </n-space>
            </template>
            <n-descriptions :column="4" label-placement="left">
                <n-descriptions-item label="平台">
                    <n-tag :type="platformInfo.platform === 'icqq' ? 'success' : 'info'">
                        {{ platformInfo.platform }}
                    </n-tag>
                </n-descriptions-item>
                <n-descriptions-item label="版本">
                    {{ platformInfo.version || 'N/A' }}
                </n-descriptions-item>
                <n-descriptions-item label="特性">
                    <n-space size="small">
                        <n-tag v-for="feat in platformInfo.features" :key="feat" size="small">
                            {{ feat }}
                        </n-tag>
                        <span v-if="!platformInfo.features?.length">-</span>
                    </n-space>
                </n-descriptions-item>
            </n-descriptions>
        </n-card>
        
        <!-- 查询表单 -->
        <n-card title="消息查询">
            <template #header-extra>
                <n-tag type="warning">仅主人可用</n-tag>
            </template>
            
            <n-form inline label-placement="left">
                <n-form-item label="查询类型">
                    <n-radio-group v-model:value="queryParams.type">
                        <n-radio-button value="seq">Seq</n-radio-button>
                        <n-radio-button value="message_id">消息ID</n-radio-button>
                    </n-radio-group>
                </n-form-item>
                
                <n-form-item label="消息标识">
                    <n-input
                        v-model:value="queryParams.value"
                        placeholder="输入消息Seq或ID"
                        style="width: 200px"
                        @keyup.enter="queryMessage"
                    />
                </n-form-item>
                
                <n-form-item label="群号">
                    <n-input
                        v-model:value="queryParams.groupId"
                        placeholder="可选"
                        style="width: 150px"
                    />
                </n-form-item>
                
                <n-form-item label="用户ID">
                    <n-input
                        v-model:value="queryParams.userId"
                        placeholder="可选（私聊）"
                        style="width: 150px"
                    />
                </n-form-item>
                
                <n-form-item>
                    <n-button type="primary" @click="queryMessage" :loading="loading">
                        <template #icon><n-icon><SearchOutlined /></n-icon></template>
                        查询
                    </n-button>
                </n-form-item>
            </n-form>
            
            <n-alert v-if="error" type="error" style="margin-top: 16px">
                {{ error }}
            </n-alert>
        </n-card>
        
        <!-- 查询结果 -->
        <n-card v-if="result" title="查询结果">
            <template #header-extra>
                <n-button size="small" @click="copyToClipboard(result)">
                    <template #icon><n-icon><ContentCopyOutlined /></n-icon></template>
                    复制JSON
                </n-button>
            </template>
            
            <!-- 基本信息 -->
            <n-descriptions :column="3" label-placement="left" bordered>
                <n-descriptions-item label="平台">
                    <n-tag>{{ result.platform }}</n-tag>
                </n-descriptions-item>
                <n-descriptions-item label="Seq">
                    {{ result.parsed?.seq || 'N/A' }}
                </n-descriptions-item>
                <n-descriptions-item label="消息ID">
                    {{ result.parsed?.message_id || 'N/A' }}
                </n-descriptions-item>
                <n-descriptions-item label="时间">
                    {{ formatTime(result.parsed?.time) }}
                </n-descriptions-item>
                <n-descriptions-item label="发送者">
                    {{ result.parsed?.sender?.nickname || result.parsed?.sender?.user_id || 'N/A' }}
                </n-descriptions-item>
                <n-descriptions-item label="查询方法">
                    <n-tag v-for="m in result.methods_tried?.filter(x => !x.includes('failed'))" :key="m" size="small">
                        {{ m }}
                    </n-tag>
                </n-descriptions-item>
            </n-descriptions>
            
            <!-- PB数据 (仅icqq) -->
            <n-card v-if="result.pb?.has_raw" size="small" title="PB数据" style="margin-top: 16px">
                <n-descriptions :column="2" label-placement="left">
                    <n-descriptions-item label="数据类型">
                        {{ result.pb.raw_type }}
                    </n-descriptions-item>
                    <n-descriptions-item label="数据大小">
                        {{ result.pb.raw_length }} bytes
                    </n-descriptions-item>
                </n-descriptions>
                <div v-if="result.pb.hex_preview" style="margin-top: 12px">
                    <n-text depth="3">HEX预览:</n-text>
                    <n-code style="word-break: break-all; margin-top: 8px">
                        {{ result.pb.hex_preview }}
                    </n-code>
                </div>
            </n-card>
            
            <!-- 消息内容 -->
            <n-card size="small" title="消息内容" style="margin-top: 16px">
                <template v-if="result.parsed?.raw_message">
                    <n-text>{{ result.parsed.raw_message }}</n-text>
                </template>
                <CodeBlock
                    v-else
                    :code="JSON.stringify(result.parsed?.message || [], null, 2)"
                    language="json"
                    max-height="300px"
                />
            </n-card>
            
            <!-- 完整JSON -->
            <n-collapse style="margin-top: 16px">
                <n-collapse-item title="完整JSON数据" name="json">
                    <CodeBlock :code="resultJson" language="json" max-height="400px" />
                </n-collapse-item>
            </n-collapse>
        </n-card>
        
        <!-- 使用说明 -->
        <n-card title="使用说明" size="small">
            <n-ul>
                <n-li>
                    <strong>Seq查询</strong>: 使用消息序列号查询，通常为数字
                </n-li>
                <n-li>
                    <strong>消息ID查询</strong>: 使用消息唯一标识符查询
                </n-li>
                <n-li>
                    <strong>群号</strong>: 群聊消息需要提供群号
                </n-li>
                <n-li>
                    <strong>用户ID</strong>: 私聊消息需要提供用户ID
                </n-li>
                <n-li>
                    <strong>PB数据</strong>: 仅 icqq 平台支持获取原始 Protobuf 数据
                </n-li>
            </n-ul>
            
            <n-divider />
            
            <n-text depth="3">
                也可以在聊天中使用 <n-code>#取 [seq]</n-code> 或引用消息后发送 <n-code>#取</n-code> 来查询
            </n-text>
        </n-card>
    </n-space>
</template>

<style scoped>
.n-card {
    margin-bottom: 16px;
}
</style>
