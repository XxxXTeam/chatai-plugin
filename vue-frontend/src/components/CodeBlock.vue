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
  const normalizedLang = lang?.toLowerCase() || 'text'
  
  // 预处理：将转义的换行符转换为实际换行
  if (typeof code === 'string') {
    code = code.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
  }
  
  switch (normalizedLang) {
    case 'json':
      try {
        const obj = typeof code === 'string' ? JSON.parse(code) : code
        // 处理JSON中的换行符
        const jsonStr = JSON.stringify(obj, (key, value) => {
          if (typeof value === 'string') {
            return value.replace(/\\n/g, '\n')
          }
          return value
        }, 2)
        return highlightJson(jsonStr)
      } catch {
        return escapeHtml(code)
      }
    
    case 'javascript':
    case 'js':
    case 'ts':
    case 'typescript':
      return highlightJavaScript(code)
    
    case 'python':
    case 'py':
      return highlightPython(code)
    
    case 'yaml':
    case 'yml':
      return highlightYaml(code)
    
    case 'bash':
    case 'shell':
    case 'sh':
      return highlightBash(code)
    
    case 'css':
      return highlightCss(code)
    
    case 'html':
    case 'xml':
      return highlightHtml(code)
    
    case 'sql':
      return highlightSql(code)
    
    default:
      return escapeHtml(code)
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// JSON 语法高亮
function highlightJson(json) {
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

// JavaScript/TypeScript 语法高亮
function highlightJavaScript(code) {
  let result = escapeHtml(code)
  
  // 关键字
  const keywords = ['const', 'let', 'var', 'function', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'static', 'get', 'set']
  keywords.forEach(kw => {
    result = result.replace(new RegExp(`\\b${kw}\\b`, 'g'), `<span class="hl-keyword">${kw}</span>`)
  })
  
  // 字符串
  result = result.replace(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="hl-string">$&</span>')
  
  // 注释
  result = result.replace(/\/\/.*$/gm, '<span class="hl-comment">$&</span>')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '<span class="hl-comment">$&</span>')
  
  // 数字
  result = result.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>')
  
  return result
}

// Python 语法高亮
function highlightPython(code) {
  let result = escapeHtml(code)
  
  const keywords = ['def', 'class', 'import', 'from', 'as', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'yield', 'lambda', 'pass', 'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None', 'async', 'await', 'global', 'nonlocal', 'raise', 'assert']
  keywords.forEach(kw => {
    result = result.replace(new RegExp(`\\b${kw}\\b`, 'g'), `<span class="hl-keyword">${kw}</span>`)
  })
  
  result = result.replace(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="hl-string">$&</span>')
  result = result.replace(/#.*$/gm, '<span class="hl-comment">$&</span>')
  result = result.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>')
  
  return result
}

// YAML 语法高亮
function highlightYaml(code) {
  let result = escapeHtml(code)
  
  // Key
  result = result.replace(/^(\s*)([\w-]+):/gm, '$1<span class="hl-key">$2</span>:')
  // 布尔值
  result = result.replace(/:\s*(true|false)\b/gi, ': <span class="hl-boolean">$1</span>')
  // 数字
  result = result.replace(/:\s*(\d+(\.\d+)?)\b/g, ': <span class="hl-number">$1</span>')
  // 字符串
  result = result.replace(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="hl-string">$&</span>')
  // 注释
  result = result.replace(/#.*$/gm, '<span class="hl-comment">$&</span>')
  
  return result
}

// Bash 语法高亮
function highlightBash(code) {
  let result = escapeHtml(code)
  
  const commands = ['echo', 'cd', 'ls', 'cat', 'grep', 'sed', 'awk', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'npm', 'yarn', 'git', 'docker', 'curl', 'wget', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'rsync', 'systemctl', 'service', 'kill', 'ps', 'top', 'df', 'du', 'find', 'head', 'tail', 'sort', 'uniq', 'wc', 'xargs', 'source', 'export', 'alias']
  commands.forEach(cmd => {
    result = result.replace(new RegExp(`^(\\s*)${cmd}\\b`, 'gm'), `$1<span class="hl-keyword">${cmd}</span>`)
  })
  
  result = result.replace(/\$[\w{}]+/g, '<span class="hl-variable">$&</span>')
  result = result.replace(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="hl-string">$&</span>')
  result = result.replace(/#.*$/gm, '<span class="hl-comment">$&</span>')
  
  return result
}

// CSS 语法高亮
function highlightCss(code) {
  let result = escapeHtml(code)
  
  // 选择器
  result = result.replace(/([.#]?[\w-]+)\s*{/g, '<span class="hl-selector">$1</span> {')
  // 属性
  result = result.replace(/([\w-]+)\s*:/g, '<span class="hl-property">$1</span>:')
  // 值
  result = result.replace(/:\s*([^;{}]+)/g, ': <span class="hl-value">$1</span>')
  // 注释
  result = result.replace(/\/\*[\s\S]*?\*\//g, '<span class="hl-comment">$&</span>')
  
  return result
}

// HTML/XML 语法高亮
function highlightHtml(code) {
  let result = escapeHtml(code)
  
  // 标签
  result = result.replace(/&lt;(\/?[\w-]+)/g, '&lt;<span class="hl-tag">$1</span>')
  // 属性
  result = result.replace(/([\w-]+)=/g, '<span class="hl-attr">$1</span>=')
  // 属性值
  result = result.replace(/="([^"]*)"/g, '="<span class="hl-string">$1</span>"')
  // 注释
  result = result.replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="hl-comment">$&</span>')
  
  return result
}

// SQL 语法高亮
function highlightSql(code) {
  let result = escapeHtml(code)
  
  const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'INDEX', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'DEFAULT', 'CHECK', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END']
  keywords.forEach(kw => {
    result = result.replace(new RegExp(`\\b${kw}\\b`, 'gi'), `<span class="hl-keyword">${kw}</span>`)
  })
  
  result = result.replace(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g, '<span class="hl-string">$&</span>')
  result = result.replace(/--.*$/gm, '<span class="hl-comment">$&</span>')
  result = result.replace(/\b\d+(\.\d+)?\b/g, '<span class="hl-number">$&</span>')
  
  return result
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
.code-content :deep(.hl-keyword) {
  color: #c586c0;
  font-weight: 500;
}
.code-content :deep(.hl-comment) {
  color: #6a9955;
  font-style: italic;
}
.code-content :deep(.hl-variable) {
  color: #9cdcfe;
}
.code-content :deep(.hl-function) {
  color: #dcdcaa;
}
.code-content :deep(.hl-class) {
  color: #4ec9b0;
}
.code-content :deep(.hl-tag) {
  color: #569cd6;
}
.code-content :deep(.hl-attr) {
  color: #9cdcfe;
}
.code-content :deep(.hl-selector) {
  color: #d7ba7d;
}
.code-content :deep(.hl-property) {
  color: #9cdcfe;
}
.code-content :deep(.hl-value) {
  color: #ce9178;
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
