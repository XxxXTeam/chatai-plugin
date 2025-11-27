<script setup>
import { ref, onMounted, h, computed } from 'vue'
import { NSpace, NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect, NDynamicTags, NMessageProvider, useMessage, NTag, NPopconfirm, NCollapse, NCollapseItem, NSwitch, NSlider, NInputNumber, NCheckbox, NCheckboxGroup, NIcon, NText, NInputGroup, NButtonGroup, NDivider, NDynamicInput, NRadioGroup, NRadioButton } from 'naive-ui'
import { SearchOutlined } from '@vicons/material'
import axios from 'axios'
import ModelSelector from '../components/ModelSelector.vue'

const message = useMessage()
const channels = ref([])
const showModal = ref(false)
const showModelSelector = ref(false)  // 模型选择对话框
const loading = ref(false)
const modelLoading = ref(false)
const isEdit = ref(false)
const currentId = ref('')

// 模型选择相关
const availableModels = ref([])  // 从API获取的所有模型
const selectedModels = ref([])   // 用户选择的模型
const searchQuery = ref('')       // 搜索关键词

const formRef = ref(null)
const formValue = ref({
  name: '',
  adapterType: 'openai',
  baseUrl: '',
  apiKey: '',
  apiKeys: [],
  strategy: 'round-robin',
  models: [],
  priority: 1,
  enabled: true,
  advanced: {
    streaming: {
      enabled: false,  // 默认不启用流式输出
      chunkSize: 1024
    },
    thinking: {
      enableReasoning: false,
      defaultLevel: 'medium',
      adaptThinking: true,
      sendThinkingAsMessage: false
    },
    llm: {
      temperature: 0.7,
      maxTokens: 4000,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0
    }
  }
})

const rules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' },
  adapterType: { required: true, message: '请选择类型', trigger: 'change' },
  baseUrl: { required: true, message: '请输入BaseURL', trigger: 'blur' },
  apiKey: { required: true, message: '请输入API Key', trigger: 'blur' }
}

const columns = [
  { title: '名称', key: 'name' },
  { title: '类型', key: 'adapterType' },
  { title: 'BaseURL', key: 'baseUrl', ellipsis: { tooltip: true } },
  { 
    title: '启用', 
    key: 'enabled',
    width: 80,
    render(row) {
      return h(NSwitch, {
        value: row.enabled,
        onUpdateValue: (value) => handleToggleEnabled(row, value)
      })
    }
  },
  { 
    title: '状态', 
    key: 'status',
    width: 80,
    render(row) {
      return h(NTag, {
        type: row.status === 'active' ? 'success' : row.status === 'error' ? 'error' : 'default',
        size: 'small'
      }, { default: () => row.status || 'idle' })
    }
  },
  { 
    title: '优先级', 
    key: 'priority',
    width: 80,
    sorter: (row1, row2) => row1.priority - row2.priority
  },
  { 
    title: '操作', 
    key: 'actions',
    width: 180,
    render(row) {
      return h(NSpace, {}, {
        default: () => [
          h(NButton, {
            size: 'small',
            onClick: () => handleTest(row)
          }, { default: () => '测试' }),
          h(NButton, {
            size: 'small',
            onClick: () => editChannel(row)
          }, { default: () => '编辑' }),
          h(NPopconfirm, {
            onPositiveClick: () => handleDelete(row)
          }, {
            trigger: () => h(NButton, {
              size: 'small',
              type: 'error'
            }, { default: () => '删除' }),
            default: () => '确定要删除吗？'
          })
        ]
      })
    }
  }
]

// 切换渠道启用状态
async function handleToggleEnabled(row, enabled) {
  try {
    const res = await axios.put(`/api/channels/${row.id}`, {
      ...row,
      enabled
    })
    if (res.data.code === 0) {
      message.success(enabled ? '渠道已启用' : '渠道已禁用')
      fetchChannels()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('操作失败: ' + (err.response?.data?.message || err.message))
  }
}

async function fetchChannels() {
  try {
    const res = await axios.get('/api/channels/list')
    if (res.data.code === 0) {
      channels.value = res.data.data
    }
  } catch (err) {
    message.error('获取渠道列表失败')
  }
}

function addChannel() {
  isEdit.value = false
  currentId.value = ''
  formValue.value = {
    name: '',
    adapterType: 'openai',
    baseUrl: '',
    apiKey: '',
    apiKeys: [],
    strategy: 'round-robin',
    models: [],
    priority: 1,
    enabled: true,
    advanced: {
      streaming: {
        enabled: false,  // 默认不启用流式输出
        chunkSize: 1024
      },
      thinking: {
        enableReasoning: false,
        defaultLevel: 'medium',
        adaptThinking: true,
        sendThinkingAsMessage: false
      },
      llm: {
        temperature: 0.7,
        maxTokens: 4000,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0
      }
    }
  }
  showModal.value = true
}

function editChannel(row) {
  isEdit.value = true
  currentId.value = row.id
  // Merge with default advanced settings if not present
  formValue.value = { 
    ...row, 
    apiKey: row.apiKey || '',
    apiKeys: row.apiKeys && row.apiKeys.length > 0 ? row.apiKeys : (row.apiKey ? [{ key: row.apiKey, enabled: true }] : []),
    strategy: row.strategy || 'round-robin',
    advanced: row.advanced || {
      streaming: {
        enabled: false,  // 默认不启用流式输出
        chunkSize: 1024
      },
      thinking: {
        enableReasoning: false,
        defaultLevel: 'medium',
        adaptThinking: true,
        sendThinkingAsMessage: false
      },
      llm: {
        temperature: 0.7,
        maxTokens: 4000,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0
      }
    }
  } 
  showModal.value = true
}

async function handleDelete(row) {
  try {
    const res = await axios.delete(`/api/channels/${row.id}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      fetchChannels()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('删除失败')
  }
}

async function handleTest(row) {
  try {
    const res = await axios.post('/api/channels/test', {
      adapterType: row.adapterType,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      models: row.models || [],
      advanced: row.advanced || {}
    })
    
    if (res.data.code === 0) {
      message.success(res.data.data.message)
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('测试失败: ' + (err.response?.data?.message || err.message))
  }
}



// 统计新获取的模型数量
const newModelsCount = computed(() => {
  return availableModels.value.filter(model => 
    !formValue.value.models.includes(model)
  ).length
})

// 已有模型数量
const existingModelsCount = computed(() => {
  return formValue.value.models.length
})

async function fetchModels() {
  // Use first enabled key for fetching models
  const activeKey = formValue.value.apiKeys.find(k => k.enabled)?.key || formValue.value.apiKey
  
  if (!formValue.value.baseUrl || !activeKey) {
    message.warning('请先填写 BaseURL 和至少一个启用的 API Key')
    return
  }
  
  modelLoading.value = true
  try {
    const res = await axios.post('/api/channels/fetch-models', {
      adapterType: formValue.value.adapterType,
      baseUrl: formValue.value.baseUrl,
      apiKey: activeKey
    })
    
    if (res.data.code === 0) {
      availableModels.value = res.data.data.models
      selectedModels.value = formValue.value.models || []  // 保留已选择的
      showModelSelector.value = true  // 显示选择对话框
      message.success(`获取到 ${res.data.data.models.length} 个模型`)
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('获取模型失败: ' + err.message)
  } finally {
    modelLoading.value = false
  }
}

// 确认选择模型
function confirmModelSelection() {
  formValue.value.models = [...selectedModels.value]
  showModelSelector.value = false
  message.success(`已选择 ${selectedModels.value.length} 个模型`)
}

function onCreateKey() {
  return {
    key: '',
    enabled: true
  }
}



async function handleSubmit() {
  formRef.value?.validate(async (errors) => {
    if (!errors) {
      try {
        let res
        if (isEdit.value) {
          res = await axios.put(`/api/channels/${currentId.value}`, formValue.value)
        } else {
          res = await axios.post('/api/channels', formValue.value)
        }
        
        if (res.data.code === 0) {
          message.success('保存成功')
          showModal.value = false
          fetchChannels()
        } else {
          message.error(res.data.message)
        }
      } catch (err) {
        message.error('保存失败')
      }
    }
  })
}

onMounted(() => {
  fetchChannels()
})
</script>

<template>
  <n-space vertical>
    <n-card title="渠道管理">
      <template #header-extra>
        <n-button type="primary" @click="addChannel">添加渠道</n-button>
      </template>
      <n-data-table :columns="columns" :data="channels" />
    </n-card>

    <n-modal v-model:show="showModal" preset="card" title="配置渠道" style="width: 600px">
      <n-form ref="formRef" :model="formValue" :rules="rules" label-placement="left" label-width="100">
        <n-form-item label="名称" path="name">
          <n-input v-model:value="formValue.name" placeholder="请输入名称" />
        </n-form-item>
        <n-form-item label="类型" path="adapterType">
          <n-select v-model:value="formValue.adapterType" :options="[
            { label: 'OpenAI', value: 'openai' },
            { label: 'Gemini', value: 'gemini' },
            { label: 'Claude', value: 'claude' }
          ]" />
        </n-form-item>
        <n-form-item label="BaseURL" path="baseUrl">
          <n-input v-model:value="formValue.baseUrl" placeholder="请输入BaseURL" />
        </n-form-item>
        <n-form-item label="轮询策略" path="strategy">
          <n-radio-group v-model:value="formValue.strategy">
            <n-radio-button value="round-robin" label="轮询 (Round Robin)" />
            <n-radio-button value="random" label="随机 (Random)" />
          </n-radio-group>
        </n-form-item>

        <n-form-item label="API Keys" path="apiKeys">
             <n-dynamic-input v-model:value="formValue.apiKeys" :on-create="onCreateKey">
               <template #default="{ value }">
                 <div style="display: flex; align-items: center; width: 100%; gap: 10px">
                   <n-input v-model:value="value.key" placeholder="sk-..." type="password" show-password-on="click" />
                   <n-switch v-model:value="value.enabled">
                     <template #checked>启用</template>
                     <template #unchecked>禁用</template>
                   </n-switch>
                 </div>
               </template>
             </n-dynamic-input>
        </n-form-item>
        <n-form-item label="优先级" path="priority">
          <n-input v-model:value="formValue.priority" type="number" placeholder="数字越小优先级越高" />
        </n-form-item>
        <n-form-item label="模型列表" path="models">
          <n-space vertical style="width: 100%">
            <n-dynamic-tags v-model:value="formValue.models" />
            <n-button block :loading="modelLoading" @click="fetchModels">获取模型列表</n-button>
          </n-space>
        </n-form-item>
        
        <!-- Advanced Settings -->
        <n-form-item label="高级设置">
          <n-collapse style="width: 100%">
            <n-collapse-item title="流式输出设置" name="streaming">
              <n-space vertical>
                <n-form-item label="启用流式输出" label-placement="left">
                  <n-switch v-model:value="formValue.advanced.streaming.enabled" />
                </n-form-item>
                <n-form-item label="块大小" label-placement="left">
                  <n-input-number 
                    v-model:value="formValue.advanced.streaming.chunkSize" 
                    :min="512" 
                    :max="8192" 
                    :step="512"
                    style="width: 100%"
                  />
                </n-form-item>
              </n-space>
            </n-collapse-item>
            
            <n-collapse-item title="思考控制设置" name="thinking">
              <n-space vertical>
                <n-form-item label="启用推理模式" label-placement="left">
                  <n-switch v-model:value="formValue.advanced.thinking.enableReasoning" />
                </n-form-item>
                <n-form-item label="默认思考级别" label-placement="left">
                  <n-select 
                    v-model:value="formValue.advanced.thinking.defaultLevel"
                    :options="[
                      { label: '低 (Low)', value: 'low' },
                      { label: '中 (Medium)', value: 'medium' },
                      { label: '高 (High)', value: 'high' }
                    ]"
                  />
                </n-form-item>
                <n-form-item label="自适应思考" label-placement="left">
                  <n-switch v-model:value="formValue.advanced.thinking.adaptThinking" />
                </n-form-item>
                <n-form-item label="发送思考为消息" label-placement="left">
                  <n-switch v-model:value="formValue.advanced.thinking.sendThinkingAsMessage" />
                </n-form-item>
              </n-space>
            </n-collapse-item>
            
            <n-collapse-item title="LLM 参数设置" name="llm">
              <n-space vertical>
                <n-form-item label="Temperature" label-placement="left">
                  <n-space vertical style="width: 100%">
                    <n-slider 
                      v-model:value="formValue.advanced.llm.temperature" 
                      :min="0" 
                      :max="2" 
                      :step="0.1"
                      :marks="{ 0: '0', 1: '1', 2: '2' }"
                    />
                    <n-input-number 
                      v-model:value="formValue.advanced.llm.temperature" 
                      :min="0" 
                      :max="2" 
                      :step="0.1"
                      size="small"
                      style="width: 100px"
                    />
                  </n-space>
                </n-form-item>
                
                <n-form-item label="Max Tokens" label-placement="left">
                  <n-input-number 
                    v-model:value="formValue.advanced.llm.maxTokens" 
                    :min="100" 
                    :max="128000" 
                    :step="100"
                    style="width: 100%"
                  />
                </n-form-item>
                
                <n-form-item label="Top P" label-placement="left">
                  <n-space vertical style="width: 100%">
                    <n-slider 
                      v-model:value="formValue.advanced.llm.topP" 
                      :min="0" 
                      :max="1" 
                      :step="0.1"
                      :marks="{ 0: '0', 0.5: '0.5', 1: '1' }"
                    />
                    <n-input-number 
                      v-model:value="formValue.advanced.llm.topP" 
                      :min="0" 
                      :max="1" 
                      :step="0.1"
                      size="small"
                      style="width: 100px"
                    />
                  </n-space>
                </n-form-item>
                
                <n-form-item label="Frequency Penalty" label-placement="left">
                  <n-space vertical style="width: 100%">
                    <n-slider 
                      v-model:value="formValue.advanced.llm.frequencyPenalty" 
                      :min="-2" 
                      :max="2" 
                      :step="0.1"
                      :marks="{ '-2': '-2', 0: '0', 2: '2' }"
                    />
                    <n-input-number 
                      v-model:value="formValue.advanced.llm.frequencyPenalty" 
                      :min="-2" 
                      :max="2" 
                      :step="0.1"
                      size="small"
                      style="width: 100px"
                    />
                  </n-space>
                </n-form-item>
                
                <n-form-item label="Presence Penalty" label-placement="left">
                  <n-space vertical style="width: 100%">
                    <n-slider 
                      v-model:value="formValue.advanced.llm.presencePenalty" 
                      :min="-2" 
                      :max="2" 
                      :step="0.1"
                      :marks="{ '-2': '-2', 0: '0', 2: '2' }"
                    />
                    <n-input-number 
                      v-model:value="formValue.advanced.llm.presencePenalty" 
                      :min="-2" 
                      :max="2" 
                      :step="0.1"
                      size="small"
                      style="width: 100px"
                    />
                  </n-space>
                </n-form-item>
              </n-space>
            </n-collapse-item>
          </n-collapse>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSubmit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
    
    <!-- 模型选择对话框 -->
    <n-modal 
      v-model:show="showModelSelector" 
      preset="card" 
      title="选择模型" 
      style="width: 800px; max-height: 85vh;"
      :segmented="{
        content: 'soft',
        footer: 'soft'
      }"
    >
      <ModelSelector 
        :all-models="availableModels" 
        v-model:value="selectedModels"
        :multiple="true"
      />
      
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModelSelector = false">取消</n-button>
          <n-button type="primary" @click="confirmModelSelection">
            确定 ({{ selectedModels.length }})
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>

<style scoped>
/* 美化滚动条 */
:deep(.n-scrollbar-content) {
  padding-right: 8px;
}

/* 自定义滚动条样式 */
div::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

div::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

div::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  transition: all 0.3s;
}

div::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

/* 暗色模式滚动条 */
html.dark div::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}

html.dark div::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

html.dark div::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* 折叠面板过渡效果 */
:deep(.n-collapse-item) {
  transition: all 0.3s ease;
}

:deep(.n-collapse-item:hover) {
  background: rgba(0, 0, 0, 0.02);
}

html.dark :deep(.n-collapse-item:hover) {
  background: rgba(255, 255, 255, 0.02);
}

/* 复选框美化 */
:deep(.n-checkbox) {
  transition: all 0.2s ease;
}

:deep(.n-checkbox:hover) {
  transform: translateX(2px);
}

/* 标签动画 */
:deep(.n-tag) {
  transition: all 0.3s ease;
}

/* 按钮组美化 */
:deep(.n-space) {
  gap: 8px;
}

/* 模型列表项间距 */
:deep(.n-collapse-item__content-wrapper) {
  padding-top: 12px;
  padding-bottom: 12px;
}
</style>
