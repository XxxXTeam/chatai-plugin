import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FormNumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string
  value: number | string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  className?: string
  containerClassName?: string
  description?: string
}

export function FormNumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  className,
  containerClassName,
  description,
  ...props
}: FormNumberInputProps) {
  return (
    <div className={cn("space-y-1", containerClassName)}>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        className={cn("h-8", className)}
        {...props}
      />
      {description && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
