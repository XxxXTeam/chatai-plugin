'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import {
  AlertCircle, Loader2, Save, Settings, Zap, Sparkles, BookOpen,
  RefreshCw, Power, X, Image, MessageSquare, PartyPopper, Palette, Bot, Users, Clock
} from 'lucide-react'

interface Channel {
  id: string
  name: string
  provider: string
}

interface Preset {
  id: string
  name: string
}

interface GroupConfig {
  groupId: string
  groupName: string
  systemPrompt: string
  presetId: string
  triggerMode: string
  customPrefix: string
  enabled: boolean
  toolsEnabled?: boolean | string
  imageGenEnabled?: boolean | string
  summaryEnabled?: boolean | string
  eventHandler?: boolean | string
  emojiThief: {
    enabled: boolean
    independent: boolean
    maxCount: number
    probability: number
  }
  bym: {
    enabled?: boolean | string
    presetId: string
    prompt?: string
    probability?: number
    modelId: string
    temperature?: number
    maxTokens?: number
  }
  models: {
    chat: string
    tools: string
    dispatch: string
    vision: string
    image: string
    search: string
    bym: string
    summary: string
    profile: string
  }
  blacklist: string[]
  whitelist: string[]
  listMode: string
  summaryPush: {
    enabled: boolean
    intervalType: 'day' | 'hour'
    intervalValue: number
    pushHour?: number
  }
  presets: Preset[]
  channels: Channel[]
}

export default function GroupAdminPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [groupId, setGroupId] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [formTab, setFormTab] = useState('basic')

  const [form, setForm] = useState({
    groupId: '',
    groupName: '',
    presetId: '__default__',
    systemPrompt: '',
    enabled: true,
    triggerMode: 'default',
    customPrefix: '',
    // 功能开关
    toolsEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    imageGenEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    imageGenModel: '',
    summaryEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    summaryModel: '',
    eventEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    // 表情小偷
    emojiThiefEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    emojiThiefSeparateFolder: true,
    emojiThiefMaxCount: 500,
    emojiThiefStealRate: 1.0,
    // 伪人
    bymEnabled: 'inherit' as 'inherit' | 'on' | 'off',
    bymPresetId: '__default__',
    bymPrompt: '',
    bymProbability: 'inherit' as 'inherit' | number,
    bymModel: '',
    bymTemperature: 'inherit' as 'inherit' | number,
    bymMaxTokens: 'inherit' as 'inherit' | number,
    // 模型配置
    chatModel: '',
    toolModel: '',
    dispatchModel: '',
    imageModel: '',
    drawModel: '',
    searchModel: '',
    roleplayModel: '',
    profileModel: '',
    // 黑白名单
    listMode: 'none',
    blacklist: [] as string[],
    whitelist: [] as string[],
    // 定时推送
    summaryPushEnabled: false,
    summaryPushIntervalType: 'day' as 'day' | 'hour',
    summaryPushIntervalValue: 1,
    summaryPushHour: 20,
  })

  const [presets, setPresets] = useState<Preset[]>([])
  const [allModels, setAllModels] = useState<string[]>([])

  useEffect(() => {
    const token = localStorage.getItem('group_admin_token')
    const info = localStorage.getItem('group_admin_info')
    if (!token || !info) {
      setError('未找到群管理员认证信息，请重新获取链接')
      setLoading(false)
      return
    }
    try {
      const parsed = JSON.parse(info)
      setGroupId(parsed.groupId)
      loadConfig(token)
    } catch {
      setError('认证信息解析失败')
      setLoading(false)
    }
  }, [])

  const getToken = () => localStorage.getItem('group_admin_token') || ''

  const loadConfig = async (token?: string) => {
    try {
      const res = await fetch('/api/group-admin/config', {
        headers: { 'Authorization': `Bearer ${token || getToken()}` }
      })
      if (!res.ok) {
        if (res.status === 401) { setError('认证已过期，请重新获取链接'); return }
        throw new Error('加载配置失败')
      }
      const data = await res.json()
      if (data.code === 0) {
        const c = data.data as GroupConfig
        setGroupId(c.groupId)
        setPresets(c.presets || [])
        
        // 提取所有模型
        const models = new Set<string>()
        c.channels?.forEach(ch => {
          if (ch.name) models.add(ch.name)
        })
        setAllModels(Array.from(models).sort())

        // 填充表单
        setForm({
          groupId: c.groupId,
          groupName: c.groupName || '',
          presetId: c.presetId || '__default__',
          systemPrompt: c.systemPrompt || '',
          enabled: c.enabled !== false,
          triggerMode: c.triggerMode || 'default',
          customPrefix: c.customPrefix || '',
          toolsEnabled: c.toolsEnabled === undefined ? 'inherit' : c.toolsEnabled === 'true' || c.toolsEnabled === true ? 'on' : 'off',
          imageGenEnabled: c.imageGenEnabled === undefined ? 'inherit' : c.imageGenEnabled === 'true' || c.imageGenEnabled === true ? 'on' : 'off',
          imageGenModel: c.models?.image || '',
          summaryEnabled: c.summaryEnabled === undefined ? 'inherit' : c.summaryEnabled === 'true' || c.summaryEnabled === true ? 'on' : 'off',
          summaryModel: c.models?.summary || '',
          eventEnabled: c.eventHandler === undefined ? 'inherit' : c.eventHandler === 'true' || c.eventHandler === true ? 'on' : 'off',
          emojiThiefEnabled: c.emojiThief?.enabled === undefined ? 'inherit' : c.emojiThief.enabled ? 'on' : 'off',
          emojiThiefSeparateFolder: c.emojiThief?.independent ?? true,
          emojiThiefMaxCount: c.emojiThief?.maxCount ?? 500,
          emojiThiefStealRate: (c.emojiThief?.probability ?? 100) / 100,
          bymEnabled: c.bym?.enabled === undefined ? 'inherit' : c.bym.enabled === 'true' || c.bym.enabled === true ? 'on' : 'off',
          bymPresetId: c.bym?.presetId || '__default__',
          bymPrompt: c.bym?.prompt || '',
          bymProbability: c.bym?.probability === undefined ? 'inherit' : c.bym.probability,
          bymModel: c.bym?.modelId || '',
          bymTemperature: c.bym?.temperature === undefined ? 'inherit' : c.bym.temperature,
          bymMaxTokens: c.bym?.maxTokens === undefined ? 'inherit' : c.bym.maxTokens,
          chatModel: c.models?.chat || '',
          toolModel: c.models?.tools || '',
          dispatchModel: c.models?.dispatch || '',
          imageModel: c.models?.vision || '',
          drawModel: c.models?.image || '',
          searchModel: c.models?.search || '',
          roleplayModel: c.models?.bym || '',
          profileModel: c.models?.profile || '',
          listMode: c.listMode || 'none',
          blacklist: c.blacklist || [],
          whitelist: c.whitelist || [],
          summaryPushEnabled: c.summaryPush?.enabled || false,
          summaryPushIntervalType: c.summaryPush?.intervalType || 'day',
          summaryPushIntervalValue: c.summaryPush?.intervalValue || 1,
          summaryPushHour: c.summaryPush?.pushHour ?? 20,
        })
      } else {
        throw new Error(data.message || '加载失败')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/group-admin/config', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName: form.groupName,
          systemPrompt: form.systemPrompt || null,
          presetId: form.presetId === '__default__' ? '' : form.presetId,
          enabled: form.enabled,
          triggerMode: form.triggerMode,
          customPrefix: form.customPrefix || undefined,
          toolsEnabled: form.toolsEnabled === 'inherit' ? undefined : form.toolsEnabled === 'on',
          imageGenEnabled: form.imageGenEnabled === 'inherit' ? undefined : form.imageGenEnabled === 'on',
          summaryEnabled: form.summaryEnabled === 'inherit' ? undefined : form.summaryEnabled === 'on',
          eventHandler: form.eventEnabled === 'inherit' ? undefined : form.eventEnabled === 'on',
          emojiThief: {
            enabled: form.emojiThiefEnabled === 'inherit' ? undefined : form.emojiThiefEnabled === 'on',
            independent: form.emojiThiefSeparateFolder,
            maxCount: form.emojiThiefMaxCount,
            probability: Math.round(form.emojiThiefStealRate * 100),
          },
          bym: {
            enabled: form.bymEnabled === 'inherit' ? undefined : form.bymEnabled === 'on',
            presetId: form.bymPresetId === '__default__' ? undefined : form.bymPresetId,
            prompt: form.bymPrompt || undefined,
            probability: form.bymProbability === 'inherit' ? undefined : form.bymProbability,
            modelId: form.bymModel || undefined,
            temperature: form.bymTemperature === 'inherit' ? undefined : form.bymTemperature,
            maxTokens: form.bymMaxTokens === 'inherit' ? undefined : form.bymMaxTokens,
          },
          models: {
            chat: form.chatModel || undefined,
            tools: form.toolModel || undefined,
            dispatch: form.dispatchModel || undefined,
            vision: form.imageModel || undefined,
            image: form.drawModel || undefined,
            search: form.searchModel || undefined,
            bym: form.roleplayModel || undefined,
            summary: form.summaryModel || undefined,
            profile: form.profileModel || undefined,
          },
          listMode: form.listMode,
          blacklist: form.blacklist,
          whitelist: form.whitelist,
          summaryPush: {
            enabled: form.summaryPushEnabled,
            intervalType: form.summaryPushIntervalType,
            intervalValue: form.summaryPushIntervalValue,
            pushHour: form.summaryPushHour,
          },
        })
      })
      if (!res.ok) {
        if (res.status === 401) { setError('认证已过期'); return }
        throw new Error('保存失败')
      }
      const data = await res.json()
      if (data.code === 0) toast.success('配置已保存')
      else throw new Error(data.message || '保存失败')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
            <h2 className="mt-4 text-xl font-semibold">{error}</h2>
            <p className="mt-2 text-sm text-gray-500">请在群内发送 #ai群管理面板 重新获取链接</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-6">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">群聊设置</h1>
            <p className="text-sm text-muted-foreground">群号: <Badge variant="secondary">{groupId}</Badge></p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => loadConfig()}>
              <RefreshCw className="h-4 w-4 mr-1" /> 刷新
            </Button>
            <Button size="sm" onClick={saveConfig} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              保存
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <Tabs value={formTab} onValueChange={setFormTab}>
              <TabsList className="grid w-full grid-cols-4 mb-4">
                <TabsTrigger value="basic"><Settings className="h-4 w-4 mr-1 hidden sm:inline" />基础</TabsTrigger>
                <TabsTrigger value="features"><Zap className="h-4 w-4 mr-1 hidden sm:inline" />功能</TabsTrigger>
                <TabsTrigger value="bym"><Sparkles className="h-4 w-4 mr-1 hidden sm:inline" />伪人</TabsTrigger>
                <TabsTrigger value="advanced"><BookOpen className="h-4 w-4 mr-1 hidden sm:inline" />高级</TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[60vh] pr-4">
                {/* 基础设置 */}
                <TabsContent value="basic" className="space-y-4 mt-0">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>群号</Label>
                      <Input value={form.groupId} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label>群名称</Label>
                      <Input value={form.groupName} onChange={e => setForm({...form, groupName: e.target.value})} placeholder="可选，便于识别" />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>使用预设</Label>
                      <Select value={form.presetId} onValueChange={v => setForm({...form, presetId: v})}>
                        <SelectTrigger><SelectValue placeholder="使用默认预设" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">使用默认预设</SelectItem>
                          {presets.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>触发模式</Label>
                      <Select value={form.triggerMode} onValueChange={v => setForm({...form, triggerMode: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">默认</SelectItem>
                          <SelectItem value="at">仅@触发</SelectItem>
                          <SelectItem value="prefix">仅前缀触发</SelectItem>
                          <SelectItem value="all">全部消息</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>自定义前缀</Label>
                    <Input value={form.customPrefix} onChange={e => setForm({...form, customPrefix: e.target.value})} placeholder="留空使用全局前缀，如 #ai" />
                  </div>

                  <div className="space-y-2">
                    <Label>独立人设</Label>
                    <Textarea value={form.systemPrompt} onChange={e => setForm({...form, systemPrompt: e.target.value})} placeholder="不填写则使用预设配置..." rows={3} className="font-mono text-sm" />
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Power className="h-4 w-4" />
                      <Label>启用AI响应</Label>
                    </div>
                    <Switch checked={form.enabled} onCheckedChange={v => setForm({...form, enabled: v})} />
                  </div>
                </TabsContent>

                {/* 功能设置 */}
                <TabsContent value="features" className="space-y-3 mt-0">
                  <p className="text-xs text-muted-foreground mb-2">群管理员也可通过命令控制这些功能</p>

                  <FeatureItem icon={<Zap className="h-4 w-4" />} title="工具调用" desc="允许AI使用搜索、代码执行等工具"
                    value={form.toolsEnabled} onChange={v => setForm({...form, toolsEnabled: v})} />

                  <FeatureItem icon={<Image className="h-4 w-4" />} title="绘图功能" desc="文生图、图生图等"
                    value={form.imageGenEnabled} onChange={v => setForm({...form, imageGenEnabled: v})} />
                  {form.imageGenEnabled === 'on' && (
                    <ModelSubSelect label="绘图模型" value={form.imageGenModel} models={allModels}
                      onChange={v => setForm({...form, imageGenModel: v})} />
                  )}

                  <FeatureItem icon={<MessageSquare className="h-4 w-4" />} title="群聊总结" desc="允许使用群聊总结"
                    value={form.summaryEnabled} onChange={v => setForm({...form, summaryEnabled: v})} />
                  {form.summaryEnabled === 'on' && (
                    <ModelSubSelect label="总结模型" value={form.summaryModel} models={allModels}
                      onChange={v => setForm({...form, summaryModel: v})} />
                  )}

                  <FeatureItem icon={<PartyPopper className="h-4 w-4" />} title="事件处理" desc="入群欢迎、退群提醒"
                    value={form.eventEnabled} onChange={v => setForm({...form, eventEnabled: v})} />

                  <FeatureItem icon={<Palette className="h-4 w-4" />} title="表情小偷" desc="收集并发送表情包"
                    value={form.emojiThiefEnabled} onChange={v => setForm({...form, emojiThiefEnabled: v})} />
                  {form.emojiThiefEnabled !== 'off' && (
                    <div className="ml-4 pl-4 border-l-2 border-muted space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">独立存储</Label>
                        <Switch checked={form.emojiThiefSeparateFolder} onCheckedChange={v => setForm({...form, emojiThiefSeparateFolder: v})} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">最大数量</Label>
                          <Input type="number" min={10} max={5000} value={form.emojiThiefMaxCount}
                            onChange={e => setForm({...form, emojiThiefMaxCount: parseInt(e.target.value) || 500})} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">偷取概率 (%)</Label>
                          <Input type="number" min={1} max={100} value={Math.round(form.emojiThiefStealRate * 100)}
                            onChange={e => setForm({...form, emojiThiefStealRate: parseInt(e.target.value) / 100})} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 黑白名单 */}
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-muted"><Users className="h-4 w-4" /></div>
                        <div>
                          <p className="text-sm font-medium">用户权限管理</p>
                          <p className="text-xs text-muted-foreground">设置黑白名单</p>
                        </div>
                      </div>
                      <Select value={form.listMode} onValueChange={v => setForm({...form, listMode: v})}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">不启用</SelectItem>
                          <SelectItem value="blacklist">黑名单</SelectItem>
                          <SelectItem value="whitelist">白名单</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.listMode === 'blacklist' && (
                      <Textarea className="mt-2 font-mono" placeholder="每行一个QQ号"
                        value={form.blacklist.join('\n')}
                        onChange={e => setForm({...form, blacklist: e.target.value.split('\n').filter(Boolean)})} />
                    )}
                    {form.listMode === 'whitelist' && (
                      <Textarea className="mt-2 font-mono" placeholder="每行一个QQ号"
                        value={form.whitelist.join('\n')}
                        onChange={e => setForm({...form, whitelist: e.target.value.split('\n').filter(Boolean)})} />
                    )}
                  </div>

                  {/* 定时推送 */}
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-muted"><Clock className="h-4 w-4" /></div>
                        <div>
                          <p className="text-sm font-medium">定时总结推送</p>
                          <p className="text-xs text-muted-foreground">定期推送群聊总结报告</p>
                        </div>
                      </div>
                      <Switch checked={form.summaryPushEnabled} onCheckedChange={v => setForm({...form, summaryPushEnabled: v})} />
                    </div>
                    {form.summaryPushEnabled && (
                      <div className="ml-4 pl-4 border-l-2 border-muted space-y-3 mt-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">间隔类型</Label>
                            <Select value={form.summaryPushIntervalType} onValueChange={(v: 'day' | 'hour') => setForm({...form, summaryPushIntervalType: v})}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="day">按天</SelectItem>
                                <SelectItem value="hour">按小时</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">间隔值</Label>
                            <Input type="number" min={1} value={form.summaryPushIntervalValue}
                              onChange={e => setForm({...form, summaryPushIntervalValue: parseInt(e.target.value) || 1})} />
                          </div>
                        </div>
                        {form.summaryPushIntervalType === 'day' && (
                          <div className="space-y-1">
                            <Label className="text-xs">推送时间 (0-23点)</Label>
                            <Input type="number" min={0} max={23} value={form.summaryPushHour}
                              onChange={e => setForm({...form, summaryPushHour: parseInt(e.target.value)})} className="w-24" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* 伪人设置 */}
                <TabsContent value="bym" className="space-y-4 mt-0">
                  <FeatureItem icon={<Sparkles className="h-4 w-4 text-purple-500" />} title="伪人模式" desc="随机回复，模拟真人聊天"
                    value={form.bymEnabled} onChange={v => setForm({...form, bymEnabled: v})} />

                  {form.bymEnabled !== 'off' && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>伪人人设</Label>
                        <Select value={form.bymPresetId} onValueChange={v => setForm({...form, bymPresetId: v})}>
                          <SelectTrigger><SelectValue placeholder="选择人设..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">使用默认预设</SelectItem>
                            <SelectItem value="__custom__">自定义提示词</SelectItem>
                            {presets.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {form.bymPresetId === '__custom__' && (
                        <div className="space-y-2">
                          <Label>自定义提示词</Label>
                          <Textarea value={form.bymPrompt} onChange={e => setForm({...form, bymPrompt: e.target.value})}
                            placeholder="你是一个真实的群友..." rows={3} className="font-mono text-sm" />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">触发概率</Label>
                          {form.bymProbability === 'inherit' ? (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({...form, bymProbability: 0.02})}>
                              继承全局
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input type="number" min={0} max={100} className="w-20"
                                value={typeof form.bymProbability === 'number' ? Math.round(form.bymProbability * 100) : 2}
                                onChange={e => setForm({...form, bymProbability: parseInt(e.target.value) / 100})} />
                              <span className="text-sm">%</span>
                              <Button variant="ghost" size="sm" onClick={() => setForm({...form, bymProbability: 'inherit'})}><X className="h-3 w-3" /></Button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">使用模型</Label>
                          <Select value={form.bymModel || '__default__'} onValueChange={v => setForm({...form, bymModel: v === '__default__' ? '' : v})}>
                            <SelectTrigger><SelectValue placeholder="继承" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">继承全局</SelectItem>
                              {allModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-sm">温度</Label>
                          {form.bymTemperature === 'inherit' ? (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({...form, bymTemperature: 0.9})}>
                              继承全局
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input type="number" min={0} max={2} step={0.1}
                                value={typeof form.bymTemperature === 'number' ? form.bymTemperature : 0.9}
                                onChange={e => setForm({...form, bymTemperature: parseFloat(e.target.value)})} />
                              <Button variant="ghost" size="sm" onClick={() => setForm({...form, bymTemperature: 'inherit'})}><X className="h-3 w-3" /></Button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">最大Token</Label>
                          {form.bymMaxTokens === 'inherit' ? (
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setForm({...form, bymMaxTokens: 100})}>
                              继承全局
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Input type="number" min={10} max={2000}
                                value={typeof form.bymMaxTokens === 'number' ? form.bymMaxTokens : 100}
                                onChange={e => setForm({...form, bymMaxTokens: parseInt(e.target.value)})} />
                              <Button variant="ghost" size="sm" onClick={() => setForm({...form, bymMaxTokens: 'inherit'})}><X className="h-3 w-3" /></Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* 高级设置 */}
                <TabsContent value="advanced" className="space-y-4 mt-0">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <Label>模型配置</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">为本群配置各场景独立模型（留空使用全局配置）</p>

                    <div className="space-y-3">
                      <ModelConfigItem label="对话模型" desc="主模型" value={form.chatModel} models={allModels}
                        onChange={v => setForm({...form, chatModel: v})} />
                      <ModelConfigItem label="工具模型" desc="需要调用工具时" value={form.toolModel} models={allModels}
                        onChange={v => setForm({...form, toolModel: v})} />
                      <ModelConfigItem label="调度模型" desc="工具组分类" value={form.dispatchModel} models={allModels}
                        onChange={v => setForm({...form, dispatchModel: v})} />
                      <ModelConfigItem label="图像理解模型" desc="分析图片" value={form.imageModel} models={allModels}
                        onChange={v => setForm({...form, imageModel: v})} />
                      <ModelConfigItem label="绘图模型" desc="生成图片" value={form.drawModel} models={allModels}
                        onChange={v => setForm({...form, drawModel: v})} />
                      <ModelConfigItem label="搜索模型" desc="联网搜索" value={form.searchModel} models={allModels}
                        onChange={v => setForm({...form, searchModel: v})} />
                      <ModelConfigItem label="伪人模型" desc="模拟真人" value={form.roleplayModel} models={allModels}
                        onChange={v => setForm({...form, roleplayModel: v})} />
                      <ModelConfigItem label="总结模型" desc="群聊总结" value={form.summaryModel} models={allModels}
                        onChange={v => setForm({...form, summaryModel: v})} />
                      <ModelConfigItem label="画像模型" desc="用户画像分析" value={form.profileModel} models={allModels}
                        onChange={v => setForm({...form, profileModel: v})} />
                    </div>
                  </div>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>ChatGPT Plugin 群管理面板 · 群 {groupId}</p>
        </div>
      </div>
    </div>
  )
}

function FeatureItem({ icon, title, desc, value, onChange }: {
  icon: React.ReactNode, title: string, desc: string,
  value: 'inherit' | 'on' | 'off', onChange: (v: 'inherit' | 'on' | 'off') => void
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted">{icon}</div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">继承</SelectItem>
          <SelectItem value="on">开启</SelectItem>
          <SelectItem value="off">关闭</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function ModelSubSelect({ label, value, models, onChange }: {
  label: string, value: string, models: string[], onChange: (v: string) => void
}) {
  return (
    <div className="ml-4 pl-4 border-l-2 border-muted space-y-2">
      <Label className="text-xs">{label}</Label>
      <Select value={value || '__default__'} onValueChange={v => onChange(v === '__default__' ? '' : v)}>
        <SelectTrigger><SelectValue placeholder="继承全局" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">继承全局</SelectItem>
          {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}

function ModelConfigItem({ label, desc, value, models, onChange }: {
  label: string, desc: string, value: string, models: string[], onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label} <span className="text-muted-foreground">（{desc}）</span></Label>
      <Select value={value || '__default__'} onValueChange={v => onChange(v === '__default__' ? '' : v)}>
        <SelectTrigger><SelectValue placeholder="使用全局配置" /></SelectTrigger>
        <SelectContent className="max-h-[200px] overflow-y-auto">
          <SelectItem value="__default__">使用全局配置</SelectItem>
          {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
