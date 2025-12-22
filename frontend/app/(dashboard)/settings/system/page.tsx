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
import { configApi } from '@/lib/api'
import { toast } from 'sonner'
import { Save, Loader2, Check, Server, Database, Globe, AlertTriangle } from 'lucide-react'

interface SystemConfig {
  web: {
    port: number
  }
  redis: {
    enabled: boolean
    host: string
    port: number
    password: string
    db: number
  }
}

export default function SystemSettingsPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
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
        const res = await configApi.getAdvanced()
        const data = (res as { data: SystemConfig }).data
        setConfig({
          web: {
            port: data?.web?.port || 3000
          },
          redis: {
            enabled: data?.redis?.enabled ?? true,
            host: data?.redis?.host || '127.0.0.1',
            port: data?.redis?.port || 6379,
            password: data?.redis?.password || '',
            db: data?.redis?.db || 0
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
    fetchConfig()
  }, [])

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

      {/* Web 服务设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Web 服务
          </CardTitle>
          <CardDescription>管理面板和 API 服务配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              管理面板和 API 服务的监听端口，默认 3000。修改后需要重启生效。
            </p>
          </div>
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
              <span className="font-mono">{config.web?.port || 3000}</span>
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
