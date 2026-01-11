import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'file:text-foreground placeholder:text-muted-foreground/60 selection:bg-primary selection:text-primary-foreground',
                'dark:bg-input/30 border-input h-10 w-full min-w-0 rounded-lg border bg-background/50 px-3 py-2 text-base shadow-xs',
                'transition-all duration-200 outline-none',
                'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
                'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
                'hover:border-ring/50 hover:bg-background',
                'focus-visible:border-primary focus-visible:ring-primary/20 focus-visible:ring-[3px] focus-visible:bg-background',
                'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                'md:text-sm',
                className
            )}
            {...props}
        />
    )
}

export { Input }
