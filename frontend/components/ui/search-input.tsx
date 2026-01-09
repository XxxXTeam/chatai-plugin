'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, X, Command } from 'lucide-react'

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  showShortcut?: boolean
  onShortcutClick?: () => void
  containerClassName?: string
}

export function SearchInput({
  value,
  onChange,
  onClear,
  showShortcut = false,
  onShortcutClick,
  placeholder = '搜索...',
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  
  const handleClear = () => {
    onChange('')
    onClear?.()
    inputRef.current?.focus()
  }
  
  return (
    <div className={cn('relative', containerClassName)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('pl-9 pr-20 h-10', className)}
        {...props}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {value && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleClear}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {showShortcut && onShortcutClick && (
          <button
            onClick={onShortcutClick}
            className="hidden sm:inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-1.5 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
          >
            <Command className="h-3 w-3" />K
          </button>
        )}
      </div>
    </div>
  )
}

// 带全局搜索快捷键的搜索输入框
interface GlobalSearchInputProps {
  value: string
  onChange: (value: string) => void
  onGlobalSearch?: () => void
  placeholder?: string
  className?: string
}

export function GlobalSearchInput({
  value,
  onChange,
  onGlobalSearch,
  placeholder = '搜索...',
  className,
}: GlobalSearchInputProps) {
  return (
    <SearchInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      showShortcut={!!onGlobalSearch}
      onShortcutClick={onGlobalSearch}
      className={className}
    />
  )
}
