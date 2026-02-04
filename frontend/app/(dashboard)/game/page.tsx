'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Gamepad2, User, Settings, Save, Users, MessageSquare, BarChart3 } from 'lucide-react'
import { PageHeader, PageContainer } from '@/components/layout/PageHeader'
import { DeleteDialog } from '@/components/ui/delete-dialog'

interface GamePreset {
    id: string
    name: string
    world: string
    identity: string
    personality: string
    likes: string
    dislikes: string
    background: string
    secret: string
    scene: string
    meetingReason: string
    greeting: string
    summary: string
    isDefault?: boolean
    createdAt?: number
}

interface GameSettings {
    probability: number
    temperature: number
    maxTokens: number
    gameModel: string
    enableTools: boolean
}

interface GameSession {
    id: number
    user_id: string
    character_id: string
    group_id: string | null
    affection: number
    trust: number
    gold: number
    relationship: string
    in_game: number
    message_count: number
    character_name: string | null
    updated_at: number
}

interface GameCharacter {
    id: number
    character_id: string
    name: string
    description: string
    created_by: string
    is_public: number
    created_at: number
}

interface GameStats {
    totalSessions: number
    activeSessions: number
    totalMessages: number
    totalCharacters: number
}

export default function GamePage() {
    const [presets, setPresets] = useState<GamePreset[]>([])
    const [sessions, setSessions] = useState<GameSession[]>([])
    const [characters, setCharacters] = useState<GameCharacter[]>([])
    const [stats, setStats] = useState<GameStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingPreset, setEditingPreset] = useState<GamePreset | null>(null)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState('presets')
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deletingPreset, setDeletingPreset] = useState<GamePreset | null>(null)
    const [deletingSession, setDeletingSession] = useState<GameSession | null>(null)
    const [deletingCharacter, setDeletingCharacter] = useState<GameCharacter | null>(null)

    const [settings, setSettings] = useState<GameSettings>({
        probability: 30,
        temperature: 0.8,
        maxTokens: 1000,
        gameModel: '',
        enableTools: false
    })

    const [form, setForm] = useState<Omit<GamePreset, 'id' | 'createdAt'>>({
        name: '',
        world: '',
        identity: '',
        personality: '',
        likes: '',
        dislikes: '',
        background: '',
        secret: '',
        scene: '',
        meetingReason: '',
        greeting: '',
        summary: '',
        isDefault: false
    })

    const fetchPresets = async () => {
        try {
            const res = await fetch('/api/game/presets')
            const data = await res.json()
            setPresets(data.data || [])
        } catch (error) {
            console.error('加载预设失败:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchSettings = async () => {
        try {
            const res = await fetch('/api/game/settings')
            const data = await res.json()
            if (data.data) setSettings(data.data)
        } catch (error) {
            console.error('加载设置失败:', error)
        }
    }

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/game/sessions')
            const data = await res.json()
            setSessions(data.data || [])
        } catch (error) {
            console.error('加载会话失败:', error)
        }
    }

    const fetchCharacters = async () => {
        try {
            const res = await fetch('/api/game/characters')
            const data = await res.json()
            setCharacters(data.data || [])
        } catch (error) {
            console.error('加载角色失败:', error)
        }
    }

    const fetchStats = async () => {
        try {
            const res = await fetch('/api/game/stats')
            const data = await res.json()
            if (data.data) setStats(data.data)
        } catch (error) {
            console.error('加载统计失败:', error)
        }
    }

    useEffect(() => {
        Promise.all([fetchPresets(), fetchSettings(), fetchSessions(), fetchCharacters(), fetchStats()])
    }, [])

    const resetForm = () => {
        setForm({
            name: '', world: '', identity: '', personality: '',
            likes: '', dislikes: '', background: '', secret: '',
            scene: '', meetingReason: '', greeting: '', summary: '', isDefault: false
        })
        setEditingPreset(null)
    }

    const handleOpenDialog = (preset?: GamePreset) => {
        if (preset) {
            setEditingPreset(preset)
            setForm({ ...preset })
        } else {
            resetForm()
        }
        setDialogOpen(true)
    }

    const handleSave = async () => {
        if (!form.name) {
            toast.error('请填写角色名称')
            return
        }
        setSaving(true)
        try {
            const url = editingPreset ? `/api/game/presets/${editingPreset.id}` : '/api/game/presets'
            const method = editingPreset ? 'PUT' : 'POST'
            await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
            toast.success(editingPreset ? '预设已更新' : '预设已创建')
            setDialogOpen(false)
            resetForm()
            fetchPresets()
        } catch {
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!deletingPreset) return
        try {
            await fetch(`/api/game/presets/${deletingPreset.id}`, { method: 'DELETE' })
            toast.success('预设已删除')
            fetchPresets()
        } catch {
            toast.error('删除失败')
        }
    }

    const handleDeleteSession = async () => {
        if (!deletingSession) return
        try {
            await fetch(`/api/game/sessions/${deletingSession.id}`, { method: 'DELETE' })
            toast.success('会话已删除')
            fetchSessions()
            fetchStats()
        } catch {
            toast.error('删除失败')
        }
    }

    const handleDeleteCharacter = async () => {
        if (!deletingCharacter) return
        try {
            await fetch(`/api/game/characters/${deletingCharacter.character_id}`, { method: 'DELETE' })
            toast.success('角色已删除')
            fetchCharacters()
            fetchStats()
        } catch {
            toast.error('删除失败')
        }
    }

    const handleSaveSettings = async () => {
        try {
            await fetch('/api/game/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            })
            toast.success('设置已保存')
        } catch {
            toast.error('保存失败')
        }
    }

    if (loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-32" />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[...Array(3)].map((_, i) => (
                        <Card key={i}><CardHeader><Skeleton className="h-6 w-32" /></CardHeader><CardContent><Skeleton className="h-20 w-full" /></CardContent></Card>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <PageContainer>
            <PageHeader title="Galgame 管理" description="管理游戏角色预设和游戏设置" icon={Gamepad2} actions={
                <Button size="sm" onClick={() => handleOpenDialog()}><Plus className="mr-2 h-4 w-4" />新建预设</Button>
            } />

            {/* 统计卡片 */}
            {stats && (
                <div className="grid gap-4 md:grid-cols-4 mb-4">
                    <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">总会话</span></div><p className="text-2xl font-bold">{stats.totalSessions}</p></CardContent></Card>
                    <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Gamepad2 className="h-4 w-4 text-green-500" /><span className="text-sm text-muted-foreground">进行中</span></div><p className="text-2xl font-bold">{stats.activeSessions}</p></CardContent></Card>
                    <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-blue-500" /><span className="text-sm text-muted-foreground">总消息</span></div><p className="text-2xl font-bold">{stats.totalMessages}</p></CardContent></Card>
                    <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-purple-500" /><span className="text-sm text-muted-foreground">角色数</span></div><p className="text-2xl font-bold">{stats.totalCharacters}</p></CardContent></Card>
                </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="presets">角色预设</TabsTrigger>
                    <TabsTrigger value="sessions">游戏会话</TabsTrigger>
                    <TabsTrigger value="characters">用户角色</TabsTrigger>
                    <TabsTrigger value="settings">游戏设置</TabsTrigger>
                </TabsList>

                <TabsContent value="presets" className="space-y-4">
                    {presets.length === 0 ? (
                        <Card><CardContent className="py-10 text-center text-muted-foreground">暂无预设，点击上方按钮创建</CardContent></Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {presets.map(preset => (
                                <Card key={preset.id} className="group relative">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <User className="h-4 w-4" />{preset.name}
                                                {preset.isDefault && <Badge variant="secondary">默认</Badge>}
                                            </CardTitle>
                                        </div>
                                        <CardDescription>{preset.world} · {preset.identity}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm">
                                        <p><span className="text-muted-foreground">性格:</span> {preset.personality || '???'}</p>
                                        <p><span className="text-muted-foreground">场景:</span> {preset.scene || '???'}</p>
                                        <div className="flex gap-2 pt-2">
                                            <Button size="sm" variant="outline" onClick={() => handleOpenDialog(preset)}>编辑</Button>
                                            <Button size="sm" variant="ghost" onClick={() => { setDeletingPreset(preset); setDeleteDialogOpen(true) }}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="sessions" className="space-y-4">
                    {sessions.length === 0 ? (
                        <Card><CardContent className="py-10 text-center text-muted-foreground">暂无游戏会话</CardContent></Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {sessions.map(session => (
                                <Card key={session.id}>
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <User className="h-4 w-4" />
                                                {session.character_name || session.character_id}
                                                {session.in_game === 1 && <Badge variant="default" className="bg-green-500">进行中</Badge>}
                                            </CardTitle>
                                        </div>
                                        <CardDescription>用户: {session.user_id} {session.group_id && `· 群: ${session.group_id}`}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm">
                                        <div className="flex gap-4">
                                            <span>❤️ {session.affection}</span>
                                            <span>🤝 {session.trust}</span>
                                            <span>💰 {session.gold}</span>
                                        </div>
                                        <p><span className="text-muted-foreground">消息数:</span> {session.message_count}</p>
                                        <p><span className="text-muted-foreground">关系:</span> {session.relationship}</p>
                                        <div className="flex gap-2 pt-2">
                                            <Button size="sm" variant="ghost" onClick={() => { setDeletingSession(session); setDeleteDialogOpen(true) }}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="characters" className="space-y-4">
                    {characters.length === 0 ? (
                        <Card><CardContent className="py-10 text-center text-muted-foreground">暂无用户创建的角色</CardContent></Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {characters.map(char => (
                                <Card key={char.id}>
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between">
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <User className="h-4 w-4" />{char.name}
                                                {char.is_public === 1 && <Badge variant="secondary">公开</Badge>}
                                            </CardTitle>
                                        </div>
                                        <CardDescription>ID: {char.character_id}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm">
                                        <p className="line-clamp-2">{char.description || '无描述'}</p>
                                        <p><span className="text-muted-foreground">创建者:</span> {char.created_by}</p>
                                        <div className="flex gap-2 pt-2">
                                            <Button size="sm" variant="ghost" onClick={() => { setDeletingCharacter(char); setDeleteDialogOpen(true) }}><Trash2 className="h-4 w-4" /></Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="settings" className="space-y-4">
                    <Card>
                        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" />游戏参数</CardTitle></CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label>触发概率 ({settings.probability}%)</Label>
                                <Slider value={[settings.probability]} onValueChange={v => setSettings({ ...settings, probability: v[0] })} max={100} step={5} />
                            </div>
                            <div className="space-y-2">
                                <Label>温度 ({settings.temperature})</Label>
                                <Slider value={[settings.temperature * 100]} onValueChange={v => setSettings({ ...settings, temperature: v[0] / 100 })} max={200} step={10} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>最大Token</Label>
                                    <Input type="number" value={settings.maxTokens} onChange={e => setSettings({ ...settings, maxTokens: parseInt(e.target.value) || 1000 })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>游戏模型</Label>
                                    <Input value={settings.gameModel} onChange={e => setSettings({ ...settings, gameModel: e.target.value })} placeholder="留空使用默认" />
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <Label>启用工具</Label>
                                <Switch checked={settings.enableTools} onCheckedChange={v => setSettings({ ...settings, enableTools: v })} />
                            </div>
                            <Button onClick={handleSaveSettings}><Save className="mr-2 h-4 w-4" />保存设置</Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh]">
                    <DialogHeader>
                        <DialogTitle>{editingPreset ? '编辑预设' : '新建预设'}</DialogTitle>
                        <DialogDescription>配置Galgame角色预设</DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="max-h-[60vh] pr-4">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label>角色名 *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="小雪" /></div>
                                <div><Label>世界观</Label><Input value={form.world} onChange={e => setForm({ ...form, world: e.target.value })} placeholder="校园/奇幻/都市" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label>身份</Label><Input value={form.identity} onChange={e => setForm({ ...form, identity: e.target.value })} placeholder="高中生" /></div>
                                <div><Label>性格</Label><Input value={form.personality} onChange={e => setForm({ ...form, personality: e.target.value })} placeholder="温柔,内向" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label>喜好</Label><Input value={form.likes} onChange={e => setForm({ ...form, likes: e.target.value })} placeholder="读书,音乐" /></div>
                                <div><Label>厌恶</Label><Input value={form.dislikes} onChange={e => setForm({ ...form, dislikes: e.target.value })} placeholder="吵闹" /></div>
                            </div>
                            <div><Label>背景故事</Label><Textarea value={form.background} onChange={e => setForm({ ...form, background: e.target.value })} placeholder="过去经历..." rows={2} /></div>
                            <div><Label>秘密</Label><Textarea value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })} placeholder="隐藏的秘密..." rows={2} /></div>
                            <div><Label>初始场景</Label><Textarea value={form.scene} onChange={e => setForm({ ...form, scene: e.target.value })} placeholder="当前场景描述..." rows={2} /></div>
                            <div><Label>相遇原因</Label><Input value={form.meetingReason} onChange={e => setForm({ ...form, meetingReason: e.target.value })} placeholder="如何相遇" /></div>
                            <div><Label>开场白</Label><Textarea value={form.greeting} onChange={e => setForm({ ...form, greeting: e.target.value })} placeholder="打招呼的话..." rows={2} /></div>
                            <div><Label>前情提要</Label><Textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} placeholder="长消息描述全部信息..." rows={3} /></div>
                            <div className="flex items-center gap-2"><Switch checked={form.isDefault} onCheckedChange={v => setForm({ ...form, isDefault: v })} /><Label>设为默认</Label></div>
                        </div>
                    </ScrollArea>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                        <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <DeleteDialog 
                open={deleteDialogOpen} 
                onOpenChange={(open) => {
                    setDeleteDialogOpen(open)
                    if (!open) {
                        setDeletingPreset(null)
                        setDeletingSession(null)
                        setDeletingCharacter(null)
                    }
                }} 
                onConfirm={() => {
                    if (deletingPreset) handleDelete()
                    else if (deletingSession) handleDeleteSession()
                    else if (deletingCharacter) handleDeleteCharacter()
                    setDeleteDialogOpen(false)
                }} 
                title={deletingPreset ? '删除预设' : deletingSession ? '删除会话' : '删除角色'} 
                description={
                    deletingPreset ? `确定删除预设"${deletingPreset.name}"吗？` :
                    deletingSession ? `确定删除用户 ${deletingSession.user_id} 的会话吗？所有对话历史将被删除。` :
                    deletingCharacter ? `确定删除角色"${deletingCharacter?.name}"吗？` : ''
                } 
            />
        </PageContainer>
    )
}
