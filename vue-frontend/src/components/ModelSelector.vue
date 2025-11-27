<script setup>
import { ref, computed, watch } from 'vue'
import { NSpace, NInput, NButton, NCollapse, NCollapseItem, NCheckbox, NCheckboxGroup, NTag, NText, NIcon, NDivider } from 'naive-ui'
import { SearchOutlined, CheckCircleOutlined } from '@vicons/material'

const props = defineProps({
  value: {
    type: Array,
    default: () => []
  },
  allModels: {
    type: Array,
    default: () => []
  },
  multiple: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:value'])

const searchQuery = ref('')
const selectedModels = ref([...props.value])

watch(() => props.value, (newVal) => {
  selectedModels.value = [...newVal]
})

watch(selectedModels, (newVal) => {
  emit('update:value', newVal)
})

// 模型分组计算属性
const groupedModels = computed(() => {
  const groups = {
    '零一万物': [],
    'OpenAI': [],
    'Claude': [],
    'Gemini': [],
    'DeepSeek': [],
    '智谱 (GLM)': [],
    'Qwen (通义千问)': [],
    'Doubao (豆包)': [],
    'Mistral AI': [],
    'Llama': [],
    'Grok': [],
    'Kimi (Moonshot)': [],
    'MiniMax': [],
    'Cohere': [],
    '其他': []
  }
  
  // 搜索过滤
  const searchLower = searchQuery.value.toLowerCase()
  const filteredModels = props.allModels.filter(model => 
    model.toLowerCase().includes(searchLower)
  )
  
  filteredModels.forEach(model => {
    const lower = model.toLowerCase()
    if (lower.includes('yi-') || lower.includes('零一')) {
      groups['零一万物'].push(model)
    } else if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('davinci')) {
      groups['OpenAI'].push(model)
    } else if (lower.includes('claude')) {
      groups['Claude'].push(model)
    } else if (lower.includes('gemini') || lower.includes('gemma')) {
      groups['Gemini'].push(model)
    } else if (lower.includes('deepseek')) {
      groups['DeepSeek'].push(model)
    } else if (lower.includes('glm') || lower.includes('智谱')) {
      groups['智谱 (GLM)'].push(model)
    } else if (lower.includes('qwen') || lower.includes('qwq')) {
      groups['Qwen (通义千问)'].push(model)
    } else if (lower.includes('doubao') || lower.includes('豆包')) {
      groups['Doubao (豆包)'].push(model)
    } else if (lower.includes('mistral')) {
      groups['Mistral AI'].push(model)
    } else if (lower.includes('llama')) {
      groups['Llama'].push(model)
    } else if (lower.includes('grok')) {
      groups['Grok'].push(model)
    } else if (lower.includes('kimi') || lower.includes('moonshot')) {
      groups['Kimi (Moonshot)'].push(model)
    } else if (lower.includes('minimax') || lower.includes('abab')) {
      groups['MiniMax'].push(model)
    } else if (lower.includes('cohere') || lower.includes('command')) {
      groups['Cohere'].push(model)
    } else {
      groups['其他'].push(model)
    }
  })
  
  // 移除空分组
  return Object.entries(groups)
    .filter(([_, models]) => models.length > 0)
    .map(([name, models]) => ({ name, models }))
})

// 全选所有模型
function selectAll() {
  selectedModels.value = [...props.allModels]
}

// 取消所有选择
function deselectAll() {
  selectedModels.value = []
}

// 全选某个分组
function selectAllInGroup(group) {
  group.models.forEach(model => {
    if (!selectedModels.value.includes(model)) {
      selectedModels.value.push(model)
    }
  })
}

// 取消选择某个分组
function deselectAllInGroup(group) {
  selectedModels.value = selectedModels.value.filter(m => !group.models.includes(m))
}

// 检查分组是否全选
function isGroupFullySelected(group) {
  return group.models.every(model => selectedModels.value.includes(model))
}

// 检查分组是否部分选中
function isGroupPartiallySelected(group) {
  const selectedCount = group.models.filter(model => selectedModels.value.includes(model)).length
  return selectedCount > 0 && selectedCount < group.models.length
}

// 单选处理
function handleSingleSelect(model) {
    if (!props.multiple) {
        selectedModels.value = [model]
    }
}
</script>

<template>
  <n-space vertical :size="16">
    <!-- 顶部统计和搜索 -->
    <n-space justify="space-between" align="center">
      <n-space :size="8">
        <n-tag type="success" :bordered="false" size="medium">
          <template #icon>
            <n-icon>
              <CheckCircleOutlined />
            </n-icon>
          </template>
          已选择 ({{ selectedModels.length }})
        </n-tag>
      </n-space>
    </n-space>

    <!-- 搜索框 -->
    <n-input
      v-model:value="searchQuery"
      placeholder="搜索模型"
      clearable
      size="large"
    >
      <template #prefix>
        <n-icon>
          <SearchOutlined />
        </n-icon>
      </template>
    </n-input>

    <!-- 全局操作按钮 (仅多选时显示) -->
    <n-space justify="space-between" align="center" v-if="multiple">
      <n-text depth="3">
        已选择 {{ selectedModels.length }} / {{ allModels.length }}
      </n-text>
      <n-space :size="8">
        <n-button size="small" @click="selectAll">全选</n-button>
        <n-button size="small" @click="deselectAll">取消全选</n-button>
      </n-space>
    </n-space>

    <n-divider style="margin: 0" />

    <!-- 模型分组列表 -->
    <div style="max-height: 50vh; overflow-y: auto; padding-right: 4px;">
      <n-collapse arrow-placement="right" :default-expanded-names="groupedModels.map(g => g.name)">
        <n-collapse-item 
          v-for="group in groupedModels" 
          :key="group.name"
          :name="group.name"
        >
          <template #header>
            <n-space align="center" :size="12">
              <n-checkbox
                v-if="multiple"
                :checked="isGroupFullySelected(group)"
                :indeterminate="isGroupPartiallySelected(group)"
                @update:checked="(checked) => checked ? selectAllInGroup(group) : deselectAllInGroup(group)"
                @click.stop
              />
              <n-text strong>{{ group.name }}</n-text>
              <n-tag 
                :type="isGroupFullySelected(group) ? 'success' : 'default'" 
                size="small" 
                :bordered="false"
                round
              >
                {{ group.models.filter(m => selectedModels.includes(m)).length }} / {{ group.models.length }}
              </n-tag>
            </n-space>
          </template>
          
          <n-checkbox-group v-model:value="selectedModels">
            <n-space vertical :size="8" style="padding-left: 32px;">
              <n-checkbox 
                v-for="model in group.models" 
                :key="model" 
                :value="model"
                :label="model"
                @update:checked="() => handleSingleSelect(model)"
              />
            </n-space>
          </n-checkbox-group>
        </n-collapse-item>
      </n-collapse>
    </div>
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
