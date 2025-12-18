'use client'

import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { systemApi } from '@/lib/api'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    // 检查 URL 参数中的 auth_token（从后端重定向过来）
    const urlParams = new URLSearchParams(window.location.search)
    const authTokenFromUrl = urlParams.get('auth_token')
    if (authTokenFromUrl) {
      localStorage.setItem('chaite_token', authTokenFromUrl)
      // 清除 URL 参数
      window.history.replaceState({}, '', window.location.pathname)
    }
    
    const token = localStorage.getItem('chaite_token')
    if (!token) {
      router.push('/login/')
      return
    }

    // 使用受保护的API验证token有效性
    systemApi.getState()
      .then(() => {
        setAuthenticated(true)
        setLoading(false)
      })
      .catch(() => {
        localStorage.removeItem('chaite_token')
        router.push('/login/')
      })
  }, [router])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!authenticated) {
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
