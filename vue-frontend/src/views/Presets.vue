<script setup>
import { ref, onMounted, h, computed } from 'vue'
import { NSpace, NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NInputNumber, useMessage, NPopconfirm, NSelect, NSwitch, NTabs, NTabPane, NDynamicTags, NCode, NTag } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const presets = ref([])
const channels = ref([])
const modelOptions = ref([])
const showModal = ref(false)
const isEdit = ref(false)
const currentId = ref('')
const formRef = ref(null)
const builtPrompt = ref('')
const showPromptPreview = ref(false)
const showTemplateModal = ref(false)
const presetsConfig = ref({
  defaultId: 'default',
  allowUserSwitch: true,
  perUserPreset: false,
  perGroupPreset: false
})

// 预设模板库
const presetTemplates = [
  {
    id: 'assistant',
    name: '通用助手',
    description: '友好专业的AI助手',
    systemPrompt: '你是一个有帮助的AI助手，请用简洁清晰的语言回答用户的问题。',
    persona: { name: 'AI助手', personality: '友好、专业、乐于助人', speakingStyle: '礼貌、简洁' }
  },
  {
    id: 'catgirl',
    name: '猫娘',
    description: '可爱的猫娘角色',
    systemPrompt: '你是一只可爱的猫娘，说话时会加上"喵~"，性格活泼可爱。',
    persona: { name: '小喵', personality: '活泼、可爱、傲娇', speakingStyle: '卖萌、撒娇', traits: ['猫耳', '傲娇', '贪吃'] }
  },
  {
    id: 'coder',
    name: '编程助手',
    description: '专业的编程开发助手',
    systemPrompt: '你是一个专业的编程助手，擅长多种编程语言和框架。请提供清晰的代码示例和解释。',
    persona: { name: '代码助手', personality: '严谨、专业、耐心', speakingStyle: '技术性、条理清晰' }
  },
  {
    id: 'translator',
    name: '翻译助手',
    description: '多语言翻译专家',
    systemPrompt: '你是一个专业的翻译助手，精通中英日韩等多种语言。请提供准确流畅的翻译。',
    persona: { name: '翻译官', personality: '专业、细致', speakingStyle: '准确、地道' }
  },
  {
    id: 'writer',
    name: '写作助手',
    description: '创意写作和文案助手',
    systemPrompt: '你是一个创意写作助手，擅长各类文体写作，包括小说、诗歌、文案等。',
    persona: { name: '文思', personality: '富有创意、文采斐然', speakingStyle: '优美、富有感染力' }
  },
  {
    id: 'roleplay',
    name: '角色扮演',
    description: '沉浸式角色扮演',
    systemPrompt: '你将扮演用户指定的角色，保持角色一致性，进行沉浸式对话。不要打破角色设定。',
    persona: { name: '', personality: '根据角色设定', speakingStyle: '符合角色特点' }
  },
  {
    id: 'tutor',
    name: '学习导师',
    description: '耐心的学习辅导老师',
    systemPrompt: '你是一个耐心的学习导师，擅长用通俗易懂的方式解释复杂概念，引导学生思考。',
    persona: { name: '导师', personality: '耐心、博学、善于引导', speakingStyle: '循循善诱、深入浅出' }
  },
  {
    id: 'emotional',
    name: '情感陪伴',
    description: '温暖的情感支持伙伴',
    systemPrompt: '你是一个温暖的倾听者和陪伴者，善于理解和安慰他人，提供情感支持。',
    persona: { name: '暖心', personality: '温柔、善解人意、有同理心', speakingStyle: '温暖、治愈' }
  }
]

// 使用模板
function useTemplate(template) {
  formValue.value = {
    ...defaultFormValue(),
    name: template.name,
    description: template.description,
    systemPrompt: template.systemPrompt,
    persona: { ...defaultFormValue().persona, ...template.persona }
  }
  showTemplateModal.value = false
  isEdit.value = false
  currentId.value = ''
  showModal.value = true
}

const defaultFormValue = () => ({
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  temperature: 0.7,
  persona: {
    name: '',
    personality: '',
    background: '',
    speakingStyle: '',
    traits: [],
    likes: [],
    dislikes: [],
    customFields: {}
  },
  context: {
    maxMessages: 20,
    maxTokens: 8000,
    includeGroupContext: false,
    groupContextLength: 10
  },
  tools: {
    enableBuiltinTools: true,
    allowedTools: [],
    disabledTools: []
  }
})

const formValue = ref(defaultFormValue())

const rules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' }
}

const presetOptions = computed(() => {
  return presets.value.map(p => ({ label: p.name, value: p.id }))
})

const columns = [
  { title: '名称', key: 'name', width: 120 },
  { title: '描述', key: 'description', ellipsis: { tooltip: true } },
  { 
    title: '人设', 
    key: 'persona',
    width: 100,
    render(row) {
      return row.persona?.name ? h(NTag, { type: 'info', size: 'small' }, { default: () => row.persona.name }) : '-'
    }
  },
  { title: '模型', key: 'model', width: 150, ellipsis: { tooltip: true } },
  { 
    title: '默认', 
    key: 'isDefault',
    width: 60,
    render(row) {
      return presetsConfig.value.defaultId === row.id ? h(NTag, { type: 'success', size: 'small' }, { default: () => '是' }) : ''
    }
  },
  { 
    title: '操作', 
    key: 'actions',
    width: 220,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, {
            size: 'small',
            onClick: () => editPreset(row)
          }, { default: () => '编辑' }),
          h(NButton, {
            size: 'small',
            type: 'info',
            onClick: () => previewPrompt(row.id)
          }, { default: () => '预览' }),
          row.id !== presetsConfig.value.defaultId ? h(NButton, {
            size: 'small',
            onClick: () => setDefault(row.id)
          }, { default: () => '设为默认' }) : null,
          h(NPopconfirm, {
            onPositiveClick: () => deletePreset(row.id)
          }, {
            trigger: () => h(NButton, { size: 'small', type: 'error', disabled: row.id === 'default' }, { default: () => '删除' }),
            default: () => '确定删除该预设吗？'
          })
        ].filter(Boolean)
      })
    }
  }
]

async function fetchPresets() {
  try {
    const res = await axios.get('/api/preset/list')
    if (res.data.code === 0) {
      presets.value = res.data.data
    }
  } catch (err) {
    message.error('获取预设列表失败')
  }
}

async function fetchChannels() {
  try {
    const res = await axios.get('/api/channels/list')
    if (res.data.code === 0) {
      channels.value = res.data.data
      // Flatten models from all channels
      const models = new Set()
      channels.value.forEach(channel => {
        if (channel.models && Array.isArray(channel.models)) {
          channel.models.forEach(m => models.add(m))
        }
      })
      
      modelOptions.value = Array.from(models).map(m => ({ label: m, value: m }))
      // Add default option
      modelOptions.value.unshift({ label: '使用默认模型', value: '' })
    }
  } catch (err) {
    console.error('Failed to fetch channels', err)
  }
}

function addPreset() {
  isEdit.value = false
  currentId.value = ''
  formValue.value = defaultFormValue()
  showModal.value = true
}

function editPreset(row) {
  isEdit.value = true
  currentId.value = row.id
  const defaults = defaultFormValue()
  formValue.value = {
    ...defaults,
    ...row,
    persona: { ...defaults.persona, ...row.persona },
    context: { ...defaults.context, ...row.context },
    tools: { ...defaults.tools, ...row.tools }
  }
  showModal.value = true
}

async function previewPrompt(id) {
  try {
    const res = await axios.get(`/api/preset/${id}/prompt`)
    if (res.data.code === 0) {
      builtPrompt.value = res.data.data.prompt
      showPromptPreview.value = true
    }
  } catch (err) {
    message.error('获取预览失败')
  }
}

async function setDefault(id) {
  try {
    const res = await axios.put('/api/presets/config', { defaultId: id })
    if (res.data.code === 0) {
      presetsConfig.value.defaultId = id
      message.success('已设为默认预设')
    }
  } catch (err) {
    message.error('设置失败')
  }
}

async function fetchPresetsConfig() {
  try {
    const res = await axios.get('/api/presets/config')
    if (res.data.code === 0) {
      presetsConfig.value = res.data.data
    }
  } catch (err) {
    console.error('Failed to fetch presets config', err)
  }
}

async function savePresetsConfig() {
  try {
    const res = await axios.put('/api/presets/config', presetsConfig.value)
    if (res.data.code === 0) {
      message.success('配置已保存')
    }
  } catch (err) {
    message.error('保存失败')
  }
}

async function deletePreset(id) {
  try {
    const res = await axios.delete(`/api/preset/${id}`)
    if (res.data.code === 0) {
      message.success('删除成功')
      fetchPresets()
    } else {
      message.error(res.data.message)
    }
  } catch (err) {
    message.error('删除失败')
  }
}

// 导出所有预设
function exportPresets() {
  const data = JSON.stringify(presets.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `presets_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.success('导出成功')
}

// 导入预设
function importPresets() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      
      if (!Array.isArray(data)) {
        message.error('无效的预设文件格式')
        return
      }
      
      // 逐个导入
      let imported = 0
      for (const preset of data) {
        try {
          // 检查是否已存在
          const existing = presets.value.find(p => p.id === preset.id)
          if (existing) {
            await axios.put(`/api/preset/${preset.id}`, preset)
          } else {
            await axios.post('/api/preset/', preset)
          }
          imported++
        } catch (err) {
          console.error('导入预设失败:', preset.name, err)
        }
      }
      
      message.success(`成功导入 ${imported} 个预设`)
      fetchPresets()
    } catch (err) {
      message.error('导入失败: ' + err.message)
    }
  }
  input.click()
}

async function handleSubmit() {
  formRef.value?.validate(async (errors) => {
    if (!errors) {
      try {
        let res
        if (isEdit.value) {
          res = await axios.put(`/api/preset/${currentId.value}`, formValue.value)
        } else {
          res = await axios.post('/api/preset/', formValue.value)
        }
        
        if (res.data.code === 0) {
          message.success('保存成功')
          showModal.value = false
          fetchPresets()
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
  fetchPresets()
  fetchChannels()
  fetchPresetsConfig()
})
</script>

<template>
  <n-space vertical>
    <!-- 预设配置 -->
    <n-card title="预设配置" size="small">
      <n-space>
        <n-form-item label="默认预设" label-placement="left">
          <n-select v-model:value="presetsConfig.defaultId" :options="presetOptions" style="width: 200px" @update:value="savePresetsConfig" />
        </n-form-item>
        <n-form-item label="允许用户切换" label-placement="left">
          <n-switch v-model:value="presetsConfig.allowUserSwitch" @update:value="savePresetsConfig" />
        </n-form-item>
      </n-space>
    </n-card>

    <!-- 预设列表 -->
    <n-card title="预设管理">
      <template #header-extra>
        <n-space>
          <n-button @click="showTemplateModal = true">模板库</n-button>
          <n-button @click="importPresets">导入</n-button>
          <n-button @click="exportPresets">导出</n-button>
          <n-button type="primary" @click="addPreset">添加预设</n-button>
        </n-space>
      </template>
      <n-data-table :columns="columns" :data="presets" :pagination="{ pageSize: 10 }" />
    </n-card>

    <!-- 编辑预设 Modal -->
    <n-modal v-model:show="showModal" preset="card" :title="isEdit ? '编辑预设' : '添加预设'" style="width: 800px; max-height: 90vh;" :mask-closable="false">
      <n-form ref="formRef" :model="formValue" :rules="rules" label-placement="left" label-width="100">
        <n-tabs type="line">
          <!-- 基础设置 -->
          <n-tab-pane name="basic" tab="基础设置">
            <n-form-item label="名称" path="name">
              <n-input v-model:value="formValue.name" placeholder="请输入名称" />
            </n-form-item>
            <n-form-item label="描述" path="description">
              <n-input v-model:value="formValue.description" placeholder="请输入描述" />
            </n-form-item>
            <n-form-item label="系统提示词">
              <n-input v-model:value="formValue.systemPrompt" type="textarea" placeholder="基础系统提示词，人设信息会自动附加" :rows="4" />
              <template #feedback>
                支持变量: {{user_name}}, {{user_id}}, {{group_name}}, {{group_id}}, {{bot_name}}, {{date}}, {{time}}, {{weekday}}
              </template>
            </n-form-item>
            <n-form-item label="模型">
              <n-select v-model:value="formValue.model" :options="modelOptions" placeholder="留空使用默认模型" filterable tag clearable />
            </n-form-item>
            <n-form-item label="温度">
              <n-input-number v-model:value="formValue.temperature" :min="0" :max="2" :step="0.1" style="width: 150px" />
            </n-form-item>
          </n-tab-pane>

          <!-- 人设配置 -->
          <n-tab-pane name="persona" tab="人设配置">
            <n-form-item label="角色名称">
              <n-input v-model:value="formValue.persona.name" placeholder="AI的名字" />
            </n-form-item>
            <n-form-item label="性格特点">
              <n-input v-model:value="formValue.persona.personality" placeholder="如：友好、幽默、专业" />
            </n-form-item>
            <n-form-item label="说话风格">
              <n-input v-model:value="formValue.persona.speakingStyle" placeholder="如：礼貌、简洁、活泼" />
            </n-form-item>
            <n-form-item label="背景故事">
              <n-input v-model:value="formValue.persona.background" type="textarea" placeholder="角色的背景故事" :rows="3" />
            </n-form-item>
            <n-form-item label="性格标签">
              <n-dynamic-tags v-model:value="formValue.persona.traits" />
            </n-form-item>
            <n-form-item label="喜好">
              <n-dynamic-tags v-model:value="formValue.persona.likes" />
            </n-form-item>
            <n-form-item label="厌恶">
              <n-dynamic-tags v-model:value="formValue.persona.dislikes" />
            </n-form-item>
          </n-tab-pane>

          <!-- 上下文配置 -->
          <n-tab-pane name="context" tab="上下文配置">
            <n-form-item label="最大消息数">
              <n-input-number v-model:value="formValue.context.maxMessages" :min="1" :max="100" style="width: 150px" />
            </n-form-item>
            <n-form-item label="最大Token数">
              <n-input-number v-model:value="formValue.context.maxTokens" :min="100" :max="128000" :step="100" style="width: 150px" />
            </n-form-item>
            <n-form-item label="包含群聊上下文">
              <n-switch v-model:value="formValue.context.includeGroupContext" />
            </n-form-item>
            <n-form-item label="群聊上下文长度" v-if="formValue.context.includeGroupContext">
              <n-input-number v-model:value="formValue.context.groupContextLength" :min="1" :max="50" style="width: 150px" />
            </n-form-item>
          </n-tab-pane>

          <!-- 工具配置 -->
          <n-tab-pane name="tools" tab="工具配置">
            <n-form-item label="启用内置工具">
              <n-switch v-model:value="formValue.tools.enableBuiltinTools" />
            </n-form-item>
            <n-form-item label="允许的工具" v-if="formValue.tools.enableBuiltinTools">
              <n-dynamic-tags v-model:value="formValue.tools.allowedTools" />
              <template #feedback>留空表示允许所有工具</template>
            </n-form-item>
            <n-form-item label="禁用的工具" v-if="formValue.tools.enableBuiltinTools">
              <n-dynamic-tags v-model:value="formValue.tools.disabledTools" />
            </n-form-item>
          </n-tab-pane>
        </n-tabs>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSubmit">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 预览系统提示词 Modal -->
    <n-modal v-model:show="showPromptPreview" preset="card" title="系统提示词预览" style="width: 700px">
      <n-code :code="builtPrompt" language="markdown" word-wrap />
    </n-modal>

    <!-- 模板库 Modal -->
    <n-modal v-model:show="showTemplateModal" preset="card" title="预设模板库" style="width: 700px">
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
        <n-card v-for="tpl in presetTemplates" :key="tpl.id" size="small" hoverable style="cursor: pointer" @click="useTemplate(tpl)">
          <template #header>
            <span style="font-weight: 600">{{ tpl.name }}</span>
          </template>
          <p style="color: #666; font-size: 13px; margin: 0">{{ tpl.description }}</p>
          <p style="color: #999; font-size: 12px; margin: 8px 0 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            {{ tpl.systemPrompt.substring(0, 50) }}...
          </p>
        </n-card>
      </div>
      <template #footer>
        <n-button @click="showTemplateModal = false">关闭</n-button>
      </template>
    </n-modal>
  </n-space>
</template>
