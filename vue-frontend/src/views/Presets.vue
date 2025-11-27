<script setup>
import { ref, onMounted, h } from 'vue'
import { NSpace, NCard, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NInputNumber, useMessage, NPopconfirm, NSelect } from 'naive-ui'
import axios from 'axios'

const message = useMessage()
const presets = ref([])
const channels = ref([])
const modelOptions = ref([])
const showModal = ref(false)
const isEdit = ref(false)
const currentId = ref('')
const formRef = ref(null)

const formValue = ref({
  name: '',
  description: '',
  systemPrompt: '',
  model: '',
  temperature: 0.7
})

const rules = {
  name: { required: true, message: '请输入名称', trigger: 'blur' },
  systemPrompt: { required: true, message: '请输入系统提示词', trigger: 'blur' }
}

const columns = [
  { title: '名称', key: 'name' },
  { title: '描述', key: 'description' },
  { title: '模型', key: 'model' },
  { 
    title: '操作', 
    key: 'actions',
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, {
            size: 'small',
            onClick: () => editPreset(row)
          }, { default: () => '编辑' }),
          h(NPopconfirm, {
            onPositiveClick: () => deletePreset(row.id)
          }, {
            trigger: () => h(NButton, { size: 'small', type: 'error', disabled: row.id === 'default' }, { default: () => '删除' }),
            default: () => '确定删除该预设吗？'
          })
        ]
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
  formValue.value = {
    name: '',
    description: '',
    systemPrompt: '',
    model: '',
    temperature: 0.7
  }
  showModal.value = true
}

function editPreset(row) {
  isEdit.value = true
  currentId.value = row.id
  formValue.value = { ...row }
  showModal.value = true
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
})
</script>

<template>
  <n-space vertical>
    <n-card title="预设管理">
      <template #header-extra>
        <n-button type="primary" @click="addPreset">添加预设</n-button>
      </template>
      <n-data-table :columns="columns" :data="presets" />
    </n-card>

    <n-modal v-model:show="showModal" preset="card" title="预设配置" style="width: 600px">
      <n-form ref="formRef" :model="formValue" :rules="rules" label-placement="left" label-width="100">
        <n-form-item label="名称" path="name">
          <n-input v-model:value="formValue.name" placeholder="请输入名称" />
        </n-form-item>
        <n-form-item label="描述" path="description">
          <n-input v-model:value="formValue.description" placeholder="请输入描述" />
        </n-form-item>
        <n-form-item label="系统提示词" path="systemPrompt">
          <n-input v-model:value="formValue.systemPrompt" type="textarea" placeholder="请输入系统提示词" :rows="5" />
        </n-form-item>
        <n-form-item label="模型" path="model">
          <n-select v-model:value="formValue.model" :options="modelOptions" placeholder="留空使用默认模型" filterable tag />
        </n-form-item>
        <n-form-item label="温度" path="temperature">
          <n-input-number v-model:value="formValue.temperature" :min="0" :max="2" :step="0.1" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSubmit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </n-space>
</template>
