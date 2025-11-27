<script setup>
import { ref, onMounted, reactive } from 'vue'
import { 
  NCard, NForm, NFormItem, NInput, NButton, NInputNumber,
  NSpace, NSwitch, useMessage, NAlert, NDivider, NSlider, NModal
} from 'naive-ui'
import axios from 'axios'
import ModelSelector from '../components/ModelSelector.vue'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

const config = reactive({
  llm: {
    defaultModel: '',
    chatModel: '',
    codeModel: '',
    translationModel: '',
    embeddingModel: 'text-embedding-3-small',
  },
  bym: {
    enable: false,
    probability: 0.02,
    temperature: 0.9,
    maxTokens: 100,
    recall: false,
    model: '',
    systemPrompt: ''
  },
  thinking: {
    enableReasoning: false,
    defaultLevel: 'low'
  },
  streaming: {
    enabled: true
  }
})

const allModels = ref([])
const showModelSelector = ref(false)
const currentModelTarget = ref('defaultModel') // 当前选择模型的目标字段

async function fetchConfig() {
  loading.value = true
  try {
    const res = await axios.get('/api/config')
    if (res.data.code === 0) {
      const data = res.data.data
      
      // Merge data into reactive config
      if (data.llm) Object.assign(config.llm, data.llm)
      if (data.bym) Object.assign(config.bym, data.bym)
      if (data.thinking) Object.assign(config.thinking, data.thinking)
      if (data.streaming) Object.assign(config.streaming, data.streaming)

      // Fetch channels to get all models for selector
      const channelsRes = await axios.get('/api/channels/list')
      if (channelsRes.data.code === 0) {
        const channels = channelsRes.data.data
        const models = new Set()
        channels.forEach(ch => {
          if (ch.models) {
            ch.models.forEach(m => models.add(m))
          }
        })
        allModels.value = Array.from(models).sort()
      }
    }
  } catch (err) {
    message.error('加载配置失败: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  try {
    const payload = {
      llm: { ...config.llm },
      bym: { ...config.bym },
      thinking: { ...config.thinking },
      streaming: { ...config.streaming }
    }

    const res = await axios.post('/api/config', payload)
    if (res.data.code === 0) {
      message.success('配置已保存')
      fetchConfig()
    } else {
      message.error('保存失败: ' + res.data.message)
    }
  } catch (err) {
    message.error('保存失败: ' + err.message)
  } finally {
    saving.value = false
  }
}

function openModelSelector(target) {
  currentModelTarget.value = target
  showModelSelector.value = true
}

function handleModelSelect(models) {
  if (models.length > 0) {
    if (currentModelTarget.value === 'bymModel') {
      config.bym.model = models[0]
    } else {
      config.llm[currentModelTarget.value] = models[0]
    }
  }
  showModelSelector.value = false
}

onMounted(() => {
  fetchConfig()
})
</script>

<template>
  <n-space vertical size="large">
    <n-alert type="info" title="提示" style="margin-bottom: 16px">
      API Key 和渠道配置请前往「渠道管理」页面进行设置
    </n-alert>

    <!-- 模型配置 -->
    <n-card title="模型配置">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="默认模型">
          <n-input v-model:value="config.llm.defaultModel" placeholder="选择模型" readonly @click="openModelSelector('defaultModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('defaultModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        
        <n-divider title-placement="left">场景模式模型 (可选)</n-divider>
        
        <n-form-item label="对话模式">
          <n-input v-model:value="config.llm.chatModel" placeholder="留空使用默认模型" readonly @click="openModelSelector('chatModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('chatModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="代码模式">
          <n-input v-model:value="config.llm.codeModel" placeholder="留空使用默认模型" readonly @click="openModelSelector('codeModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('codeModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="翻译模式">
          <n-input v-model:value="config.llm.translationModel" placeholder="留空使用默认模型" readonly @click="openModelSelector('translationModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('translationModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="嵌入模型">
          <n-input v-model:value="config.llm.embeddingModel" placeholder="text-embedding-3-small" />
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 伪人模式配置 -->
    <n-card title="伪人模式">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="启用">
          <n-switch v-model:value="config.bym.enable" />
        </n-form-item>
        <n-form-item label="触发概率">
          <n-space vertical style="width: 100%">
            <n-slider v-model:value="config.bym.probability" :min="0" :max="1" :step="0.01" :marks="{ 0: '0%', 0.5: '50%', 1: '100%' }" />
            <n-input-number v-model:value="config.bym.probability" :min="0" :max="1" :step="0.01" size="small" style="width: 120px" />
          </n-space>
        </n-form-item>
        <n-form-item label="回复温度">
          <n-space vertical style="width: 100%">
            <n-slider v-model:value="config.bym.temperature" :min="0" :max="2" :step="0.1" :marks="{ 0: '0', 1: '1', 2: '2' }" />
            <n-input-number v-model:value="config.bym.temperature" :min="0" :max="2" :step="0.1" size="small" style="width: 120px" />
          </n-space>
        </n-form-item>
        <n-form-item label="最大 Token">
          <n-input-number v-model:value="config.bym.maxTokens" :min="10" :max="1000" :step="10" style="width: 100%" />
        </n-form-item>
        <n-form-item label="启用记忆">
          <n-switch v-model:value="config.bym.recall" />
        </n-form-item>
        <n-form-item label="使用模型">
          <n-input v-model:value="config.bym.model" placeholder="留空使用默认模型" readonly @click="openModelSelector('bymModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('bymModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="系统提示词">
          <n-input v-model:value="config.bym.systemPrompt" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="伪人模式的系统提示词" />
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 全局设置 -->
    <n-card title="全局设置">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="启用推理 (Thinking)">
          <n-switch v-model:value="config.thinking.enableReasoning" />
        </n-form-item>
        <n-form-item label="流式传输 (Streaming)">
          <n-switch v-model:value="config.streaming.enabled" />
        </n-form-item>
      </n-form>
    </n-card>

    <n-space justify="end">
      <n-button type="primary" size="large" @click="saveConfig" :loading="saving">
        保存配置
      </n-button>
    </n-space>

    <n-modal v-model:show="showModelSelector" preset="card" title="选择模型" style="width: 800px; max-height: 85vh;">
      <ModelSelector 
        :all-models="allModels" 
        :value="[]"
        :multiple="false"
        @update:value="handleModelSelect"
      />
    </n-modal>
  </n-space>
</template>
