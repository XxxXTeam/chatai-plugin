<script setup>
import { ref, onMounted, reactive, computed } from 'vue'
import { 
  NCard, NForm, NFormItem, NInput, NButton, NInputNumber,
  NSpace, NSwitch, useMessage, NAlert, NDivider, NSlider, NModal,
  NSelect, NTooltip, NDynamicTags, NTabs, NTabPane, NGrid, NGridItem
} from 'naive-ui'
import axios from 'axios'
import ModelSelector from '../components/ModelSelector.vue'

const message = useMessage()
const loading = ref(false)
const saving = ref(false)

const config = reactive({
  basic: {
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
  admin: {
    masterQQ: [],
    loginNotifyPrivate: true,
    sensitiveCommandMasterOnly: true
  },
  llm: {
    defaultModel: '',
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
    inheritPersonality: true,
    exclusiveFeatures: ['groupSummary', 'userPortrait']
  },
  tools: {
    showCallLogs: true,
    useForwardMsg: true,
    parallelExecution: true,
    sendIntermediateReply: true
  },
  personality: {
    isolateContext: {
      enabled: false,
      clearOnSwitch: false
    }
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
    },
    poke: {
      enabled: false,
      pokeBack: false,
      message: '别戳了~'
    },
    reaction: {
      enabled: false
    },
    imageGen: {
      enabled: true,
      apiUrl: 'https://business.928100.xyz/v1/chat/completions',
      apiKey: 'X-Free',
      model: 'gemini-3-pro-image'
    }
  },
  memory: {
    enabled: false,
    autoExtract: true
  },
  // AI触发配置（新结构）
  trigger: {
    private: { enabled: true, mode: 'always' },
    group: { enabled: true, at: true, prefix: true, keyword: false, random: false, randomRate: 0.05 },
    prefixes: ['#chat'],
    prefixPersonas: [],  // 前缀人格配置
    keywords: [],
    collectGroupMsg: true,
    blacklistUsers: [],
    whitelistUsers: [],
    blacklistGroups: [],
    whitelistGroups: []
  }
})

// 私聊模式选项
const privateModeOptions = [
  { label: '总是响应', value: 'always' },
  { label: '需要前缀', value: 'prefix' },
  { label: '关闭', value: 'off' }
]

// 前缀输入处理
const prefixesText = computed({
  get: () => (config.trigger.prefixes || []).join(', '),
  set: (val) => {
    config.trigger.prefixes = val.split(/[,，]\s*/).filter(Boolean)
  }
})

// 关键词输入处理
const keywordsText = computed({
  get: () => (config.trigger.keywords || []).join(', '),
  set: (val) => {
    config.trigger.keywords = val.split(/[,，]\s*/).filter(Boolean)
  }
})

const allModels = ref([])
const showModelSelector = ref(false)
const currentModelTarget = ref('defaultModel') // 当前选择模型的目标字段
const masterQQInput = ref('') // 主人QQ输入框

// 解析主人QQ输入
function parseMasterQQ() {
  const input = masterQQInput.value.trim()
  if (!input) {
    config.admin.masterQQ = []
  } else {
    config.admin.masterQQ = input.split(/[,，\s]+/).filter(Boolean)
  }
}

// 格式化主人QQ显示
function formatMasterQQ() {
  masterQQInput.value = (config.admin.masterQQ || []).join(', ')
}

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
      if (data.admin) Object.assign(config.admin, data.admin)
      if (data.bym) Object.assign(config.bym, data.bym)
      if (data.tools) Object.assign(config.tools, data.tools)
      if (data.thinking) Object.assign(config.thinking, data.thinking)
      if (data.personality?.isolateContext) {
        config.personality.isolateContext = { ...config.personality.isolateContext, ...data.personality.isolateContext }
      }
      if (data.features) {
        if (data.features.groupSummary) Object.assign(config.features.groupSummary, data.features.groupSummary)
        if (data.features.userPortrait) Object.assign(config.features.userPortrait, data.features.userPortrait)
        if (data.features.poke) Object.assign(config.features.poke, data.features.poke)
        if (data.features.reaction) Object.assign(config.features.reaction, data.features.reaction)
      }
      if (data.memory) Object.assign(config.memory, data.memory)
      // 加载trigger配置（新结构）
      if (data.trigger) {
        config.trigger.private = data.trigger.private || { enabled: true, mode: 'always' }
        config.trigger.group = data.trigger.group || { enabled: true, at: true, prefix: true, keyword: false, random: false, randomRate: 0.05 }
        // 过滤无效的 prefix 值（null, undefined, 空字符串）
        const rawPrefixes = data.trigger.prefixes || ['#chat']
        config.trigger.prefixes = (Array.isArray(rawPrefixes) ? rawPrefixes : [rawPrefixes])
          .filter(p => p && typeof p === 'string' && p.trim())
        // 过滤无效的 keyword 值
        const rawKeywords = data.trigger.keywords || []
        config.trigger.keywords = (Array.isArray(rawKeywords) ? rawKeywords : [rawKeywords])
          .filter(k => k && typeof k === 'string' && k.trim())
        config.trigger.collectGroupMsg = data.trigger.collectGroupMsg ?? true
        config.trigger.blacklistUsers = data.trigger.blacklistUsers || []
        config.trigger.whitelistUsers = data.trigger.whitelistUsers || []
        config.trigger.blacklistGroups = data.trigger.blacklistGroups || []
        config.trigger.whitelistGroups = data.trigger.whitelistGroups || []
      }

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
      
      // 格式化主人QQ显示
      formatMasterQQ()
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
    // 清理 trigger 中的无效值
    const cleanedTrigger = { ...config.trigger }
    cleanedTrigger.prefixes = (config.trigger.prefixes || []).filter(p => p && typeof p === 'string' && p.trim())
    cleanedTrigger.keywords = (config.trigger.keywords || []).filter(k => k && typeof k === 'string' && k.trim())
    
    const payload = {
      basic: { ...config.basic },
      admin: { ...config.admin },
      llm: { ...config.llm },
      bym: { ...config.bym },
      tools: { ...config.tools },
      thinking: { ...config.thinking },
      features: { ...config.features },
      memory: { ...config.memory },
      trigger: cleanedTrigger,
      personality: { ...config.personality }
    }

    const res = await axios.post('/api/config', payload)
    if (res.data.code === 0) {
      message.success('✓ 配置已保存', { duration: 2000 })
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

onMounted(() => {
  fetchConfig()
})
</script>

<template>
  <n-space vertical size="large">
    <n-alert type="info" title="提示" style="margin-bottom: 16px">
      API Key 和渠道配置请前往「渠道管理」页面进行设置
    </n-alert>

    <!-- AI触发配置（重构版） -->
    <n-card title="AI触发配置">
      <n-alert type="info" style="margin-bottom: 16px;">
        配置机器人何时响应消息。私聊和群聊可独立配置触发方式。
      </n-alert>
      
      <n-form label-placement="left" label-width="140">
        <!-- 私聊配置 -->
        <n-divider title-placement="left">私聊触发</n-divider>
        
        <n-form-item label="响应私聊">
          <n-switch v-model:value="config.trigger.private.enabled" />
        </n-form-item>
        <n-form-item label="私聊模式" v-if="config.trigger.private.enabled">
          <n-select 
            v-model:value="config.trigger.private.mode" 
            :options="privateModeOptions"
            style="width: 180px;"
          />
        </n-form-item>
        
        <!-- 群聊配置 -->
        <n-divider title-placement="left">群聊触发</n-divider>
        
        <n-form-item label="响应群聊">
          <n-switch v-model:value="config.trigger.group.enabled" />
        </n-form-item>
        
        <template v-if="config.trigger.group.enabled">
          <n-form-item label="@机器人触发">
            <n-switch v-model:value="config.trigger.group.at" />
          </n-form-item>
          <n-form-item label="前缀触发">
            <n-switch v-model:value="config.trigger.group.prefix" />
          </n-form-item>
          <n-form-item label="关键词触发">
            <n-switch v-model:value="config.trigger.group.keyword" />
          </n-form-item>
          <n-form-item label="随机触发">
            <n-space align="center">
              <n-switch v-model:value="config.trigger.group.random" />
              <template v-if="config.trigger.group.random">
                <n-slider v-model:value="config.trigger.group.randomRate" :min="0" :max="0.5" :step="0.01" style="width: 120px;" />
                <span>{{ (config.trigger.group.randomRate * 100).toFixed(0) }}%</span>
              </template>
            </n-space>
          </n-form-item>
        </template>
        
        <!-- 触发词配置 -->
        <n-divider title-placement="left">触发词</n-divider>
        
        <n-form-item label="触发前缀">
          <n-input v-model:value="prefixesText" placeholder="多个用逗号分隔，如: #chat, 小助手" />
        </n-form-item>
        <n-form-item label="触发关键词" v-if="config.trigger.group.keyword">
          <n-input v-model:value="keywordsText" placeholder="消息包含这些词时触发" />
        </n-form-item>
        
        <!-- 前缀人格 -->
        <n-divider title-placement="left">前缀人格</n-divider>
        <n-alert type="info" style="margin-bottom: 12px;">
          设置特定前缀触发独立人格，该前缀仅使用此人格，不影响其他对话
        </n-alert>
        
        <n-form-item label="前缀人格列表">
          <n-dynamic-input
            v-model:value="config.trigger.prefixPersonas"
            :on-create="() => ({ prefix: '', preset: '' })"
          >
            <template #default="{ value }">
              <n-space>
                <n-input v-model:value="value.prefix" placeholder="触发前缀，如: 猫娘" style="width: 120px;" />
                <n-input v-model:value="value.preset" placeholder="人格提示词" style="width: 300px;" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" />
              </n-space>
            </template>
          </n-dynamic-input>
        </n-form-item>
        
        <!-- 其他 -->
        <n-divider title-placement="left">其他</n-divider>
        
        <n-form-item label="采集群消息">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.trigger.collectGroupMsg" />
            </template>
            用于记忆和上下文分析
          </n-tooltip>
        </n-form-item>
        
        <!-- 访问控制 -->
        <n-divider title-placement="left">访问控制</n-divider>
        
        <n-grid :cols="2" :x-gap="24" responsive="screen" :collapsed-cols="1">
          <n-grid-item>
            <n-form-item label="群白名单">
              <n-dynamic-tags v-model:value="config.trigger.whitelistGroups" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="群黑名单">
              <n-dynamic-tags v-model:value="config.trigger.blacklistGroups" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="用户白名单">
              <n-dynamic-tags v-model:value="config.trigger.whitelistUsers" />
            </n-form-item>
          </n-grid-item>
          <n-grid-item>
            <n-form-item label="用户黑名单">
              <n-dynamic-tags v-model:value="config.trigger.blacklistUsers" />
            </n-form-item>
          </n-grid-item>
        </n-grid>
      </n-form>
    </n-card>
    
    <!-- 基础配置 -->
    <n-card title="基础配置">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="命令前缀">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input v-model:value="config.basic.commandPrefix" placeholder="#ai" />
            </template>
            管理命令的前缀，如 #ai帮助、#ai状态 等
          </n-tooltip>
        </n-form-item>
        <n-form-item label="思考提示">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.basic.showThinkingMessage" />
            </template>
            开启后，AI处理时会先发送"思考中..."提示
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
        <n-form-item label="调试模式">
          <n-switch v-model:value="config.basic.debug" />
        </n-form-item>
        <n-form-item label="调试仅控制台" v-if="config.basic.debug">
          <n-switch v-model:value="config.basic.debugToConsoleOnly" />
        </n-form-item>
        
        <n-divider title-placement="left">自动撤回</n-divider>
        
        <n-form-item label="启用自动撤回">
          <n-switch v-model:value="config.basic.autoRecall.enabled" />
        </n-form-item>
        <n-form-item label="撤回延迟(秒)" v-if="config.basic.autoRecall.enabled">
          <n-input-number v-model:value="config.basic.autoRecall.delay" :min="5" :max="300" />
        </n-form-item>
        <n-form-item label="撤回错误消息" v-if="config.basic.autoRecall.enabled">
          <n-switch v-model:value="config.basic.autoRecall.recallError" />
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 管理配置 -->
    <n-card title="管理配置">
      <n-form label-placement="left" label-width="140">
        <n-form-item label="主人QQ">
          <n-input v-model:value="masterQQInput" placeholder="多个用逗号分隔，留空使用Yunzai配置" @blur="parseMasterQQ" />
        </n-form-item>
        <n-form-item label="登录链接私聊推送">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.admin.loginNotifyPrivate" />
            </template>
            开启后，群聊中触发管理面板命令时会私聊推送登录链接
          </n-tooltip>
        </n-form-item>
        <n-form-item label="敏感命令仅主人">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.admin.sensitiveCommandMasterOnly" />
            </template>
            开启后，敏感命令（如管理面板）仅限主人使用
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
        <n-form-item label="并行执行">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.tools.parallelExecution" />
            </template>
            开启后，多个无依赖的工具调用会并行执行，提升响应速度
          </n-tooltip>
        </n-form-item>
        <n-form-item label="发送中间回复">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.tools.sendIntermediateReply" />
            </template>
            开启后，工具调用前会先发送模型的文本回复（如"好的，我来帮你..."）
          </n-tooltip>
        </n-form-item>
      </n-form>
    </n-card>
    
    <!-- 人格上下文配置 -->
    <n-card title="人格上下文">
      <n-alert type="info" style="margin-bottom: 16px;">
        配置独立人格的上下文隔离行为。启用后，不同人格将拥有独立的对话历史。
      </n-alert>
      <n-form label-placement="left" label-width="140">
        <n-form-item label="独立上下文">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.personality.isolateContext.enabled" />
            </template>
            启用后，不同人格的对话历史相互独立，不共享上下文
          </n-tooltip>
        </n-form-item>
        <n-form-item label="切换时清除">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.personality.isolateContext.clearOnSwitch" :disabled="!config.personality.isolateContext.enabled" />
            </template>
            切换人格时是否清除原人格的上下文历史
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

        <n-divider title-placement="left">戳一戳响应</n-divider>
        <n-form-item label="启用">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.features.poke.enabled" />
            </template>
            开启后，被戳时会使用AI人设回复
          </n-tooltip>
        </n-form-item>
        <n-form-item label="自动回戳">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.features.poke.pokeBack" :disabled="!config.features.poke.enabled" />
            </template>
            回复后自动戳回去
          </n-tooltip>
        </n-form-item>
        <n-form-item label="备用回复">
          <n-input v-model:value="config.features.poke.message" placeholder="AI回复失败时的备用回复" :disabled="!config.features.poke.enabled" />
        </n-form-item>

        <n-divider title-placement="left">表情回应</n-divider>
        <n-form-item label="启用">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.features.reaction.enabled" />
            </template>
            开启后，收到表情回应时会使用AI人设处理（需适配器支持）
          </n-tooltip>
        </n-form-item>

        <n-divider title-placement="left">AI 图片生成</n-divider>
        <n-form-item label="启用">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-switch v-model:value="config.features.imageGen.enabled" />
            </template>
            开启后可使用 #文生图、#图生图、#手办化 等命令
          </n-tooltip>
        </n-form-item>
        <n-form-item label="API地址">
          <n-input v-model:value="config.features.imageGen.apiUrl" placeholder="图片生成API地址" :disabled="!config.features.imageGen.enabled" />
        </n-form-item>
        <n-form-item label="API密钥">
          <n-input v-model:value="config.features.imageGen.apiKey" type="password" show-password-on="click" placeholder="API密钥" :disabled="!config.features.imageGen.enabled" />
        </n-form-item>
        <n-form-item label="模型名称">
          <n-input v-model:value="config.features.imageGen.model" placeholder="gemini-3-pro-image" :disabled="!config.features.imageGen.enabled" />
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
      <div>• <strong>#文生图 描述</strong> - 文字生成图片</div>
      <div>• <strong>#图生图 描述</strong> - 图片转换处理 (需引用/发送图片)</div>
      <div>• <strong>#手办化 / #Q版 / #动漫化</strong> - 预设效果 (需图片)</div>
    </n-alert>

    <n-space justify="end" style="margin-top: 16px; position: sticky; bottom: 16px; background: var(--n-color); padding: 12px; border-radius: 8px; box-shadow: 0 -2px 8px rgba(0,0,0,0.1);">
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
