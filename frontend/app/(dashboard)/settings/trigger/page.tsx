'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { configApi } from '@/lib/api'
import { toast } from 'sonner'
import { Save, Loader2, Plus, X, MessageSquare, Users, User, Check } from 'lucide-react'

interface TriggerConfig {
  trigger: {
    prefixes: string[]
    keywords?: string[]
    collectGroupMsg?: boolean
    blacklistUsers?: string[]
    whitelistUsers?: string[]
    blacklistGroups?: string[]
    whitelistGroups?: string[]
    private: {
      enabled: boolean
      mode: 'always' | 'prefix' | 'at'
      [key: string]: unknown
    }
    group: {
      enabled: boolean
      at: boolean
      prefix: boolean
      keyword?: boolean
      random?: boolean
      randomRate?: number
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export default function TriggerPage() {
  const [config, setConfig] = useState<TriggerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newPrefix, setNewPrefix] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const isInitialLoad = useRef(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 防抖自动保存
  const debouncedSave = useCallback(async (configToSave: TriggerConfig) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await configApi.update(configToSave)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (error) {
        toast.error('自动保存失败')
        console.error(error)
        setSaveStatus('idle')
      }
    }, 800)
  }, [])

  // 监听配置变化自动保存
  useEffect(() => {
    if (isInitialLoad.current || !config) return
    debouncedSave(config)
  }, [config, debouncedSave])

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await configApi.get() as { data: TriggerConfig }
        // 保留完整配置，确保不丢失其他字段
        const data = res.data || {} as TriggerConfig
        setConfig({
          ...data,
          trigger: {
            ...data.trigger,
            prefixes: data.trigger?.prefixes || [],
            private: {
              ...data.trigger?.private,
              enabled: data.trigger?.private?.enabled ?? true,
              mode: data.trigger?.private?.mode || 'prefix'
            },
            group: {
              ...data.trigger?.group,
              enabled: data.trigger?.group?.enabled ?? true,
              at: data.trigger?.group?.at ?? true,
              prefix: data.trigger?.group?.prefix ?? true
            }
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
      await configApi.update(config)
      setSaveStatus('saved')
      toast.success('配置已保存')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const addPrefix = () => {
    if (!newPrefix.trim() || !config) return
    if (config.trigger?.prefixes?.includes(newPrefix.trim())) {
      toast.error('前缀已存在')
      return
    }
    const prefixes = [...(config.trigger?.prefixes || []), newPrefix.trim()]
    setConfig({
      ...config,
      trigger: { ...config.trigger, prefixes }
    })
    setNewPrefix('')
  }

  const removePrefix = (prefix: string) => {
    if (!config) return
    const prefixes = (config.trigger?.prefixes || []).filter(p => p !== prefix)
    setConfig({
      ...config,
      trigger: { ...config.trigger, prefixes }
    })
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
          <h2 className="text-2xl font-bold">触发配置</h2>
          <p className="text-muted-foreground">配置AI响应触发方式</p>
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

      {/* 触发前缀 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            触发前缀
          </CardTitle>
          <CardDescription>设置触发AI响应的消息前缀</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newPrefix}
              onChange={(e) => setNewPrefix(e.target.value)}
              placeholder="输入新前缀，如 #chat"
              onKeyDown={(e) => e.key === 'Enter' && addPrefix()}
            />
            <Button onClick={addPrefix}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(config.trigger?.prefixes || []).map((prefix) => (
              <Badge key={prefix} variant="secondary" className="text-sm py-1 px-3">
                {prefix}
                <button
                  onClick={() => removePrefix(prefix)}
                  className="ml-2 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {(!config.trigger?.prefixes || config.trigger.prefixes.length === 0) && (
              <p className="text-sm text-muted-foreground">暂无前缀，点击上方添加</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 私聊设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            私聊设置
          </CardTitle>
          <CardDescription>配置私聊消息触发方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用私聊响应</Label>
              <p className="text-sm text-muted-foreground">允许在私聊中与AI对话</p>
            </div>
            <Switch
              checked={config.trigger?.private?.enabled ?? true}
              onCheckedChange={(checked) => setConfig({
                ...config,
                trigger: {
                  ...config.trigger,
                  private: { ...config.trigger?.private, enabled: checked }
                }
              })}
            />
          </div>

          {config.trigger?.private?.enabled !== false && (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label>触发模式</Label>
                <Select
                  value={config.trigger?.private?.mode || 'prefix'}
                  onValueChange={(value: 'always' | 'prefix' | 'at') => setConfig({
                    ...config,
                    trigger: {
                      ...config.trigger,
                      private: { ...config.trigger?.private, mode: value }
                    }
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">始终响应</SelectItem>
                    <SelectItem value="prefix">前缀触发</SelectItem>
                    <SelectItem value="at">@触发</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {config.trigger?.private?.mode === 'always' && '所有私聊消息都会触发AI响应'}
                  {config.trigger?.private?.mode === 'prefix' && '需要使用触发前缀才会响应'}
                  {config.trigger?.private?.mode === 'at' && '需要@机器人才会响应'}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 群聊设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            群聊设置
          </CardTitle>
          <CardDescription>配置群聊消息触发方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用群聊响应</Label>
              <p className="text-sm text-muted-foreground">允许在群聊中与AI对话</p>
            </div>
            <Switch
              checked={config.trigger?.group?.enabled ?? true}
              onCheckedChange={(checked) => setConfig({
                ...config,
                trigger: {
                  ...config.trigger,
                  group: { ...config.trigger?.group, enabled: checked }
                }
              })}
            />
          </div>

          {config.trigger?.group?.enabled !== false && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>@机器人触发</Label>
                    <p className="text-sm text-muted-foreground">@机器人时响应</p>
                  </div>
                  <Switch
                    checked={config.trigger?.group?.at ?? true}
                    onCheckedChange={(checked) => setConfig({
                      ...config,
                      trigger: {
                        ...config.trigger,
                        group: { ...config.trigger?.group, at: checked }
                      }
                    })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>前缀触发</Label>
                    <p className="text-sm text-muted-foreground">使用触发前缀时响应</p>
                  </div>
                  <Switch
                    checked={config.trigger?.group?.prefix ?? true}
                    onCheckedChange={(checked) => setConfig({
                      ...config,
                      trigger: {
                        ...config.trigger,
                        group: { ...config.trigger?.group, prefix: checked }
                      }
                    })}
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
