'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { authApi } from '@/lib/api'
import { toast } from 'sonner'

function TokenLoginContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [message, setMessage] = useState('正在验证登录凭证...')

    useEffect(() => {
        const token = searchParams.get('token')
        const existingToken = localStorage.getItem('chatai_token')
        if (existingToken) {
            try {
                const parts = existingToken.split('.')
                if (parts.length === 3) {
                    const payload = JSON.parse(atob(parts[1]))
                    const exp = payload.exp * 1000 
                    if (exp > Date.now()) {
                        setStatus('success')
                        setMessage('已登录，正在跳转...')
                        router.push('/')
                        return
                    }
                }
            } catch {
                localStorage.removeItem('chatai_token')
            }
        }

        if (!token) {
            setStatus('error')
            setMessage('无效的登录链接')
            return
        }
        const verifyToken = async () => {
            try {
                const res = (await authApi.verifyToken(token)) as {
                    success?: boolean
                    data?: { token?: string }
                    message?: string
                }
                if (res?.success || res?.data?.token) {
                    const authToken = res?.data?.token
                    localStorage.setItem('chatai_token', authToken)
                    setStatus('success')
                    setMessage('登录成功，正在跳转...')
                    toast.success('登录成功')

                    // 延迟跳转
                    setTimeout(() => {
                        router.push('/')
                    }, 10)
                } else {
                    throw new Error(res?.message || '验证失败')
                }
            } catch (error) {
                const err = error as { response?: { data?: { message?: string } }; message?: string }
                console.error('Token验证失败:', error)
                setStatus('error')
                setMessage(err?.response?.data?.message || err?.message || '登录凭证无效或已过期')
                toast.error('登录失败')
            }
        }

        verifyToken()
    }, [searchParams, router])

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        {status === 'loading' && <Loader2 className="h-12 w-12 text-primary animate-spin" />}
                        {status === 'success' && <CheckCircle className="h-12 w-12 text-green-500" />}
                        {status === 'error' && <XCircle className="h-12 w-12 text-destructive" />}
                    </div>
                    <CardTitle className="text-xl">{message}</CardTitle>
                </CardHeader>
                {status === 'error' && (
                    <CardContent className="text-center">
                        <button onClick={() => router.push('/login')} className="text-primary hover:underline">
                            返回登录页面
                        </button>
                    </CardContent>
                )}
            </Card>
        </div>
    )
}

export default function TokenLoginPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <div className="flex justify-center mb-4">
                                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                            </div>
                            <CardTitle className="text-xl">正在加载...</CardTitle>
                        </CardHeader>
                    </Card>
                </div>
            }
        >
            <TokenLoginContent />
        </Suspense>
    )
}
