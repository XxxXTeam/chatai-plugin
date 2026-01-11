'use client'

import { useState, KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface DynamicTagsProps {
    value: string[]
    onChange: (value: string[]) => void
    placeholder?: string
    className?: string
    disabled?: boolean
    variant?: 'default' | 'secondary' | 'destructive' | 'outline'
}

export function DynamicTags({
    value = [],
    onChange,
    placeholder = '输入后按回车添加',
    className,
    disabled = false,
    variant = 'secondary'
}: DynamicTagsProps) {
    const [inputValue, setInputValue] = useState('')

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            addTag()
        }
    }

    const addTag = () => {
        const trimmed = inputValue.trim()
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed])
            setInputValue('')
        }
    }

    const removeTag = (tag: string) => {
        onChange(value.filter(t => t !== tag))
    }

    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex flex-wrap gap-2">
                {value.map(tag => (
                    <Badge key={tag} variant={variant} className="gap-1 pr-1">
                        {tag}
                        {!disabled && (
                            <button
                                type="button"
                                onClick={e => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    removeTag(tag)
                                }}
                                className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                            >
                                <X className="h-3 w-3 cursor-pointer hover:text-destructive" />
                            </button>
                        )}
                    </Badge>
                ))}
            </div>
            {!disabled && (
                <div className="flex gap-2">
                    <Input
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        className="flex-1"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={addTag} disabled={!inputValue.trim()}>
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    )
}
