<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: 'javascript' },
  placeholder: { type: String, default: '' },
  rows: { type: Number, default: 10 },
  readonly: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

const textareaRef = ref(null)
const highlightRef = ref(null)

const code = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 语法高亮
const highlightedCode = computed(() => {
  if (!props.modelValue) return ''
  
  let html = escapeHtml(props.modelValue)
  
  if (props.language === 'javascript' || props.language === 'js') {
    html = highlightJS(html)
  } else if (props.language === 'json') {
    html = highlightJSON(html)
  }
  
  // 确保最后有换行，保持高度一致
  return html + '\n'
})

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// JavaScript 语法高亮
function highlightJS(code) {
  // 关键字
  const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|typeof|instanceof|class|extends|async|await|import|export|default|from|of|in)\b/g
  
  // 内置对象
  const builtins = /\b(console|Math|JSON|Date|Array|Object|String|Number|Boolean|Promise|Error|runtime|args|ctx|fetch|Bot|logger|config|Redis)\b/g
  
  // 字符串 (简化版)
  const strings = /(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g
  
  // 注释
  const comments = /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm
  
  // 数字
  const numbers = /\b(\d+\.?\d*)\b/g
  
  // 布尔和 null
  const boolNull = /\b(true|false|null|undefined)\b/g
  
  return code
    .replace(comments, '<span class="hl-comment">$1</span>')
    .replace(strings, '<span class="hl-string">$&</span>')
    .replace(keywords, '<span class="hl-keyword">$1</span>')
    .replace(builtins, '<span class="hl-builtin">$1</span>')
    .replace(boolNull, '<span class="hl-bool">$1</span>')
    .replace(numbers, '<span class="hl-number">$1</span>')
}

// JSON 语法高亮
function highlightJSON(code) {
  return code.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'hl-number'
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'hl-key'
        } else {
          cls = 'hl-string'
        }
      } else if (/true|false/.test(match)) {
        cls = 'hl-bool'
      } else if (/null/.test(match)) {
        cls = 'hl-null'
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
}

// 同步滚动
function syncScroll() {
  if (highlightRef.value && textareaRef.value) {
    highlightRef.value.scrollTop = textareaRef.value.scrollTop
    highlightRef.value.scrollLeft = textareaRef.value.scrollLeft
  }
}

// 处理 Tab 键
function handleKeydown(e) {
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = e.target.selectionStart
    const end = e.target.selectionEnd
    const value = e.target.value
    
    // 插入两个空格
    e.target.value = value.substring(0, start) + '  ' + value.substring(end)
    e.target.selectionStart = e.target.selectionEnd = start + 2
    
    code.value = e.target.value
  }
}
</script>

<template>
  <div class="code-editor">
    <pre 
      ref="highlightRef" 
      class="highlight-layer" 
      v-html="highlightedCode"
      aria-hidden="true"
    ></pre>
    <textarea
      ref="textareaRef"
      v-model="code"
      class="input-layer"
      :placeholder="placeholder"
      :rows="rows"
      :readonly="readonly"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      @scroll="syncScroll"
      @keydown="handleKeydown"
    ></textarea>
  </div>
</template>

<style scoped>
.code-editor {
  position: relative;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #1e1e1e;
  overflow: hidden;
}

.highlight-layer,
.input-layer {
  margin: 0;
  padding: 12px;
  border: none;
  font: inherit;
  line-height: inherit;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
}

.highlight-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  color: #d4d4d4;
  background: transparent;
  z-index: 1;
}

.input-layer {
  position: relative;
  width: 100%;
  min-height: 200px;
  resize: vertical;
  color: transparent;
  caret-color: #fff;
  background: transparent;
  outline: none;
  z-index: 2;
}

.input-layer::placeholder {
  color: #666;
}

/* 语法高亮颜色 - VS Code Dark+ 风格 */
.highlight-layer :deep(.hl-keyword) {
  color: #569cd6;
}
.highlight-layer :deep(.hl-builtin) {
  color: #4ec9b0;
}
.highlight-layer :deep(.hl-string) {
  color: #ce9178;
}
.highlight-layer :deep(.hl-comment) {
  color: #6a9955;
  font-style: italic;
}
.highlight-layer :deep(.hl-number) {
  color: #b5cea8;
}
.highlight-layer :deep(.hl-bool),
.highlight-layer :deep(.hl-null) {
  color: #569cd6;
}
.highlight-layer :deep(.hl-key) {
  color: #9cdcfe;
}
</style>
