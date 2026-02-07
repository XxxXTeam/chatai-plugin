'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error('[Dashboard Error]', error)
    }, [error])

    return (
        <div className="flex h-[60vh] items-center justify-center p-4">
            <div className="flex flex-col items-center gap-4 text-center max-w-md">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                    <AlertTriangle className="h-8 w-8 text-destructive" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold">页面加载出错</h2>
                    <p className="text-sm text-muted-foreground">
                        {error.message || '发生了意外错误，请尝试刷新页面'}
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button onClick={reset} variant="default" size="sm">
                        <RefreshCw className="mr-2 h-4 w-4" />
                        重试
                    </Button>
                    <Button
                        onClick={() => window.location.reload()}
                        variant="outline"
                        size="sm"
                    >
                        刷新页面
                    </Button>
                </div>
            </div>
        </div>
    )
}
