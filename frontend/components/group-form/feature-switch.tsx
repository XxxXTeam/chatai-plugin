import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ReactNode } from 'react'

interface FeatureSwitchProps {
    icon: ReactNode
    title: string
    desc: string
    value: 'inherit' | 'on' | 'off'
    onChange: (value: 'inherit' | 'on' | 'off') => void
    children?: ReactNode
}

export function FeatureSwitch({ icon, title, desc, value, onChange, children }: FeatureSwitchProps) {
    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-muted">
                        {icon}
                    </div>
                    <div>
                        <p className="text-sm font-medium">{title}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                </div>
                <Select value={value} onValueChange={onChange}>
                    <SelectTrigger className="w-24">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="inherit">继承</SelectItem>
                        <SelectItem value="on">开启</SelectItem>
                        <SelectItem value="off">关闭</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {children}
        </div>
    )
}
