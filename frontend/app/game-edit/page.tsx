'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback } from 'react'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { Gamepad2, Clock, Lock, Save, AlertCircle, CheckCircle2, User, MapPin, Heart, Sparkles, Loader2 } from 'lucide-react'

interface GameData {
    environment?: {
        name?: string
        world?: string
        identity?: string
        personality?: string
        likes?: string
        dislikes?: string
        background?: string
        secret?: string
        scene?: string
        meetingReason?: string
        greeting?: string
        summary?: string
    }
    session?: {
        affection?: number
        trust?: number
        gold?: number
        relationship?: string
    }
}

interface EditSession {
    editId: string
    gameData: GameData
    editableFields: {
        environment: string[]
        session: string[]
    }
    protectedFields: string[]
    expiresAt: number
    remainingTime: number
}

const FIELD_LABELS: Record<string, string> = {
    name: '角色名',
    world: '世界观',
    identity: '身份',
    personality: '性格',
    likes: '喜好',
    dislikes: '厌恶',
    background: '背景故事',
    secret: '秘密',
    scene: '当前场景',
    meetingReason: '相遇原因',
    greeting: '开场白',
    summary: '前情提要',
    relationship: '关系'
}

const FIELD_ICONS: Record<string, React.ReactNode> = {
    name: <User className="h-4 w-4" />,
    world: <MapPin className="h-4 w-4" />,
    personality: <Sparkles className="h-4 w-4" />,
    relationship: <Heart className="h-4 w-4" />
}

function GameEditContent() {
    const searchParams = useSearchParams()
    const urlCode = searchParams.get('code')
    
    const [loading, setLoading] = useState(true)
    const [needLogin, setNeedLogin] = useState(false)
    const [loginCode, setLoginCode] = useState('')
    const [loginLoading, setLoginLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [session, setSession] = useState<EditSession | null>(null)
    const [form, setForm] = useState<GameData>({})
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [remainingTime, setRemainingTime] = useState(0)

    const getToken = () => localStorage.getItem('game_edit_token') || ''

    const loadSession = useCallback(async (token: string) => {
        try {
            const res = await fetch('/chatai/api/game-edit/session', {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) {
                if (res.status === 401) {
                    localStorage.removeItem('game_edit_token')
                    setNeedLogin(true)
                    setLoading(false)
                    return
                }
                throw new Error('加载失败')
            }
            const data = await res.json()
            if (data.code === 0) {
                setSession(data.data)
                setForm(data.data.gameData || {})
                setRemainingTime(data.data.remainingTime)
                setNeedLogin(false)
            } else {
                throw new Error(data.message)
            }
        } catch (err) {
            setError((err as Error).message || '加载失败')
        } finally {
            setLoading(false)
        }
    }, [])

    const handleLoginWithCode = useCallback(async (code: string) => {
        setLoading(true)
        try {
            const res = await fetch('/chatai/api/game-edit/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code.trim() })
            })
            const data = await res.json()
            if (data.code === 0) {
                localStorage.setItem('game_edit_token', data.data.token)
                toast.success('登录成功')
                loadSession(data.data.token)
            } else {
                toast.error(data.message || '编辑码无效或已过期')
                setNeedLogin(true)
                setLoading(false)
            }
        } catch {
            toast.error('登录失败，请检查网络')
            setNeedLogin(true)
            setLoading(false)
        }
    }, [loadSession])

    useEffect(() => {
        if (urlCode) {
            window.history.replaceState({}, '', '/chatai/game-edit')
            handleLoginWithCode(urlCode)
            return
        }
        const token = localStorage.getItem('game_edit_token')
        if (!token) {
            setNeedLogin(true)
            setLoading(false)
            return
        }
        loadSession(token)
    }, [urlCode, handleLoginWithCode, loadSession])

    useEffect(() => {
        if (remainingTime <= 0) return
        const timer = setInterval(() => {
            setRemainingTime(prev => {
                if (prev <= 1000) {
                    clearInterval(timer)
                    setError('编辑会话已过期')
                    return 0
                }
                return prev - 1000
            })
        }, 1000)
        return () => clearInterval(timer)
    }, [remainingTime])

    const formatTime = (ms: number) => {
        const minutes = Math.floor(ms / 60000)
        const seconds = Math.floor((ms % 60000) / 1000)
        return `${minutes}:${seconds.toString().padStart(2, '0')}`
    }

    const handleEnvChange = (field: string, value: string) => {
        setForm(prev => ({ ...prev, environment: { ...prev.environment, [field]: value } }))
    }

    const handleSessionChange = (field: string, value: string) => {
        setForm(prev => ({ ...prev, session: { ...prev.session, [field]: value } }))
    }

    const handleLogin = async () => {
        if (!loginCode.trim()) {
            toast.error('请输入编辑码')
            return
        }
        setLoginLoading(true)
        await handleLoginWithCode(loginCode)
        setLoginLoading(false)
    }

    const handleSubmit = async () => {
        if (!session) return
        setSaving(true)
        try {
            const res = await fetch('/chatai/api/game-edit/session', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ updates: form })
            })
            const data = await res.json()
            if (data.code !== 0) {
                toast.error(data.message || '提交失败')
                return
            }
            setSaved(true)
            localStorage.removeItem('game_edit_token')
            toast.success('编辑已提交！请返回游戏查看更新')
        } catch {
            toast.error('网络错误')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 p-4">
                <div className="max-w-2xl mx-auto space-y-4">
                    <Skeleton className="h-12 w-48" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 flex items-center justify-center p-4">
                <Card className="max-w-md w-full">
                    <CardContent className="pt-6 text-center">
                        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
                        <h2 className="text-lg font-semibold mb-2">无法加载</h2>
                        <p className="text-muted-foreground">{error}</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (needLogin) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900">
                <div className="w-full max-w-md space-y-4">
                    <Card>
                        <CardHeader className="text-center">
                            <div className="mx-auto p-3 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 w-fit mb-2">
                                <Gamepad2 className="h-6 w-6 text-white" />
                            </div>
                            <CardTitle>游戏信息编辑</CardTitle>
                            <CardDescription>输入编辑码以访问编辑页面</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Input
                                value={loginCode}
                                onChange={e => setLoginCode(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                                placeholder="输入编辑码（UUID格式）"
                                className="text-center font-mono"
                                autoFocus
                            />
                            <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={handleLogin} disabled={loginLoading}>
                                {loginLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                进入编辑
                            </Button>
                        </CardContent>
                    </Card>
                    <Card className="bg-muted/50">
                        <CardContent className="pt-4">
                            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                                如何获取编辑码？
                            </h3>
                            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                                <li>在游戏群中发送 <code className="bg-background px-1 py-0.5 rounded border">#游戏在线编辑</code></li>
                                <li>Bot 将私聊发送编辑链接或编辑码</li>
                                <li>编辑码有效期为 <strong>30分钟</strong></li>
                            </ol>
                        </CardContent>
                    </Card>
                </div>
            </div>
        )
    }

    if (saved) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 dark:from-gray-900 dark:to-emerald-900 flex items-center justify-center p-4">
                <Card className="max-w-md w-full">
                    <CardContent className="pt-6 text-center">
                        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                        <h2 className="text-lg font-semibold mb-2">编辑已提交</h2>
                        <p className="text-muted-foreground">请返回游戏查看更新后的信息</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 p-4">
            <div className="max-w-2xl mx-auto space-y-4">
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
                                    <Gamepad2 className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <CardTitle>游戏信息编辑</CardTitle>
                                    <CardDescription>编辑你的游戏角色和环境设定</CardDescription>
                                </div>
                            </div>
                            <Badge variant="outline" className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTime(remainingTime)}
                            </Badge>
                        </div>
                    </CardHeader>
                </Card>

                <Card>
                    <CardHeader><CardTitle className="text-base">角色设定</CardTitle></CardHeader>
                    <CardContent>
                        <ScrollArea className="max-h-[50vh]">
                            <div className="space-y-4 pr-4">
                                {session?.editableFields.environment.map(field => (
                                    <div key={field} className="space-y-2">
                                        <Label className="flex items-center gap-2">{FIELD_ICONS[field]}{FIELD_LABELS[field] || field}</Label>
                                        {['background', 'summary', 'greeting', 'scene'].includes(field) ? (
                                            <Textarea value={(form.environment as Record<string, string>)?.[field] || ''} onChange={e => handleEnvChange(field, e.target.value)} placeholder={`输入${FIELD_LABELS[field] || field}...`} rows={3} />
                                        ) : (
                                            <Input value={(form.environment as Record<string, string>)?.[field] || ''} onChange={e => handleEnvChange(field, e.target.value)} placeholder={`输入${FIELD_LABELS[field] || field}...`} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>

                <Card className="border-dashed">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground"><Lock className="h-4 w-4" />受保护的信息（只读）</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">好感度:</span><span>{form.session?.affection ?? '???'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">信任度:</span><span>{form.session?.trust ?? '???'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">金币:</span><span>{form.session?.gold ?? '???'}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">秘密:</span><span className="text-muted-foreground italic">隐藏</span></div>
                        </div>
                    </CardContent>
                </Card>

                {session?.editableFields.session.length > 0 && (
                    <Card>
                        <CardHeader><CardTitle className="text-base">会话设定</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {session.editableFields.session.map(field => (
                                <div key={field} className="space-y-2">
                                    <Label className="flex items-center gap-2">{FIELD_ICONS[field]}{FIELD_LABELS[field] || field}</Label>
                                    <Input value={(form.session as Record<string, string>)?.[field] || ''} onChange={e => handleSessionChange(field, e.target.value)} placeholder={`输入${FIELD_LABELS[field] || field}...`} />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}

                <Button className="w-full" size="lg" onClick={handleSubmit} disabled={saving || remainingTime <= 0}>
                    {saving ? <>保存中...</> : <><Save className="mr-2 h-4 w-4" />提交编辑</>}
                </Button>
            </div>
        </div>
    )
}

export default function GameEditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 p-4">
                <div className="max-w-2xl mx-auto space-y-4">
                    <Skeleton className="h-12 w-48" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        }>
            <GameEditContent />
        </Suspense>
    )
}
