'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { configApi } from '@/lib/api'
import { toast } from 'sonner'
import { Save, Loader2 } from 'lucide-react'

interface Config {
  basic: {
    commandPrefix: string
    autoRecall: {
      enabled: boolean
      delay: number
    }
  }
  llm: {
    defaultModel: string
    models: {
      chat: string
      roleplay: string
      toolCall: string
      search: string
      reasoning: string
    }
  }
  context: {
    maxMessages: number
    autoEnd: {
      enabled: boolean
      maxRounds: number
    }
  }
  bym: {
    enable: boolean
    probability: number
    model: string
  }
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await configApi.get() as { data: Config }
        setConfig(res.data)
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
      toast.success('配置已保存')
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
    const newConfig = { ...config }
    let obj: Record<string, unknown> = newConfig
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>
    }
    obj[keys[keys.length - 1]] = value
    setConfig(newConfig as Config)
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
        <h2 className="text-2xl font-bold">系统设置</h2>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          保存配置
        </Button>
      </div>

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">基础设置</TabsTrigger>
          <TabsTrigger value="llm">模型配置</TabsTrigger>
          <TabsTrigger value="context">上下文</TabsTrigger>
          <TabsTrigger value="bym">伪人模式</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>基础配置</CardTitle>
              <CardDescription>插件基础功能设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="commandPrefix">命令前缀</Label>
                <Input
                  id="commandPrefix"
                  value={config.basic?.commandPrefix || '#ai'}
                  onChange={(e) => updateConfig('basic.commandPrefix', e.target.value)}
                  placeholder="#ai"
                />
              </div>
              
              <Separator />
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>自动撤回</Label>
                    <p className="text-sm text-muted-foreground">自动撤回AI回复消息</p>
                  </div>
                  <Switch
                    checked={config.basic?.autoRecall?.enabled || false}
                    onCheckedChange={(checked) => updateConfig('basic.autoRecall.enabled', checked)}
                  />
                </div>
                
                {config.basic?.autoRecall?.enabled && (
                  <div className="grid gap-2">
                    <Label htmlFor="recallDelay">撤回延迟（秒）</Label>
                    <Input
                      id="recallDelay"
                      type="number"
                      value={config.basic?.autoRecall?.delay || 60}
                      onChange={(e) => updateConfig('basic.autoRecall.delay', parseInt(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="llm" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>模型配置</CardTitle>
              <CardDescription>AI模型分类设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="defaultModel">默认模型</Label>
                <Input
                  id="defaultModel"
                  value={config.llm?.defaultModel || ''}
                  onChange={(e) => updateConfig('llm.defaultModel', e.target.value)}
                  placeholder="gpt-4o"
                />
              </div>
              
              <Separator />
              <p className="text-sm text-muted-foreground">模型分类（可选，留空使用默认模型）</p>
              
              {['chat', 'roleplay', 'toolCall', 'search', 'reasoning'].map((key) => (
                <div key={key} className="grid gap-2">
                  <Label htmlFor={key}>
                    {key === 'chat' && '对话模型'}
                    {key === 'roleplay' && '伪人模型'}
                    {key === 'toolCall' && '工具调用模型'}
                    {key === 'search' && '搜索模型'}
                    {key === 'reasoning' && '思考模型'}
                  </Label>
                  <Input
                    id={key}
                    value={(config.llm?.models as Record<string, string>)?.[key] || ''}
                    onChange={(e) => updateConfig(`llm.models.${key}`, e.target.value)}
                    placeholder="留空使用默认模型"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="context" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>上下文设置</CardTitle>
              <CardDescription>对话上下文管理</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="maxMessages">最大上下文消息数</Label>
                <Input
                  id="maxMessages"
                  type="number"
                  value={config.context?.maxMessages || 20}
                  onChange={(e) => updateConfig('context.maxMessages', parseInt(e.target.value))}
                />
              </div>
              
              <Separator />
              
              <div className="flex items-center justify-between">
                <div>
                  <Label>定量自动结束对话</Label>
                  <p className="text-sm text-muted-foreground">达到最大轮数后自动结束对话</p>
                </div>
                <Switch
                  checked={config.context?.autoEnd?.enabled || false}
                  onCheckedChange={(checked) => updateConfig('context.autoEnd.enabled', checked)}
                />
              </div>
              
              {config.context?.autoEnd?.enabled && (
                <div className="grid gap-2">
                  <Label htmlFor="maxRounds">最大对话轮数</Label>
                  <Input
                    id="maxRounds"
                    type="number"
                    value={config.context?.autoEnd?.maxRounds || 50}
                    onChange={(e) => updateConfig('context.autoEnd.maxRounds', parseInt(e.target.value))}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bym" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>伪人模式</CardTitle>
              <CardDescription>模拟真人回复设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>启用伪人模式</Label>
                  <p className="text-sm text-muted-foreground">AI回复更像真人</p>
                </div>
                <Switch
                  checked={config.bym?.enable || false}
                  onCheckedChange={(checked) => updateConfig('bym.enable', checked)}
                />
              </div>
              
              {config.bym?.enable && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="probability">触发概率 (%)</Label>
                    <Input
                      id="probability"
                      type="number"
                      min="0"
                      max="100"
                      value={config.bym?.probability || 30}
                      onChange={(e) => updateConfig('bym.probability', parseInt(e.target.value))}
                    />
                  </div>
                  
                  <div className="grid gap-2">
                    <Label htmlFor="bymModel">使用模型</Label>
                    <Input
                      id="bymModel"
                      value={config.bym?.model || ''}
                      onChange={(e) => updateConfig('bym.model', e.target.value)}
                      placeholder="留空使用默认模型"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
