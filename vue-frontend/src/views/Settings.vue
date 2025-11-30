<script setup>
import { ref, onMounted, reactive } from 'vue'
import { 
  NCard, NForm, NFormItem, NInput, NButton, NInputNumber,
  NSpace, NSwitch, useMessage, NAlert, NDivider, NSlider, NModal,
  NSelect, NTooltip
} from 'naive-ui'
import axios from 'axios'
import ModelSelector from '../components/ModelSelector.vue'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

const config = reactive({
  basic: {
    toggleMode: 'at',
    togglePrefix: '#chat',
    commandPrefix: '#ai',
    debug: false,
    showThinkingMessage: true,
    debugToConsoleOnly: true,
    quoteReply: true,
    autoRecall: {
      enabled: false,
      delay: 60,
      recallError: true
    }
  },
  llm: {
    defaultModel: '',
    embeddingModel: 'text-embedding-3-small',
    models: {
      chat: '',
      roleplay: '',
      toolCall: '',
      search: '',
      reasoning: ''
    },
    chatModel: '',
    codeModel: '',
    translationModel: '',
  },
  bym: {
    enable: false,
    probability: 0.02,
    temperature: 0.9,
    maxTokens: 100,
    recall: false,
    model: '',
    systemPrompt: '',
    exclusiveFeatures: ['groupSummary', 'userPortrait']
  },
  tools: {
    showCallLogs: true,
    useForwardMsg: true
  },
  thinking: {
    showThinkingContent: true,
    useForwardMsg: true
  },
  features: {
    groupSummary: {
      enabled: true,
      maxMessages: 100
    },
    userPortrait: {
      enabled: true,
      minMessages: 10
    }
  },
  memory: {
    enabled: false,
    autoExtract: true
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
      if (data.basic) {
        Object.assign(config.basic, data.basic)
        if (data.basic.autoRecall) {
          Object.assign(config.basic.autoRecall, data.basic.autoRecall)
        }
      }
      if (data.llm) {
        Object.assign(config.llm, data.llm)
        if (data.llm.models) {
          Object.assign(config.llm.models, data.llm.models)
        }
      }
      if (data.bym) Object.assign(config.bym, data.bym)
      if (data.tools) Object.assign(config.tools, data.tools)
      if (data.thinking) Object.assign(config.thinking, data.thinking)
      if (data.features) {
        if (data.features.groupSummary) Object.assign(config.features.groupSummary, data.features.groupSummary)
        if (data.features.userPortrait) Object.assign(config.features.userPortrait, data.features.userPortrait)
      }
      if (data.memory) Object.assign(config.memory, data.memory)

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
      basic: { ...config.basic },
      llm: { ...config.llm },
      bym: { ...config.bym },
      tools: { ...config.tools },
      thinking: { ...config.thinking },
      features: { ...config.features },
      memory: { ...config.memory }
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
    const target = currentModelTarget.value
    if (target === 'bymModel') {
      config.bym.model = models[0]
    } else if (target.startsWith('models.')) {
      // 新的模型分类配置
      const key = target.replace('models.', '')
      config.llm.models[key] = models[0]
    } else {
      config.llm[target] = models[0]
    }
  }
  showModelSelector.value = false
}

// 触发模式选项
const triggerModeOptions = [
  { label: '仅@触发', value: 'at' },
  { label: '仅前缀触发', value: 'prefix' },
  { label: '@和前缀都触发', value: 'both' }
]

onMounted(() => {
  fetchConfig()
})
</script>

<template>
  <n-space vertical size="large">
    <n-alert type="info" title="提示" style="margin-bottom: 16px">
      API Key 和渠道配置请前往「渠道管理」页面进行设置
    </n-alert>

    <!-- 触发模式配置 -->
    <n-card title="触发模式">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="触发方式">
          <n-select 
            v-model:value="config.basic.toggleMode" 
            :options="triggerModeOptions"
            placeholder="选择触发方式"
          />
        </n-form-item>
        <n-form-item label="触发前缀">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input 
                v-model:value="config.basic.togglePrefix" 
                placeholder="#chat"
                :disabled="config.basic.toggleMode === 'at'"
              />
            </template>
            当触发方式包含前缀时，用户发送此前缀开头的消息会触发AI对话
          </n-tooltip>
        </n-form-item>
        <n-form-item label="命令前缀">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input v-model:value="config.basic.commandPrefix" placeholder="#ai" />
            </template>
            管理命令的前缀，如 #ai帮助、#ai状态 等
          </n-tooltip>
        </n-form-item>
        <n-form-item label="调试模式">
          <n-switch v-model:value="config.basic.debug" />
        </n-form-item>
        <n-form-item label="思考提示">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.basic.showThinkingMessage" />
            </template>
            开启后，AI处理时会先发送"思考中..."提示
          </n-tooltip>
        </n-form-item>
        <n-form-item label="调试仅控制台">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.basic.debugToConsoleOnly" />
            </template>
            开启后，调试信息仅输出到控制台，不发送到聊天
          </n-tooltip>
        </n-form-item>
        <n-form-item label="引用回复">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.basic.quoteReply" />
            </template>
            开启后，AI回复会引用触发消息
          </n-tooltip>
        </n-form-item>
        
        <n-divider title-placement="left">自动撤回</n-divider>
        
        <n-form-item label="启用自动撤回">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.basic.autoRecall.enabled" />
            </template>
            开启后，AI回复会在指定时间后自动撤回
          </n-tooltip>
        </n-form-item>
        <n-form-item label="撤回延迟(秒)" v-if="config.basic.autoRecall.enabled">
          <n-input-number v-model:value="config.basic.autoRecall.delay" :min="5" :max="300" />
        </n-form-item>
        <n-form-item label="撤回错误消息" v-if="config.basic.autoRecall.enabled">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.basic.autoRecall.recallError" />
            </template>
            开启后，错误提示也会自动撤回
          </n-tooltip>
        </n-form-item>
      </n-form>
    </n-card>

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
        
        <n-divider title-placement="left">模型分类 (可选，留空使用默认模型)</n-divider>
        
        <n-form-item label="对话模型">
          <n-input v-model:value="config.llm.models.chat" placeholder="普通聊天使用的模型" readonly @click="openModelSelector('models.chat')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('models.chat')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="伪人模型">
          <n-input v-model:value="config.llm.models.roleplay" placeholder="模拟真人回复的模型" readonly @click="openModelSelector('models.roleplay')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('models.roleplay')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="工具调用模型">
          <n-input v-model:value="config.llm.models.toolCall" placeholder="Function Calling 模型" readonly @click="openModelSelector('models.toolCall')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('models.toolCall')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="搜索模型">
          <n-input v-model:value="config.llm.models.search" placeholder="联网搜索使用的模型" readonly @click="openModelSelector('models.search')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('models.search')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        <n-form-item label="思考模型">
          <n-input v-model:value="config.llm.models.reasoning" placeholder="深度推理使用的模型" readonly @click="openModelSelector('models.reasoning')">
             <template #suffix>
                <n-button size="small" @click.stop="openModelSelector('models.reasoning')">选择</n-button>
             </template>
          </n-input>
        </n-form-item>
        
        <n-divider title-placement="left">其他配置</n-divider>
        
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

    <!-- 工具调用配置 -->
    <n-card title="工具调用">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="显示调用日志">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.tools.showCallLogs" />
            </template>
            开启后，显示工具调用的详细日志
          </n-tooltip>
        </n-form-item>
        <n-form-item label="日志合并转发">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.tools.useForwardMsg" />
            </template>
            开启后，工具调用日志使用合并转发发送
          </n-tooltip>
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 深度思考配置 -->
    <n-card title="深度思考">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="显示思考内容">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.thinking.showThinkingContent" />
            </template>
            开启后，显示AI的思考过程
          </n-tooltip>
        </n-form-item>
        <n-form-item label="思考合并转发">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.thinking.useForwardMsg" />
            </template>
            开启后，思考内容使用合并转发发送
          </n-tooltip>
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 高级功能配置 -->
    <n-card title="高级功能">
      <n-form label-placement="left" label-width="140">
        <n-divider title-placement="left">群聊总结</n-divider>
        <n-form-item label="启用">
          <n-switch v-model:value="config.features.groupSummary.enabled" />
        </n-form-item>
        <n-form-item label="最大消息数">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input-number v-model:value="config.features.groupSummary.maxMessages" :min="10" :max="500" :step="10" style="width: 150px" />
            </template>
            总结时分析的最大消息数量
          </n-tooltip>
        </n-form-item>

        <n-divider title-placement="left">个人画像</n-divider>
        <n-form-item label="启用">
          <n-switch v-model:value="config.features.userPortrait.enabled" />
        </n-form-item>
        <n-form-item label="最少消息数">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input-number v-model:value="config.features.userPortrait.minMessages" :min="5" :max="100" :step="5" style="width: 150px" />
            </template>
            生成画像需要的最少消息数量
          </n-tooltip>
        </n-form-item>

        <n-divider title-placement="left">长期记忆</n-divider>
        <n-form-item label="启用记忆">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.memory.enabled" />
            </template>
            启用后，AI会记住用户透露的个人信息和偏好
          </n-tooltip>
        </n-form-item>
        <n-form-item label="自动提取">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.memory.autoExtract" :disabled="!config.memory.enabled" />
            </template>
            自动从对话中提取值得记忆的信息
          </n-tooltip>
        </n-form-item>
      </n-form>
    </n-card>

    <n-alert type="info" title="命令提示" style="margin-top: 8px">
      <div>• <strong>#群聊总结</strong> - 总结群聊消息</div>
      <div>• <strong>#个人画像</strong> - 分析自己的用户画像</div>
      <div>• <strong>#分析 @用户</strong> - 分析指定用户的画像</div>
    </n-alert>

    <n-space justify="end" style="margin-top: 16px">
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
