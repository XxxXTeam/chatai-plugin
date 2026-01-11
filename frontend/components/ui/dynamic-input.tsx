'use client'

import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DynamicInputProps<T> {
    value: T[]
    onChange: (value: T[]) => void
    onCreate: () => T
    renderItem: (item: T, index: number, onChange: (item: T) => void) => React.ReactNode
    className?: string
    disabled?: boolean
    addButtonText?: string
}

export function DynamicInput<T>({
    value = [],
    onChange,
    onCreate,
    renderItem,
    className,
    disabled = false,
    addButtonText = '添加'
}: DynamicInputProps<T>) {
    const handleAdd = () => {
        onChange([...value, onCreate()])
    }

    const handleRemove = (index: number) => {
        const newValue = [...value]
        newValue.splice(index, 1)
        onChange(newValue)
    }

    const handleItemChange = (index: number, item: T) => {
        const newValue = [...value]
        newValue[index] = item
        onChange(newValue)
    }

    return (
        <div className={cn('space-y-3', className)}>
            {value.map((item, index) => (
                <div key={index} className="flex items-start gap-2">
                    <div className="flex-1">{renderItem(item, index, newItem => handleItemChange(index, newItem))}</div>
                    {!disabled && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="mt-1 text-destructive hover:text-destructive"
                            onClick={() => handleRemove(index)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            ))}
            {!disabled && (
                <Button type="button" variant="outline" size="sm" onClick={handleAdd} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    {addButtonText}
                </Button>
            )}
        </div>
    )
}
