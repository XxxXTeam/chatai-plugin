'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { configApi, systemApi } from '@/lib/api'
import { toast } from 'sonner'
import { Save, Loader2, Check, Server, Database, AlertTriangle, RefreshCw, Download, Power } from 'lucide-react'

interface SystemConfig {
  web: {
    port: number
    sharePort: boolean
    mountPath: string
    [key: string]: unknown
  }
  update: {
    autoCheck: boolean
    checkOnStart: boolean
    autoUpdate: boolean
    autoRestart: boolean
    notifyMaster: boolean
    [key: string]: unknown
  }
  redis: {
    enabled: boolean
    host: string
    port: number
    password: string
    db: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface ServerModeInfo {
  isTRSS: boolean
  sharePortEnabled: boolean
  currentMode: 'shared' | 'standalone'
  port: number
  canRestart: boolean
}

export default function SystemSettingsPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [serverMode, setServerMode] = useState<ServerModeInfo | null>(null)
  const [restarting, setRestarting] = useState(false)
  const isInitialLoad = useRef(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const debouncedSave = useCallback(async (configToSave: SystemConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await configApi.updateAdvanced(configToSave)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (error) {
        toast.error('自动保存失败')
        console.error(error)
        setSaveStatus('idle')
      }
    }, 800)
  }, [])

  useEffect(() => {
    if (isInitialLoad.current || !config) return
    debouncedSave(config)
  }, [config, debouncedSave])

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await configApi.getAdvanced() as { data: SystemConfig }
        const data = (res.data || {}) as SystemConfig
        setConfig({
          ...data,
          web: {
            ...data?.web,
            port: data?.web?.port ?? 3000,
            sharePort: data?.web?.sharePort ?? true,
            mountPath: data?.web?.mountPath || '/chatai'
          },
          update: {
            ...data?.update,
            autoCheck: data?.update?.autoCheck ?? true,
            checkOnStart: data?.update?.checkOnStart ?? true,
            autoUpdate: data?.update?.autoUpdate ?? false,
            autoRestart: data?.update?.autoRestart ?? false,
            notifyMaster: data?.update?.notifyMaster ?? true
          },
          redis: {
            ...data?.redis,
            enabled: data?.redis?.enabled ?? true,
            host: data?.redis?.host || '127.0.0.1',
            port: data?.redis?.port ?? 6379,
            password: data?.redis?.password ?? '',
            db: data?.redis?.db ?? 0
          }
        })
        setTimeout(() => { isInitialLoad.current = false }, 100)
      } catch (error) {
        toast.error('加载配置失败')
        console.error(error)
      } finally {
        setLoading(false)
      }
    }
    
    const fetchServerMode = async () => {
      try {
        const res = await systemApi.getServerMode() as unknown as { code: number; data: ServerModeInfo }
        if (res?.code === 0) {
          setServerMode(res.data)
        }
      } catch (error) {
        console.error('获取服务器模式失败', error)
      }
    }
    
    fetchConfig()
    fetchServerMode()
  }, [])

  const handleRestart = async (type: 'reload' | 'full') => {
    setRestarting(true)
    try {
      const res = await systemApi.restart(type) as unknown as { code: number; message?: string }
      if (res?.code === 0) {
        toast.success(type === 'full' ? '正在重启Bot...' : '正在重载服务...')
        if (type === 'full') {
          setTimeout(() => window.location.reload(), 3000)
        }
      } else {
        toast.error(res?.message || '操作失败')
      }
    } catch (error) {
      toast.error('请求失败')
      console.error(error)
    } finally {
      setRestarting(false)
    }
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      await configApi.updateAdvanced(config)
      setSaveStatus('saved')
      toast.success('配置已保存，部分设置需要重启生效')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const updateConfig = (path: string, value: unknown) => {
    if (!config) return
    const keys = path.split('.')
    const newConfig = JSON.parse(JSON.stringify(config))
    let obj = newConfig
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {}
      obj = obj[keys[i]]
    }
    obj[keys[keys.length - 1]] = value
    setConfig(newConfig)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!config) {
    return <div>加载失败</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">系统设置</h2>
          <p className="text-muted-foreground">配置插件系统级参数</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {saveStatus === 'saving' && <><Loader2 className="inline h-4 w-4 animate-spin mr-1" />保存中</>}
            {saveStatus === 'saved' && <><Check className="inline h-4 w-4 text-green-500 mr-1" />已保存</>}
            {saveStatus === 'idle' && '自动保存'}
          </span>
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
        </div>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          修改系统设置后需要重启插件才能生效。
        </AlertDescription>
      </Alert>

      {/* 服务器模式 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            服务器模式
          </CardTitle>
          <CardDescription>Web 服务运行模式配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {serverMode && (
            <div className="flex items-center gap-2 mb-4">
              <Badge variant={serverMode.isTRSS ? 'default' : 'secondary'}>
                {serverMode.isTRSS ? 'TRSS 环境' : '标准环境'}
              </Badge>
              <Badge variant={serverMode.currentMode === 'shared' ? 'default' : 'outline'}>
                {serverMode.currentMode === 'shared' ? '共享端口' : '独立端口'}
              </Badge>
              <Badge variant="outline">端口 {serverMode.port}</Badge>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <div>
              <Label>共享端口模式</Label>
              <p className="text-sm text-muted-foreground">
                在 TRSS 环境下与 Bot 共享端口（推荐）
              </p>
            </div>
            <Switch
              checked={config.web?.sharePort ?? true}
              onCheckedChange={(checked) => updateConfig('web.sharePort', checked)}
            />
          </div>

          <Separator />
          
          <div className="grid gap-2">
            <Label htmlFor="webPort">监听端口</Label>
            <Input
              id="webPort"
              type="number"
              min="1"
              max="65535"
              value={config.web?.port || 3000}
              onChange={(e) => updateConfig('web.port', parseInt(e.target.value))}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              独立端口模式下使用的端口，共享端口模式下此配置无效
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 自动更新设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            自动更新
          </CardTitle>
          <CardDescription>插件更新检查和自动更新配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>自动检查更新</Label>
              <p className="text-sm text-muted-foreground">
                每天凌晨 4 点自动检查是否有新版本
              </p>
            </div>
            <Switch
              checked={config.update?.autoCheck ?? true}
              onCheckedChange={(checked) => updateConfig('update.autoCheck', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>启动时检查</Label>
              <p className="text-sm text-muted-foreground">
                Bot 启动时检查是否有新版本
              </p>
            </div>
            <Switch
              checked={config.update?.checkOnStart ?? true}
              onCheckedChange={(checked) => updateConfig('update.checkOnStart', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>通知主人</Label>
              <p className="text-sm text-muted-foreground">
                发现新版本时私聊通知主人
              </p>
            </div>
            <Switch
              checked={config.update?.notifyMaster ?? true}
              onCheckedChange={(checked) => updateConfig('update.notifyMaster', checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>自动更新</Label>
              <p className="text-sm text-muted-foreground text-orange-500">
                检测到新版本时自动执行更新（谨慎开启）
              </p>
            </div>
            <Switch
              checked={config.update?.autoUpdate ?? false}
              onCheckedChange={(checked) => updateConfig('update.autoUpdate', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>更新后自动重启</Label>
              <p className="text-sm text-muted-foreground text-orange-500">
                更新完成后自动重启 Bot（需开启自动更新）
              </p>
            </div>
            <Switch
              checked={config.update?.autoRestart ?? false}
              onCheckedChange={(checked) => updateConfig('update.autoRestart', checked)}
              disabled={!config.update?.autoUpdate}
            />
          </div>
        </CardContent>
      </Card>

      {/* 重启操作 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="h-5 w-5" />
            服务控制
          </CardTitle>
          <CardDescription>重启或重载服务</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={() => handleRestart('reload')}
              disabled={restarting}
            >
              {restarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              重载 Web 服务
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => handleRestart('full')}
              disabled={restarting || !serverMode?.canRestart}
            >
              {restarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
              重启 Bot
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            重载 Web 服务不会中断 Bot 运行，重启 Bot 会断开所有连接
          </p>
        </CardContent>
      </Card>

      {/* Redis 设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Redis 配置
          </CardTitle>
          <CardDescription>Redis 缓存服务配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用 Redis</Label>
              <p className="text-sm text-muted-foreground">
                用于缓存和消息队列
              </p>
            </div>
            <Switch
              checked={config.redis?.enabled ?? true}
              onCheckedChange={(checked) => updateConfig('redis.enabled', checked)}
            />
          </div>
          
          {config.redis?.enabled && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="redisHost">主机地址</Label>
                  <Input
                    id="redisHost"
                    value={config.redis?.host || '127.0.0.1'}
                    onChange={(e) => updateConfig('redis.host', e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="redisPort">端口</Label>
                  <Input
                    id="redisPort"
                    type="number"
                    min="1"
                    max="65535"
                    value={config.redis?.port || 6379}
                    onChange={(e) => updateConfig('redis.port', parseInt(e.target.value))}
                    placeholder="6379"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="redisPassword">密码</Label>
                  <Input
                    id="redisPassword"
                    type="password"
                    value={config.redis?.password || ''}
                    onChange={(e) => updateConfig('redis.password', e.target.value)}
                    placeholder="无密码留空"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="redisDb">数据库</Label>
                  <Input
                    id="redisDb"
                    type="number"
                    min="0"
                    max="15"
                    value={config.redis?.db || 0}
                    onChange={(e) => updateConfig('redis.db', parseInt(e.target.value))}
                    placeholder="0"
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 系统信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            系统信息
          </CardTitle>
          <CardDescription>当前运行环境信息</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">当前监听端口</span>
              <span className="font-mono">{serverMode?.port || config.web?.port || 3000}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Redis 状态</span>
              <span>{config.redis?.enabled ? '已启用' : '已禁用'}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
