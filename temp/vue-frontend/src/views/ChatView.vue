<script setup>
import { ref, onMounted, nextTick, watch } from 'vue'
import { useMessage, NCard, NInput, NButton, NAvatar, NSpin, NUpload, NImage, NSelect } from 'naive-ui'
import { SendOutlined, DeleteOutlined, ImageOutlined, SmartToyOutlined, PersonOutlined } from '@vicons/material'
import { marked } from 'marked'
import axios from 'axios'
import DOMPurify from 'dompurify'

const message = useMessage()
const userInput = ref('')
const chatHistory = ref([])
const loading = ref(false)
const chatContainer = ref(null)
const fileList = ref([])
const models = ref([])
const selectedModel = ref(null)
const userId = ref('admin') // Default user for admin panel

// Fetch models on mount
onMounted(async () => {
    try {
        const res = await axios.get('/api/openai/models')
        if (res.data && res.data.data) {
            models.value = res.data.data.map(m => ({ label: m.id, value: m.id }))
            if (models.value.length > 0) {
                selectedModel.value = models.value[0].value
            }
        }
        await loadHistory()
    } catch (error) {
        console.error('Failed to load initial data', error)
    }
})

// Load chat history
async function loadHistory() {
    try {
        const res = await axios.get(`/api/chat/history/${userId.value}?limit=50`)
        if (res.data.code === 0) {
            chatHistory.value = res.data.data.map(msg => {
                // Format content if it's an array (multimodal)
                let content = msg.content
                let images = []
                
                if (Array.isArray(msg.content)) {
                    content = msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                    
                    images = msg.content
                        .filter(c => c.type === 'image_url')
                        .map(c => c.image_url.url)
                }
                
                return {
                    role: msg.role,
                    content: content,
                    images: images
                }
            })
            scrollToBottom()
        }
    } catch (error) {
        message.error('Failed to load history')
    }
}

// Send message
async function handleSend() {
    if ((!userInput.value.trim() && fileList.value.length === 0) || loading.value) return

    const content = userInput.value
    const images = []
    
    // Process uploaded images
    for (const file of fileList.value) {
        if (file.status === 'finished' && file.url) {
             // If it's a URL from our server
             images.push(file.url)
        } else if (file.file) {
            // If it's a raw file, we need to upload it first or convert to base64
            // Ideally we should upload to /api/upload/image first
            try {
                const formData = new FormData()
                formData.append('image', file.file)
                const uploadRes = await axios.post('/api/upload/image', formData)
                if (uploadRes.data.code === 0) {
                    images.push(uploadRes.data.data.id)
                }
            } catch (e) {
                message.error('Image upload failed')
                return
            }
        }
    }

    // Optimistic update
    chatHistory.value.push({
        role: 'user',
        content: content,
        images: fileList.value.map(f => URL.createObjectURL(f.file)) // Preview local files
    })
    
    userInput.value = ''
    fileList.value = []
    loading.value = true
    scrollToBottom()

    try {
        const res = await axios.post('/api/chat/send', {
            userId: userId.value,
            message: content,
            images: images,
            model: selectedModel.value
        })

        if (res.data.code === 0) {
            // Add assistant response
            const responseContent = res.data.data.response
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('')
                
            chatHistory.value.push({
                role: 'assistant',
                content: responseContent
            })
        } else {
            message.error(res.data.message || 'Send failed')
            // Remove optimistic message or show error
        }
    } catch (error) {
        message.error('Network error')
    } finally {
        loading.value = false
        scrollToBottom()
    }
}

// Clear history
async function handleClear() {
    try {
        await axios.delete(`/api/chat/history/${userId.value}`)
        chatHistory.value = []
        message.success('History cleared')
    } catch (error) {
        message.error('Failed to clear history')
    }
}

function scrollToBottom() {
    nextTick(() => {
        if (chatContainer.value) {
            chatContainer.value.scrollTop = chatContainer.value.scrollHeight
        }
    })
}

function renderMarkdown(text) {
    if (!text) return ''
    const rawHtml = marked(text)
    return DOMPurify.sanitize(rawHtml)
}
</script>

<template>
    <div class="chat-view">
        <n-card class="chat-card" content-style="padding: 0; display: flex; flex-direction: column; height: 100%;">
            <template #header>
                <div class="header-content">
                    <span>AI Chat</span>
                    <div class="header-controls">
                        <n-select 
                            v-model:value="selectedModel" 
                            :options="models" 
                            size="small" 
                            style="width: 200px; margin-right: 10px;" 
                            placeholder="Select Model"
                        />
                        <n-button size="small" type="error" ghost @click="handleClear">
                            <template #icon><n-icon><DeleteOutlined /></n-icon></template>
                            Clear
                        </n-button>
                    </div>
                </div>
            </template>
            
            <div class="messages-container" ref="chatContainer">
                <div v-if="chatHistory.length === 0" class="empty-state">
                    <n-icon size="64" color="#ccc"><SmartToyOutlined /></n-icon>
                    <p>Start a conversation...</p>
                </div>
                
                <div v-for="(msg, index) in chatHistory" :key="index" :class="['message-wrapper', msg.role]">
                    <div class="avatar">
                        <n-avatar round size="small" :color="msg.role === 'user' ? '#18a058' : '#2080f0'">
                            <template #icon>
                                <n-icon>
                                    <PersonOutlined v-if="msg.role === 'user'" />
                                    <SmartToyOutlined v-else />
                                </n-icon>
                            </template>
                        </n-avatar>
                    </div>
                    <div class="message-content">
                        <div class="images-grid" v-if="msg.images && msg.images.length">
                            <n-image
                                v-for="(img, i) in msg.images"
                                :key="i"
                                :src="img"
                                width="150"
                                style="border-radius: 8px; margin-bottom: 8px;"
                            />
                        </div>
                        <div class="text-content markdown-body" v-html="renderMarkdown(msg.content)"></div>
                    </div>
                </div>
                
                <div v-if="loading" class="message-wrapper assistant">
                    <div class="avatar">
                        <n-avatar round size="small" color="#2080f0">
                            <template #icon><n-icon><SmartToyOutlined /></n-icon></template>
                        </n-avatar>
                    </div>
                    <div class="message-content loading">
                        <n-spin size="small" />
                    </div>
                </div>
            </div>
            
            <div class="input-area">
                <div class="upload-area" v-if="fileList.length > 0">
                    <div class="preview-list">
                        <div v-for="(file, index) in fileList" :key="index" class="preview-item">
                            <img :src="file.url || URL.createObjectURL(file.file)" />
                            <div class="remove-btn" @click="fileList.splice(index, 1)">×</div>
                        </div>
                    </div>
                </div>
                
                <div class="input-controls">
                    <n-upload
                        abstract
                        :default-file-list="fileList"
                        @update:file-list="(list) => fileList = list"
                        accept="image/*"
                        :max="4"
                    >
                        <template #trigger="{ trigger }">
                            <n-button quaternary circle @click="trigger">
                                <template #icon><n-icon><ImageOutlined /></n-icon></template>
                            </n-button>
                        </template>
                    </n-upload>
                    
                    <n-input
                        v-model:value="userInput"
                        type="textarea"
                        placeholder="Type a message..."
                        :autosize="{ minRows: 1, maxRows: 4 }"
                        @keydown.enter.prevent="handleSend"
                        style="flex: 1; margin: 0 10px;"
                    />
                    
                    <n-button type="primary" circle @click="handleSend" :disabled="loading || (!userInput.trim() && fileList.length === 0)">
                        <template #icon><n-icon><SendOutlined /></n-icon></template>
                    </n-button>
                </div>
            </div>
        </n-card>
    </div>
</template>

<style scoped>
.chat-view {
    height: calc(100vh - 120px);
    display: flex;
    flex-direction: column;
}

.chat-card {
    height: 100%;
}

.header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.header-controls {
    display: flex;
    align-items: center;
}

.messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    background-color: #f9f9f9;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #999;
}

.message-wrapper {
    display: flex;
    margin-bottom: 20px;
    align-items: flex-start;
}

.message-wrapper.user {
    flex-direction: row-reverse;
}

.message-wrapper.user .message-content {
    background-color: #e7f5ee;
    border-radius: 12px 0 12px 12px;
    margin-right: 10px;
}

.message-wrapper.assistant .message-content {
    background-color: #fff;
    border-radius: 0 12px 12px 12px;
    margin-left: 10px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}

.message-content {
    padding: 12px 16px;
    max-width: 70%;
    word-break: break-word;
}

.message-content.loading {
    padding: 12px;
    display: flex;
    align-items: center;
}

.avatar {
    flex-shrink: 0;
}

.input-area {
    padding: 16px;
    border-top: 1px solid #eee;
    background-color: #fff;
}

.input-controls {
    display: flex;
    align-items: flex-end;
}

.upload-area {
    margin-bottom: 10px;
}

.preview-list {
    display: flex;
    gap: 10px;
}

.preview-item {
    position: relative;
    width: 60px;
    height: 60px;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid #eee;
}

.preview-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.remove-btn {
    position: absolute;
    top: 0;
    right: 0;
    background: rgba(0,0,0,0.5);
    color: #fff;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    cursor: pointer;
}

/* Markdown Styles */
.markdown-body {
    font-size: 14px;
    line-height: 1.6;
}

.markdown-body :deep(p) {
    margin-bottom: 8px;
}

.markdown-body :deep(p:last-child) {
    margin-bottom: 0;
}

.markdown-body :deep(pre) {
    background-color: #f6f8fa;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
}

.markdown-body :deep(code) {
    font-family: monospace;
    background-color: rgba(175, 184, 193, 0.2);
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-size: 85%;
}
</style>
