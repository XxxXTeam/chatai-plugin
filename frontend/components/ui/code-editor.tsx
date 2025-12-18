'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-json'
import 'prismjs/themes/prism-tomorrow.css'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: 'javascript' | 'json'
  placeholder?: string
  minHeight?: string
  readOnly?: boolean
}

export function CodeEditor({
  value,
  onChange,
  language = 'javascript',
  placeholder = '',
  minHeight = '200px',
  readOnly = false,
}: CodeEditorProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const highlight = useCallback(
    (code: string) => {
      if (!code) return ''
      try {
        const grammar = language === 'json' ? Prism.languages.json : Prism.languages.javascript
        return Prism.highlight(code, grammar, language)
      } catch {
        return code
      }
    },
    [language]
  )

  if (!mounted) {
    return (
      <div
        style={{
          minHeight,
          backgroundColor: '#1d1f21',
          borderRadius: '6px',
          padding: '12px',
          color: '#c5c8c6',
          fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
          fontSize: '13px',
        }}
      >
        {value || placeholder}
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight,
        backgroundColor: '#1d1f21',
        borderRadius: '6px',
        overflow: 'auto',
      }}
    >
      <Editor
        value={value}
        onValueChange={readOnly ? () => {} : onChange}
        highlight={highlight}
        padding={12}
        placeholder={placeholder}
        style={{
          fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
          fontSize: '13px',
          lineHeight: '1.5',
          minHeight,
          color: '#c5c8c6',
          caretColor: '#fff',
        }}
        textareaClassName="code-editor-textarea"
        preClassName="code-editor-pre"
        disabled={readOnly}
      />
    </div>
  )
}
