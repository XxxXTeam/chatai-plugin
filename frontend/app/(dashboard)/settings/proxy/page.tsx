'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { proxyApi, ProxyProfile, ProxyConfig, ProxyScope } from '@/lib/api'
import { toast } from 'sonner'
import {
    Plus,
    Loader2,
    Trash2,
    Edit,
    Globe,
    Server,
    Shield,
    Wifi,
    WifiOff,
    TestTube,
    Check,
    X,
    Eye,
    EyeOff
} from 'lucide-react'

const proxyTypes = [
    { value: 'http', label: 'HTTP' },
    { value: 'https', label: 'HTTPS' },
    { value: 'socks5', label: 'SOCKS5' },
    { value: 'socks4', label: 'SOCKS4' }
]

const scopeLabels: Record<string, { label: string; description: string; icon: React.ReactNode }> = {
    browser: {
        label: '浏览器',
        description: '用于网页访问工具 (website)',
        icon: <Globe className="h-4 w-4" />
    },
    api: {
        label: 'API请求',
        description: '用于通用HTTP请求',
        icon: <Server className="h-4 w-4" />
    },
    channel: {
        label: '渠道请求',
        description: '用于LLM API调用 (OpenAI等)',
        icon: <Shield className="h-4 w-4" />
    }
}

interface ProfileFormData {
    name: string
    type: 'http' | 'https' | 'socks5' | 'socks4'
    host: string
    port: string
    username: string
    password: string
    enabled: boolean
}

const defaultFormData: ProfileFormData = {
    name: '',
    type: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
    enabled: true
}

export default function ProxyPage() {
    const [config, setConfig] = useState<ProxyConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingProfile, setEditingProfile] = useState<ProxyProfile | null>(null)
    const [formData, setFormData] = useState<ProfileFormData>(defaultFormData)
    const [showPassword, setShowPassword] = useState(false)
    const [testing, setTesting] = useState<string | null>(null)
    const [testResults, setTestResults] = useState<
        Record<string, { success: boolean; latency?: number; error?: string }>
    >({})

    // 获取配置
    const fetchConfig = async () => {
        try {
            setLoading(true)
            const res = (await proxyApi.get()) as { data?: ProxyConfig }
            if (res?.data) {
                setConfig(res.data)
            } else {
                setConfig({
                    enabled: false,
                    profiles: [],
                    scopes: {
                        browser: { enabled: false, profileId: null },
                        api: { enabled: false, profileId: null },
                        channel: { enabled: false, profileId: null }
                    }
                })
            }
        } catch (error) {
            console.error('Failed to fetch proxy config:', error)
            toast.error('获取代理配置失败')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchConfig()
    }, [])

    // 切换全局启用
    const handleToggleEnabled = async (enabled: boolean) => {
        try {
            await proxyApi.update({ enabled })
            setConfig(prev => (prev ? { ...prev, enabled } : null))
            toast.success(enabled ? '代理已启用' : '代理已禁用')
        } catch (error) {
            console.error('Failed to toggle proxy:', error)
            toast.error('操作失败')
        }
    }

    // 打开新增对话框
    const handleAdd = () => {
        setEditingProfile(null)
        setFormData(defaultFormData)
        setDialogOpen(true)
    }

    // 打开编辑对话框
    const handleEdit = (profile: ProxyProfile) => {
        setEditingProfile(profile)
        setFormData({
            name: profile.name,
            type: profile.type,
            host: profile.host,
            port: String(profile.port),
            username: profile.username || '',
            password: profile.password || '',
            enabled: profile.enabled
        })
        setDialogOpen(true)
    }

    // 删除配置
    const handleDelete = async (id: string) => {
        try {
            await proxyApi.deleteProfile(id)
            setConfig(prev =>
                prev
                    ? {
                          ...prev,
                          profiles: prev.profiles.filter(p => p.id !== id)
                      }
                    : null
            )
            toast.success('删除成功')
        } catch (error) {
            console.error('Failed to delete profile:', error)
            toast.error('删除失败')
        }
    }

    // 保存配置
    const handleSave = async () => {
        if (!formData.host.trim() || !formData.port.trim()) {
            toast.error('请填写主机地址和端口')
            return
        }

        setSaving(true)
        try {
            if (editingProfile) {
                const res = (await proxyApi.updateProfile(editingProfile.id, {
                    name: formData.name || `${formData.type}://${formData.host}:${formData.port}`,
                    type: formData.type,
                    host: formData.host,
                    port: parseInt(formData.port),
                    username: formData.username || undefined,
                    password: formData.password || undefined,
                    enabled: formData.enabled
                })) as { data?: ProxyProfile }

                if (res?.data) {
                    setConfig(prev =>
                        prev
                            ? {
                                  ...prev,
                                  profiles: prev.profiles.map(p => (p.id === editingProfile.id ? res.data! : p))
                              }
                            : null
                    )
                }
                toast.success('更新成功')
            } else {
                const res = (await proxyApi.addProfile({
                    name: formData.name || `${formData.type}://${formData.host}:${formData.port}`,
                    type: formData.type,
                    host: formData.host,
                    port: parseInt(formData.port),
                    username: formData.username || undefined,
                    password: formData.password || undefined,
                    enabled: formData.enabled
                })) as { data?: ProxyProfile }

                if (res?.data) {
                    setConfig(prev =>
                        prev
                            ? {
                                  ...prev,
                                  profiles: [...prev.profiles, res.data!]
                              }
                            : null
                    )
                }
                toast.success('添加成功')
            }
            setDialogOpen(false)
        } catch (error) {
            console.error('Failed to save profile:', error)
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    // 设置作用域代理
    const handleSetScope = async (scope: 'browser' | 'api' | 'channel', profileId: string | null) => {
        try {
            await proxyApi.setScope(scope, profileId, !!profileId)
            setConfig(prev =>
                prev
                    ? {
                          ...prev,
                          scopes: {
                              ...prev.scopes,
                              [scope]: { enabled: !!profileId, profileId }
                          }
                      }
                    : null
            )
            toast.success('设置成功')
        } catch (error) {
            console.error('Failed to set scope:', error)
            toast.error('设置失败')
        }
    }

    // 测试代理
    const handleTest = async (profileId: string) => {
        setTesting(profileId)
        try {
            const res = (await proxyApi.test({ profileId })) as {
                data?: { success: boolean; latency?: number; error?: string }
            }
            if (res?.data) {
                setTestResults(prev => ({ ...prev, [profileId]: res.data! }))
                if (res.data.success) {
                    toast.success(`连接成功，延迟: ${res.data.latency}ms`)
                } else {
                    toast.error(`连接失败: ${res.data.error}`)
                }
            }
        } catch (error) {
            console.error('Failed to test proxy:', error)
            toast.error('测试失败')
        } finally {
            setTesting(null)
        }
    }

    if (loading) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold">代理设置</h1>
                    <p className="text-muted-foreground">配置不同环境的网络代理</p>
                </div>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-32" />
                        <Skeleton className="h-4 w-64" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {[1, 2, 3].map(i => (
                                <Skeleton key={i} className="h-16 w-full" />
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">代理设置</h1>
                    <p className="text-muted-foreground">配置不同环境的网络代理</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">全局启用</span>
                        <Switch checked={config?.enabled || false} onCheckedChange={handleToggleEnabled} />
                    </div>
                    <Button onClick={handleAdd}>
                        <Plus className="h-4 w-4 mr-2" />
                        添加代理
                    </Button>
                </div>
            </div>

            {/* 代理配置列表 */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        代理配置
                    </CardTitle>
                    <CardDescription>管理代理服务器配置，可添加多个代理并分配给不同环境使用</CardDescription>
                </CardHeader>
                <CardContent>
                    {config?.profiles.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <WifiOff className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>暂无代理配置</p>
                            <p className="text-sm mt-1">点击上方「添加代理」按钮开始配置</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>名称</TableHead>
                                    <TableHead>类型</TableHead>
                                    <TableHead>地址</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead className="w-32 text-right">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {config?.profiles.map(profile => {
                                    const testResult = testResults[profile.id]
                                    return (
                                        <TableRow key={profile.id}>
                                            <TableCell className="font-medium">{profile.name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{profile.type.toUpperCase()}</Badge>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {profile.host}:{profile.port}
                                                {profile.username && <span className="ml-2 text-xs">(需认证)</span>}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    {profile.enabled ? (
                                                        <Badge variant="default" className="bg-green-500">
                                                            启用
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary">禁用</Badge>
                                                    )}
                                                    {testResult &&
                                                        (testResult.success ? (
                                                            <Badge variant="outline" className="text-green-500">
                                                                <Check className="h-3 w-3 mr-1" />
                                                                {testResult.latency}ms
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="text-red-500">
                                                                <X className="h-3 w-3 mr-1" />
                                                                失败
                                                            </Badge>
                                                        ))}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleTest(profile.id)}
                                                        disabled={testing === profile.id}
                                                    >
                                                        {testing === profile.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <TestTube className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEdit(profile)}
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDelete(profile.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* 作用域配置 */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Wifi className="h-5 w-5" />
                        环境配置
                    </CardTitle>
                    <CardDescription>为不同的使用环境分配代理配置</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {Object.entries(scopeLabels).map(([scope, { label, description, icon }]) => {
                        const scopeConfig = config?.scopes[scope as keyof typeof config.scopes]
                        const selectedProfile = config?.profiles.find(p => p.id === scopeConfig?.profileId)

                        return (
                            <div key={scope} className="flex items-center justify-between p-4 border rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-muted rounded-lg">{icon}</div>
                                    <div>
                                        <div className="font-medium">{label}</div>
                                        <div className="text-sm text-muted-foreground">{description}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Select
                                        value={scopeConfig?.profileId || 'none'}
                                        onValueChange={value =>
                                            handleSetScope(
                                                scope as 'browser' | 'api' | 'channel',
                                                value === 'none' ? null : value
                                            )
                                        }
                                        disabled={!config?.enabled}
                                    >
                                        <SelectTrigger className="w-48">
                                            <SelectValue placeholder="选择代理" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">
                                                <span className="text-muted-foreground">不使用代理</span>
                                            </SelectItem>
                                            {config?.profiles
                                                .filter(p => p.enabled)
                                                .map(profile => (
                                                    <SelectItem key={profile.id} value={profile.id}>
                                                        {profile.name}
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                    {selectedProfile && scopeConfig?.enabled && (
                                        <Badge variant="outline" className="text-green-500">
                                            <Check className="h-3 w-3 mr-1" />
                                            已配置
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </CardContent>
            </Card>

            {/* 添加/编辑对话框 */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingProfile ? '编辑代理' : '添加代理'}</DialogTitle>
                        <DialogDescription>配置代理服务器信息</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">名称（可选）</Label>
                            <Input
                                id="name"
                                placeholder="例如：本地代理"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>类型</Label>
                                <Select
                                    value={formData.type}
                                    onValueChange={(value: 'http' | 'https' | 'socks5' | 'socks4') =>
                                        setFormData({ ...formData, type: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {proxyTypes.map(t => (
                                            <SelectItem key={t.value} value={t.value}>
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="port">端口</Label>
                                <Input
                                    id="port"
                                    type="number"
                                    placeholder="例如：7890"
                                    value={formData.port}
                                    onChange={e => setFormData({ ...formData, port: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="host">主机地址</Label>
                            <Input
                                id="host"
                                placeholder="例如：127.0.0.1"
                                value={formData.host}
                                onChange={e => setFormData({ ...formData, host: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="username">用户名（可选）</Label>
                                <Input
                                    id="username"
                                    placeholder="认证用户名"
                                    value={formData.username}
                                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">密码（可选）</Label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="认证密码"
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-0 top-0 h-full"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label>启用</Label>
                                <p className="text-sm text-muted-foreground">禁用后此代理将不可选择</p>
                            </div>
                            <Switch
                                checked={formData.enabled}
                                onCheckedChange={checked => setFormData({ ...formData, enabled: checked })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editingProfile ? '保存' : '添加'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
