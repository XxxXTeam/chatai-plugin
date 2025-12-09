<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NSpace, NForm, NFormItem, NButton, NSelect, useMessage, NDivider, NText, NTag } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

const config = ref({
  llm: {
    defaultModel: '',
    embeddingModel: '',
    chatModel: '',
    codeModel: '',
    translationModel: ''
  }
})

const allModels = ref([])

// 模型选项（带分组）
const modelOptions = computed(() => {
  const groups = {
    'OpenAI': [],
    'Claude': [],
    'Gemini': [],
    'DeepSeek': [],
    'Qwen': [],
    '其他': []
  }
  
  allModels.value.forEach(model => {
    const lower = model.toLowerCase()
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) {
      groups['OpenAI'].push(model)
    } else if (lower.includes('claude')) {
      groups['Claude'].push(model)
    } else if (lower.includes('gemini')) {
      groups['Gemini'].push(model)
    } else if (lower.includes('deepseek')) {
      groups['DeepSeek'].push(model)
    } else if (lower.includes('qwen') || lower.includes('qwq')) {
      groups['Qwen'].push(model)
    } else {
      groups['其他'].push(model)
    }
  })
  
  const options = []
  Object.entries(groups).forEach(([name, models]) => {
    if (models.length > 0) {
      options.push({
        type: 'group',
        label: name,
        key: name,
        children: models.map(m => ({ label: m, value: m }))
      })
    }
  })
  
  return options
})

async function fetchData() {
  loading.value = true
  try {
    const configRes = await axios.get('/api/config')
    if (configRes.data.code === 0) {
      const data = configRes.data.data
      config.value.llm = {
        ...config.value.llm,
        ...data.llm
      }
    }

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
  } catch (err) {
    message.error('获取数据失败')
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    const res = await axios.post('/api/config', {
      llm: config.value.llm
    })
    if (res.data.code === 0) {
      message.success('保存成功')
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

function clearModel(field) {
  config.value.llm[field] = ''
}

onMounted(() => {
  fetchData()
})
</script>

<template>
  <n-space vertical :size="16">
    <n-card title="模型配置" size="medium">
      <template #header-extra>
        <n-tag type="info">共 {{ allModels.length }} 个模型可用</n-tag>
      </template>
      
      <n-form label-placement="left" label-width="100" :style="{ maxWidth: '600px' }">
        <n-divider title-placement="left">全局默认</n-divider>
        
        <n-form-item label="默认模型">
          <n-select 
            v-model:value="config.llm.defaultModel" 
            :options="modelOptions" 
            placeholder="选择默认模型"
            filterable
            clearable
            :style="{ width: '100%' }"
          />
        </n-form-item>
        
        <n-form-item label="嵌入模型">
          <n-select 
            v-model:value="config.llm.embeddingModel" 
            :options="modelOptions" 
            placeholder="用于向量嵌入的模型"
            filterable
            clearable
            :style="{ width: '100%' }"
          />
        </n-form-item>

        <n-divider title-placement="left">场景模式</n-divider>
        <n-text depth="3" style="display: block; margin-bottom: 16px; font-size: 13px;">
          留空则使用默认模型
        </n-text>
        
        <n-form-item label="对话模式">
          <n-select 
            v-model:value="config.llm.chatModel" 
            :options="modelOptions" 
            placeholder="使用默认模型"
            filterable
            clearable
            :style="{ width: '100%' }"
          />
        </n-form-item>
        
        <n-form-item label="代码模式">
          <n-select 
            v-model:value="config.llm.codeModel" 
            :options="modelOptions" 
            placeholder="使用默认模型"
            filterable
            clearable
            :style="{ width: '100%' }"
          />
        </n-form-item>
        
        <n-form-item label="翻译模式">
          <n-select 
            v-model:value="config.llm.translationModel" 
            :options="modelOptions" 
            placeholder="使用默认模型"
            filterable
            clearable
            :style="{ width: '100%' }"
          />
        </n-form-item>

        <n-divider />
        
        <n-form-item>
          <n-button type="primary" @click="handleSave" :loading="saving">保存配置</n-button>
        </n-form-item>
      </n-form>
    </n-card>
  </n-space>
</template>
