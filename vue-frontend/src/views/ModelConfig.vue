<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NSpace, NForm, NFormItem, NButton, NSelect, useMessage, NDivider, NModal, NInput } from 'naive-ui'
import axios from 'axios'
import ModelSelector from '../components/ModelSelector.vue'

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
const showSelector = ref(false)
const currentSelectorTarget = ref('') // 'default', 'embedding', 'chat', etc.

async function fetchData() {
  loading.value = true
  try {
    // Fetch config
    const configRes = await axios.get('/api/config')
    if (configRes.data.code === 0) {
      const data = configRes.data.data
      config.value.llm = {
        ...config.value.llm,
        ...data.llm
      }
    }

    // Fetch channels to get all models
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

function openSelector(target) {
  currentSelectorTarget.value = target
  showSelector.value = true
}

function handleModelSelect(models) {
  if (models.length > 0) {
    config.value.llm[currentSelectorTarget.value] = models[0]
  }
  showSelector.value = false
}

onMounted(() => {
  fetchData()
})
</script>

<template>
  <n-space vertical>
    <n-card title="模型配置">
      <n-form label-placement="left" label-width="120">
        <n-divider title-placement="left">全局默认</n-divider>
        <n-form-item label="默认模型">
          <n-input v-model:value="config.llm.defaultModel" placeholder="选择或输入模型名称" readonly @click="openSelector('defaultModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openSelector('defaultModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="嵌入模型">
           <n-input v-model:value="config.llm.embeddingModel" placeholder="选择或输入模型名称" readonly @click="openSelector('embeddingModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openSelector('embeddingModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>

        <n-divider title-placement="left">场景模式模型</n-divider>
        <n-form-item label="对话模式">
           <n-input v-model:value="config.llm.chatModel" placeholder="默认使用全局模型" readonly @click="openSelector('chatModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openSelector('chatModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="代码模式">
           <n-input v-model:value="config.llm.codeModel" placeholder="默认使用全局模型" readonly @click="openSelector('codeModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openSelector('codeModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="翻译模式">
           <n-input v-model:value="config.llm.translationModel" placeholder="默认使用全局模型" readonly @click="openSelector('translationModel')">
             <template #suffix>
                <n-button size="small" @click.stop="openSelector('translationModel')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>

        <n-form-item>
          <n-button type="primary" @click="handleSave" :loading="saving">保存配置</n-button>
        </n-form-item>
      </n-form>
    </n-card>

    <n-modal v-model:show="showSelector" preset="card" title="选择模型" style="width: 800px; max-height: 85vh;">
      <ModelSelector 
        :all-models="allModels" 
        :value="config.llm[currentSelectorTarget] ? [config.llm[currentSelectorTarget]] : []"
        :multiple="false"
        @update:value="handleModelSelect"
      />
    </n-modal>
  </n-space>
</template>
