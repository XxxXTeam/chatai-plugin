import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

interface ProbabilitySliderProps {
    label?: string
    value: 'inherit' | number
    onChange: (value: number) => void
    disabled?: boolean
    className?: string
}

export function ProbabilitySlider({ label = '概率', value, onChange, disabled = false, className }: ProbabilitySliderProps) {
    const displayValue = value === 'inherit' ? 1.0 : value

    return (
        <div className={`flex items-center gap-2 ${className} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <Label className="text-xs w-16">{label}</Label>
            <Slider
                value={[displayValue]}
                onValueChange={([v]) => onChange(v)}
                min={0}
                max={1}
                step={0.05}
                disabled={disabled}
                className="flex-1"
            />
            <span className="text-xs w-10 text-right">
                {Math.round(displayValue * 100)}%
            </span>
        </div>
    )
}
