'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { configApi } from '@/lib/api'
import { toast } from 'sonner'
import { Save, Loader2, MessageCircle, Users, Timer, Check, Globe, FileText } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'

interface ContextConfig {
  context: {
    maxMessages: number
    maxTokens: number
    isolation: {
      groupUserIsolation: boolean
      privateIsolation: boolean
    }
    autoContext: {
      enabled: boolean
      maxHistoryMessages: number
      includeToolCalls: boolean
    }
    autoEnd: {
      enabled: boolean
      maxRounds: number
      notifyUser: boolean
      notifyMessage: string
    }
  }
}

export default function ContextPage() {
  const [config, setConfig] = useState<ContextConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const isInitialLoad = useRef(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 防抖自动保存
  const debouncedSave = useCallback(async (configToSave: ContextConfig) => {
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
        const res = await configApi.get() as { data: ContextConfig }
        setConfig(res.data)
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
          <h2 className="text-2xl font-bold">上下文配置</h2>
          <p className="text-muted-foreground">配置对话上下文管理</p>
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

      {/* 基础设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            基础设置
          </CardTitle>
          <CardDescription>上下文消息限制</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="maxMessages">最大消息数</Label>
              <Input
                id="maxMessages"
                type="number"
                min="1"
                max="100"
                value={config.context?.maxMessages || 20}
                onChange={(e) => updateConfig('context.maxMessages', parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">保留的历史消息数量</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxTokens">最大Token数</Label>
              <Input
                id="maxTokens"
                type="number"
                min="100"
                max="128000"
                value={config.context?.maxTokens || 4000}
                onChange={(e) => updateConfig('context.maxTokens', parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">上下文Token上限</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 隔离设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            隔离设置
          </CardTitle>
          <CardDescription>用户上下文隔离策略</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>群聊用户隔离</Label>
              <p className="text-sm text-muted-foreground">
                {config.context?.isolation?.groupUserIsolation 
                  ? '每个用户独立上下文' 
                  : '群内共享上下文'}
              </p>
            </div>
            <Switch
              checked={config.context?.isolation?.groupUserIsolation ?? false}
              onCheckedChange={(checked) => updateConfig('context.isolation.groupUserIsolation', checked)}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>私聊用户隔离</Label>
              <p className="text-sm text-muted-foreground">
                {config.context?.isolation?.privateIsolation 
                  ? '每个用户独立上下文' 
                  : '所有私聊共享上下文'}
              </p>
            </div>
            <Switch
              checked={config.context?.isolation?.privateIsolation ?? true}
              onCheckedChange={(checked) => updateConfig('context.isolation.privateIsolation', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 自动上下文 */}
      <Card>
        <CardHeader>
          <CardTitle>自动上下文</CardTitle>
          <CardDescription>自动携带历史消息</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用自动上下文</Label>
              <p className="text-sm text-muted-foreground">自动携带历史消息作为上下文</p>
            </div>
            <Switch
              checked={config.context?.autoContext?.enabled ?? true}
              onCheckedChange={(checked) => updateConfig('context.autoContext.enabled', checked)}
            />
          </div>
          
          {config.context?.autoContext?.enabled !== false && (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label htmlFor="maxHistoryMessages">携带消息数</Label>
                <Input
                  id="maxHistoryMessages"
                  type="number"
                  min="1"
                  max="50"
                  value={config.context?.autoContext?.maxHistoryMessages || 20}
                  onChange={(e) => updateConfig('context.autoContext.maxHistoryMessages', parseInt(e.target.value))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>包含工具调用</Label>
                  <p className="text-sm text-muted-foreground">历史中包含工具调用记录</p>
                </div>
                <Switch
                  checked={config.context?.autoContext?.includeToolCalls ?? false}
                  onCheckedChange={(checked) => updateConfig('context.autoContext.includeToolCalls', checked)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 自动结束 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            自动结束对话
          </CardTitle>
          <CardDescription>达到轮数后自动结束对话</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用自动结束</Label>
              <p className="text-sm text-muted-foreground">对话达到最大轮数后自动结束</p>
            </div>
            <Switch
              checked={config.context?.autoEnd?.enabled ?? false}
              onCheckedChange={(checked) => updateConfig('context.autoEnd.enabled', checked)}
            />
          </div>
          
          {config.context?.autoEnd?.enabled && (
            <>
              <Separator />
              <div className="grid gap-2">
                <Label htmlFor="maxRounds">最大对话轮数</Label>
                <Input
                  id="maxRounds"
                  type="number"
                  min="1"
                  max="1000"
                  value={config.context?.autoEnd?.maxRounds || 50}
                  onChange={(e) => updateConfig('context.autoEnd.maxRounds', parseInt(e.target.value))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>通知用户</Label>
                  <p className="text-sm text-muted-foreground">结束时发送通知消息</p>
                </div>
                <Switch
                  checked={config.context?.autoEnd?.notifyUser ?? true}
                  onCheckedChange={(checked) => updateConfig('context.autoEnd.notifyUser', checked)}
                />
              </div>
              {config.context?.autoEnd?.notifyUser && (
                <div className="grid gap-2">
                  <Label htmlFor="notifyMessage">通知消息</Label>
                  <Input
                    id="notifyMessage"
                    value={config.context?.autoEnd?.notifyMessage || '对话已达到最大轮数限制，已自动开始新会话。'}
                    onChange={(e) => updateConfig('context.autoEnd.notifyMessage', e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 群上下文传递 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            群聊上下文传递
          </CardTitle>
          <CardDescription>控制群聊消息是否作为上下文传递给 AI</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>启用群上下文传递</Label>
              <p className="text-sm text-muted-foreground">
                {(config.context as any)?.groupContextSharing === true || (config.context as any)?.groupContextSharing === undefined
                  ? '群内其他消息会作为上下文传递给 AI' 
                  : '仅传递@消息，不携带群聊上下文'}
              </p>
            </div>
            <Switch
              checked={(config.context as any)?.groupContextSharing === true || (config.context as any)?.groupContextSharing === undefined}
              onCheckedChange={(checked) => updateConfig('context.groupContextSharing', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 全局提示词 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            全局提示词
          </CardTitle>
          <CardDescription>
            对所有对话生效的系统提示词，会追加到预设提示词之后。对于没有预设的对话，这将作为唯一的系统提示词。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="globalSystemPrompt">全局系统提示词</Label>
            <Textarea
              id="globalSystemPrompt"
              value={(config.context as any)?.globalSystemPrompt || ''}
              onChange={(e) => updateConfig('context.globalSystemPrompt', e.target.value)}
              placeholder="输入全局系统提示词，例如：你是一个友善的助手..."
              rows={6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              此提示词会追加到所有对话的系统提示词末尾。留空则不添加。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
