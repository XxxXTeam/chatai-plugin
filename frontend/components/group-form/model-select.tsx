import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface ModelSelectProps {
    label: string
    value: string
    models: string[]
    onChange: (value: string) => void
    placeholder?: string
    className?: string
}

export function ModelSelect({
    label,
    value,
    models,
    onChange,
    placeholder = "使用全局配置",
    className
}: ModelSelectProps) {
    return (
        <div className={cn("space-y-1", className)}>
            <Label className="text-xs">{label}</Label>
            <Select
                value={value || '__default__'}
                onValueChange={v => onChange(v === '__default__' ? '' : v)}
            >
                <SelectTrigger>
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                    <SelectItem value="__default__">{placeholder}</SelectItem>
                    {models.map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
