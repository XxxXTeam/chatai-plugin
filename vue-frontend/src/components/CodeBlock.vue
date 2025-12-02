<script setup>
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps({
  code: { type: String, default: '' },
  language: { type: String, default: 'json' },
  markdown: { type: Boolean, default: false },
  maxHeight: { type: String, default: '' }
})

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true
})

const renderedContent = computed(() => {
  if (!props.code) return ''
  
  if (props.markdown) {
    // Markdown 渲染
    const html = marked(props.code)
    return DOMPurify.sanitize(html)
  }
  
  // 代码格式化显示
  return formatCode(props.code, props.language)
})

function formatCode(code, lang) {
  if (lang === 'json') {
    try {
      const obj = typeof code === 'string' ? JSON.parse(code) : code
      return syntaxHighlight(JSON.stringify(obj, null, 2))
    } catch {
      return escapeHtml(code)
    }
  }
  return escapeHtml(code)
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// JSON 语法高亮
function syntaxHighlight(json) {
  return json.replace(
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
        cls = 'hl-boolean'
      } else if (/null/.test(match)) {
        cls = 'hl-null'
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
}

const containerStyle = computed(() => {
  const style = {}
  if (props.maxHeight) {
    style.maxHeight = props.maxHeight
    style.overflow = 'auto'
  }
  return style
})
</script>

<template>
  <div class="code-block" :style="containerStyle">
    <div v-if="markdown" class="markdown-body" v-html="renderedContent" />
    <pre v-else class="code-content"><code v-html="renderedContent" /></pre>
  </div>
</template>

<style scoped>
.code-block {
  border-radius: 6px;
  overflow: hidden;
}

.code-content {
  margin: 0;
  padding: 12px 16px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-all;
  overflow-x: auto;
}

/* JSON 语法高亮 */
.code-content :deep(.hl-key) {
  color: #9cdcfe;
}
.code-content :deep(.hl-string) {
  color: #ce9178;
}
.code-content :deep(.hl-number) {
  color: #b5cea8;
}
.code-content :deep(.hl-boolean) {
  color: #569cd6;
}
.code-content :deep(.hl-null) {
  color: #569cd6;
}

/* Markdown 样式 */
.markdown-body {
  padding: 12px 16px;
  background: #fafafa;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  color: #333;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body :deep(h1) { font-size: 1.5em; }
.markdown-body :deep(h2) { font-size: 1.3em; }
.markdown-body :deep(h3) { font-size: 1.1em; }

.markdown-body :deep(p) {
  margin: 8px 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 24px;
  margin: 8px 0;
}

.markdown-body :deep(li) {
  margin: 4px 0;
}

.markdown-body :deep(code) {
  background: #e8e8e8;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
}

.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

.markdown-body :deep(blockquote) {
  border-left: 4px solid #ddd;
  padding-left: 16px;
  margin: 12px 0;
  color: #666;
}

.markdown-body :deep(a) {
  color: #0969da;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid #ddd;
  padding: 8px 12px;
  text-align: left;
}

.markdown-body :deep(th) {
  background: #f0f0f0;
  font-weight: 600;
}

/* 暗色主题 */
@media (prefers-color-scheme: dark) {
  .markdown-body {
    background: #1e1e1e;
    color: #d4d4d4;
  }
  .markdown-body :deep(code) {
    background: #2d2d2d;
  }
  .markdown-body :deep(th) {
    background: #2d2d2d;
  }
  .markdown-body :deep(th),
  .markdown-body :deep(td) {
    border-color: #444;
  }
}
</style>
