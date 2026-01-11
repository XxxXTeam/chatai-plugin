'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Bot, Loader2, Key } from 'lucide-react'
import { authApi } from '@/lib/api'
import { toast } from 'sonner'

export default function LoginPage() {
    const router = useRouter()
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)

    const [generating, setGenerating] = useState(false)

    const handleGetToken = async () => {
        setGenerating(true)
        try {
            await authApi.generateToken()
            toast.success('Token 已输出到 Yunzai 控制台')
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } }
            toast.error(err.response?.data?.message || '获取 Token 失败')
        } finally {
            setGenerating(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!password.trim()) {
            toast.error('请输入密码')
            return
        }

        setLoading(true)
        try {
            const res = (await authApi.login(password)) as { data: { token: string } }
            if (res.data?.token) {
                localStorage.setItem('chatai_token', res.data.token)
                toast.success('登录成功')
                router.push('/')
            }
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } }
            toast.error(err.response?.data?.message || '登录失败')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-3 bg-primary/10 rounded-full">
                            <Bot className="h-8 w-8 text-primary" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl">ChatAI 管理面板</CardTitle>
                    <CardDescription>请输入登录 Token</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="password">登录</Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder="请输入Token"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                disabled={loading}
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            登录
                        </Button>
                    </form>
                    <div className="mt-4 pt-4 border-t">
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={handleGetToken}
                            disabled={generating}
                        >
                            {generating ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Key className="mr-2 h-4 w-4" />
                            )}
                            获取登录 Token
                        </Button>
                        <p className="text-xs text-muted-foreground text-center mt-2">点击后在控制台查看 Token</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
