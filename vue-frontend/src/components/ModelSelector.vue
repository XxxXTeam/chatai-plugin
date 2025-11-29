<script setup>
import { ref, computed, watch } from 'vue'
import { NSpace, NInput, NButton, NTag, NText, NIcon, NDivider, NEmpty } from 'naive-ui'
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
// 展开的分组名称
const expandedGroup = ref('')

// 选中数量 - 简单的 ref
const selectedCount = ref(props.value.length)

// 内部用普通 Set，不是响应式的
let selectedSet = new Set(props.value)

// 同步 props
watch(() => props.value, (newVal) => {
  selectedSet = new Set(newVal)
  selectedCount.value = newVal.length
}, { deep: false })

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

// 提交选择结果
function emitChange() {
  emit('update:value', Array.from(selectedSet))
}

// 全选所有模型
function selectAll() {
  selectedSet = new Set(props.allModels)
  selectedCount.value = selectedSet.size
  emitChange()
}

// 取消所有选择
function deselectAll() {
  selectedSet = new Set()
  selectedCount.value = 0
  emitChange()
}

// 全选某个分组
function selectAllInGroup(group, event) {
  event?.stopPropagation()
  for (const model of group.models) {
    selectedSet.add(model)
  }
  selectedCount.value = selectedSet.size
  emitChange()
  // 强制刷新当前分组
  if (expandedGroup.value === group.name) {
    expandedGroup.value = ''
    setTimeout(() => expandedGroup.value = group.name, 0)
  }
}

// 取消选择某个分组
function deselectAllInGroup(group, event) {
  event?.stopPropagation()
  for (const model of group.models) {
    selectedSet.delete(model)
  }
  selectedCount.value = selectedSet.size
  emitChange()
  // 强制刷新当前分组
  if (expandedGroup.value === group.name) {
    expandedGroup.value = ''
    setTimeout(() => expandedGroup.value = group.name, 0)
  }
}

// 切换分组展开 - 只能展开一个
function toggleGroup(groupName) {
  expandedGroup.value = expandedGroup.value === groupName ? '' : groupName
}

// 获取分组选中数量
function getGroupSelectedCount(group) {
  let count = 0
  for (const model of group.models) {
    if (selectedSet.has(model)) count++
  }
  return count
}

// 切换单个模型
function toggleModel(model, event) {
  if (selectedSet.has(model)) {
    selectedSet.delete(model)
  } else {
    selectedSet.add(model)
  }
  selectedCount.value = selectedSet.size
  emitChange()
}

// 检查模型是否选中
function isSelected(model) {
  return selectedSet.has(model)
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
          已选择 ({{ selectedCount }})
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
        已选择 {{ selectedCount }} / {{ allModels.length }}
      </n-text>
      <n-space :size="8">
        <n-button size="small" @click="selectAll">全选</n-button>
        <n-button size="small" @click="deselectAll">取消全选</n-button>
      </n-space>
    </n-space>

    <n-divider style="margin: 0" />

    <!-- 模型分组列表 -->
    <div class="model-list-container">
      <n-empty v-if="groupedModels.length === 0" description="没有找到模型" />
      
      <!-- 简化的分组列表 -->
      <div v-else class="group-list">
        <div 
          v-for="group in groupedModels" 
          :key="group.name"
          class="group-item"
        >
          <!-- 分组头部 -->
          <div class="group-header" @click="toggleGroup(group.name)">
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">
              {{ getGroupSelectedCount(group) }}/{{ group.models.length }}
            </span>
            <button 
              v-if="multiple" 
              class="group-btn"
              @click="getGroupSelectedCount(group) === group.models.length ? deselectAllInGroup(group, $event) : selectAllInGroup(group, $event)"
            >
              {{ getGroupSelectedCount(group) === group.models.length ? '取消' : '全选' }}
            </button>
            <span class="expand-icon">{{ expandedGroup === group.name ? '▲' : '▼' }}</span>
          </div>
          
          <!-- 展开的模型列表 -->
          <div v-if="expandedGroup === group.name" class="model-list">
            <label 
              v-for="model in group.models" 
              :key="model"
              class="model-item"
            >
              <input 
                type="checkbox" 
                :checked="isSelected(model)"
                @change="toggleModel(model, $event)"
              />
              <span class="model-name" :title="model">{{ model }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </n-space>
</template>

<style scoped>
.model-list-container {
  max-height: 55vh;
  overflow-y: auto;
  padding-right: 4px;
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-item {
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}

.group-header:hover {
  background: rgba(0, 0, 0, 0.03);
}

.group-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.group-name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}

.group-count {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e8e8e8;
  color: #666;
}

.group-btn {
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.group-btn:hover {
  background: #f5f5f5;
}

.expand-icon {
  font-size: 10px;
  color: #999;
}

.model-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 8px;
  padding: 4px 12px 8px 36px;
  background: #fff;
  max-height: 300px;
  overflow-y: auto;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.model-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

.model-item input[type="checkbox"] {
  width: 13px;
  height: 13px;
  cursor: pointer;
  flex-shrink: 0;
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 滚动条 */
.model-list-container::-webkit-scrollbar,
.model-list::-webkit-scrollbar {
  width: 5px;
}

.model-list-container::-webkit-scrollbar-track,
.model-list::-webkit-scrollbar-track {
  background: transparent;
}

.model-list-container::-webkit-scrollbar-thumb,
.model-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 3px;
}

.model-list-container::-webkit-scrollbar-thumb:hover,
.model-list::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}
</style>
