'use client'

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme = 'system' } = useTheme()

    return (
        <Sonner
            theme={theme as ToasterProps['theme']}
            className="toaster group"
            toastOptions={{
                classNames: {
                    toast: 'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-xl',
                    description: 'group-[.toast]:text-muted-foreground',
                    actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
                    cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
                    success:
                        'group-[.toaster]:border-emerald-500/30 group-[.toaster]:bg-emerald-50 dark:group-[.toaster]:bg-emerald-950/50',
                    error: 'group-[.toaster]:border-rose-500/30 group-[.toaster]:bg-rose-50 dark:group-[.toaster]:bg-rose-950/50',
                    warning:
                        'group-[.toaster]:border-amber-500/30 group-[.toaster]:bg-amber-50 dark:group-[.toaster]:bg-amber-950/50',
                    info: 'group-[.toaster]:border-blue-500/30 group-[.toaster]:bg-blue-50 dark:group-[.toaster]:bg-blue-950/50'
                }
            }}
            icons={{
                success: <CircleCheckIcon className="size-5 text-emerald-600 dark:text-emerald-400" />,
                info: <InfoIcon className="size-5 text-blue-600 dark:text-blue-400" />,
                warning: <TriangleAlertIcon className="size-5 text-amber-600 dark:text-amber-400" />,
                error: <OctagonXIcon className="size-5 text-rose-600 dark:text-rose-400" />,
                loading: <Loader2Icon className="size-5 animate-spin text-primary" />
            }}
            style={
                {
                    '--normal-bg': 'var(--popover)',
                    '--normal-text': 'var(--popover-foreground)',
                    '--normal-border': 'var(--border)',
                    '--border-radius': '0.75rem'
                } as React.CSSProperties
            }
            expand
            closeButton
            {...props}
        />
    )
}

export { Toaster }
