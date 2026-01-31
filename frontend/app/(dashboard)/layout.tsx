'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { MobileNav } from '@/components/layout/MobileNav'
import { SetupWizard } from '@/components/SetupWizard'
import { DashboardTour } from '@/components/DashboardTour'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { systemApi } from '@/lib/api'
import { CommandPalette, useCommandPalette } from '@/components/ui/command-palette'
import { useResponsive } from '@/lib/hooks'
import { cn } from '@/lib/utils'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [authenticated, setAuthenticated] = useState(false)
    const { open: commandPaletteOpen, setOpen: setCommandPaletteOpen } = useCommandPalette()
    const { isMobile, mounted } = useResponsive()

    useEffect(() => {
        // 检查 URL 参数中的 auth_token（从后端重定向过来）
        const urlParams = new URLSearchParams(window.location.search)
        const authTokenFromUrl = urlParams.get('auth_token')
        if (authTokenFromUrl) {
            localStorage.setItem('chatai_token', authTokenFromUrl)
            // 清除 URL 参数
            window.history.replaceState({}, '', window.location.pathname)
        }
        let token = localStorage.getItem('chatai_token')
        if (!token) {
            const cookies = document.cookie.split(';')
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=')
                if (name === 'auth_token' && value) {
                    token = value
                    // 同步到localStorage
                    localStorage.setItem('chatai_token', value)
                    break
                }
            }
        }

        if (!token) {
            router.push('/login/')
            return
        }

        // 使用受保护的API验证token有效性
        systemApi
            .getState()
            .then(() => {
                setAuthenticated(true)
                setLoading(false)
            })
            .catch(() => {
                localStorage.removeItem('chatai_token')
                // 清除cookie
                document.cookie = 'auth_token=; path=/chatai; expires=Thu, 01 Jan 1970 00:00:00 GMT'
                router.push('/login/')
            })
    }, [router])

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4 animate-fade-in">
                    <div className="relative">
                        <div className="w-12 h-12 rounded-full border-4 border-muted" />
                        <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                    </div>
                    <p className="text-sm text-muted-foreground animate-pulse-soft">加载中...</p>
                </div>
            </div>
        )
    }

    if (!authenticated) {
        return null
    }

    return (
        <div className="flex h-screen overflow-hidden bg-background relative">
            {/* Background Decor */}
            <div className="absolute inset-0 bg-[#f8fafc] dark:bg-[#020617] -z-10" />
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] -z-10 animate-pulse-soft" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/5 blur-[120px] -z-10 animate-pulse-soft delay-700" />

            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
                <Header onSearchClick={() => setCommandPaletteOpen(true)} />
                <main
                    className={cn(
                        'flex-1 overflow-y-auto scroll-smooth',
                        'p-3 sm:p-4 md:p-6',
                        // 移动端底部导航占位
                        mounted && isMobile ? 'pb-[calc(80px+env(safe-area-inset-bottom,0px))]' : 'pb-6'
                    )}
                >
                    {children}
                </main>
            </div>

            {/* 移动端底部导航 */}
            <MobileNav />

            {/* 全局命令面板 */}
            <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

            {/* 首次使用引导 */}
            <SetupWizard />
            { <DashboardTour /> }
        </div>
    )
}
