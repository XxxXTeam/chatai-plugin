'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import { PageHeader, PageContainer } from '@/components/layout/PageHeader'
import { channelsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Trash2, TestTube, Loader2, Plug, RefreshCw, Download, Eye, EyeOff, List, CheckCircle, XCircle, ChevronDown, ChevronUp, Settings2, Upload, FileDown, X, Zap, Globe, Key, Layers, MoreHorizontal, Copy, Power, PowerOff } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ModelSelector } from '@/components/ModelSelector'

interface Channel {
  id: string
  name: string
  adapterType: string
  baseUrl: string
  apiKey: string
  models: string[]
  enabled: boolean
  status?: 'active' | 'error' | 'unknown'
  priority: number
  lastError?: string
  lastUsed?: number
  testedAt?: number
  customHeaders?: Record<string, string>
  stats?: {
    totalCalls?: number
    successCalls?: number
  }
}

// 渠道预设配置
interface ChannelPreset {
  name: string
  adapterType: string
  baseUrl: string
  apiKey: string
  models: string
  description: string
  authUrl?: string
}

// 渠道预设分类
interface ChannelPresetCategory {
  name: string
  icon: string
  presets: string[]
}

const PRESET_CATEGORIES: ChannelPresetCategory[] = [
  { name: '内置免费API', icon: '🆓', presets: ['free-glm', 'free-xiaomi', 'free-gemini', 'free-grok'] },
  { name: '国际厂商', icon: '🌍', presets: ['openai', 'gemini', 'claude', 'grok', 'mistral', 'cohere', 'groq'] },
  { name: '国内厂商', icon: '🇨🇳', presets: ['deepseek', 'zhipu', 'qwen', 'baichuan', 'minimax', 'moonshot', 'yi', 'doubao', 'spark', 'hunyuan', 'baidu'] },
  { name: '中转服务', icon: '🔄', presets: ['openrouter', 'siliconflow', 'together', 'fireworks', 'novita'] },
]

const CHANNEL_PRESETS: Record<string, ChannelPreset> = {
  'free-glm': {
    name: '免费GLM',
    adapterType: 'openai',
    baseUrl: 'https://glm.openel.top/',
    apiKey: 'sk-3d2f9b84e7f510b1a08f7b3d6c9a6a7f17fbbad5624ea29f22d9c742bf39c863',
    models: 'GLM-4.6-V-thinking, GLM-4.5, GLM-4.5-Air, GLM-4.5-Air-search, GLM-4.5-Air-thinking, GLM-4.5-Air-thinking-search, GLM-4.5-Search, GLM-4.5-Thinking, GLM-4.5-V, GLM-4.5-V-search, GLM-4.5-V-thinking, GLM-4.5-V-thinking-search, GLM-4.5-search, GLM-4.5-thinking, GLM-4.5-thinking-search, GLM-4.6, GLM-4.6-Search, GLM-4.6-Thinking, GLM-4.6-V, GLM-4.6-V-search, GLM-4.6-V-thinking-search, GLM-4.6-search, GLM-4.6-thinking, GLM-4.6-thinking-search, glm-4-air-250414, glm-4-flash',
    description: '免费智谱GLM API',
  },
  'free-gemini': {
    name: '免费Gemini',
    adapterType: 'openai',
    baseUrl: 'https://business2api.openel.top/',
    apiKey: '',
    models: 'gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-search, gemini-2.5-flash-video, gemini-2.5-pro, gemini-2.5-pro-image, gemini-2.5-pro-search, gemini-2.5-pro-video, gemini-3-pro, gemini-3-pro-image, gemini-3-pro-preview, gemini-3-pro-preview-image, gemini-3-pro-preview-search, gemini-3-pro-preview-video, gemini-3-pro-search, gemini-3-pro-video, gemini-2.5-flash-preview-latest, gemini-2.5-flash-preview-latest-image, gemini-2.5-flash-preview-latest-search, gemini-2.5-flash-preview-latest-video, gemini-3-flash-image, gemini-3-flash-preview, gemini-3-flash-preview-image, gemini-3-flash-preview-search, gemini-3-flash-preview-video, gemini-3-flash-search, gemini-3-flash-video',
    description: '免费Gemini API，需先获取Key',
    authUrl: 'https://business2api.openel.top/auth',
  },
  'free-grok': {
    name: '免费Grok',
    adapterType: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    apiKey: '',
    models: 'grok-3-mini, grok-3',
    description: '免费Grok API（限额）',
  },
  'free-xiaomi': {
    name: '免费小米MiMo',
    adapterType: 'openai',
    baseUrl: 'https://xiaomi.openel.top/',
    apiKey: 'sk-3d2f9b84e7f510b1a08f7b3d6c9a6a7f17fbbad5624ea29f22d9c742bf39c863',
    models: 'mimo-v2-flash-studio, mimo-v2-flash-studio-thinking, mimo-v2-flash-studio-search, mimo-v2-flash-studio-thinking-search, mimo-v2-flash-studio-search-thinking, mimo-v2-flash, mimo-v2-flash-thinking, mimo-v2-flash-search, mimo-v2-flash-thinking-search, mimo-v2-flash-search-thinking',
    description: '免费小米MiMo API',
  },
  
  // ========== 国际厂商 ==========
  'openai': {
    name: 'OpenAI',
    adapterType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: 'gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4.1, gpt-4.1-mini, o1, o1-mini, o3-mini',
    description: 'OpenAI官方API',
  },
  'gemini': {
    name: 'Google Gemini',
    adapterType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    models: 'gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash',
    description: 'Google Gemini官方API',
  },
  'claude': {
    name: 'Anthropic Claude',
    adapterType: 'claude',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    models: 'claude-sonnet-4-20250514, claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022, claude-3-opus-20240229',
    description: 'Anthropic Claude官方API',
  },
  'grok': {
    name: 'xAI Grok',
    adapterType: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    apiKey: '',
    models: 'grok-3, grok-3-mini, grok-2, grok-2-mini',
    description: 'xAI Grok官方API',
  },
  'mistral': {
    name: 'Mistral AI',
    adapterType: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey: '',
    models: 'mistral-large-latest, mistral-medium-latest, mistral-small-latest, codestral-latest',
    description: 'Mistral AI官方API',
  },
  'cohere': {
    name: 'Cohere',
    adapterType: 'openai',
    baseUrl: 'https://api.cohere.ai/v1',
    apiKey: '',
    models: 'command-r-plus, command-r, command-light',
    description: 'Cohere官方API',
  },
  'groq': {
    name: 'Groq',
    adapterType: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    models: 'llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it',
    description: 'Groq超快推理API',
  },
  
  // ========== 国内厂商 ==========
  'deepseek': {
    name: 'DeepSeek',
    adapterType: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: 'deepseek-chat, deepseek-reasoner, deepseek-coder',
    description: 'DeepSeek官方API',
  },
  'zhipu': {
    name: '智谱AI',
    adapterType: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    models: 'glm-4-plus, glm-4-flash, glm-4-long, glm-4-air, glm-4v-plus, cogview-3-plus',
    description: '智谱AI官方API',
  },
  'qwen': {
    name: '阿里通义千问',
    adapterType: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    models: 'qwen-max, qwen-plus, qwen-turbo, qwen-long, qwen-vl-max, qwen-coder-turbo',
    description: '阿里云通义千问API',
  },
  'baichuan': {
    name: '百川智能',
    adapterType: 'openai',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    apiKey: '',
    models: 'Baichuan4, Baichuan3-Turbo, Baichuan3-Turbo-128k',
    description: '百川智能官方API',
  },
  'minimax': {
    name: 'MiniMax',
    adapterType: 'openai',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKey: '',
    models: 'abab6.5s-chat, abab6.5g-chat, abab5.5-chat',
    description: 'MiniMax官方API',
  },
  'moonshot': {
    name: '月之暗面Kimi',
    adapterType: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    models: 'moonshot-v1-128k, moonshot-v1-32k, moonshot-v1-8k',
    description: 'Moonshot Kimi官方API',
  },
  'yi': {
    name: '零一万物',
    adapterType: 'openai',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    apiKey: '',
    models: 'yi-lightning, yi-large, yi-medium, yi-vision',
    description: '零一万物官方API',
  },
  'doubao': {
    name: '字节豆包',
    adapterType: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: '',
    models: 'doubao-pro-32k, doubao-lite-32k, doubao-pro-128k',
    description: '字节跳动豆包API（需配置endpoint）',
  },
  'spark': {
    name: '讯飞星火',
    adapterType: 'openai',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    apiKey: '',
    models: 'generalv3.5, generalv3, 4.0Ultra',
    description: '讯飞星火认知大模型API',
  },
  'hunyuan': {
    name: '腾讯混元',
    adapterType: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKey: '',
    models: 'hunyuan-pro, hunyuan-standard, hunyuan-lite',
    description: '腾讯混元大模型API',
  },
  'baidu': {
    name: '百度文心',
    adapterType: 'openai',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
    apiKey: '',
    models: 'ernie-4.0-8k, ernie-3.5-8k, ernie-speed-128k',
    description: '百度文心一言API（需获取access_token）',
  },
  
  // ========== 中转服务 ==========
  'openrouter': {
    name: 'OpenRouter',
    adapterType: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    models: 'openai/gpt-4o, anthropic/claude-3.5-sonnet, google/gemini-pro, meta-llama/llama-3.1-70b-instruct',
    description: 'OpenRouter多模型聚合',
  },
  'siliconflow': {
    name: '硅基流动',
    adapterType: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: '',
    models: 'deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-72B-Instruct, THUDM/glm-4-9b-chat',
    description: '硅基流动API（国内中转）',
  },
  'together': {
    name: 'Together AI',
    adapterType: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '',
    models: 'meta-llama/Llama-3.3-70B-Instruct-Turbo, Qwen/Qwen2.5-72B-Instruct-Turbo, mistralai/Mixtral-8x22B-Instruct-v0.1',
    description: 'Together AI开源模型托管',
  },
  'fireworks': {
    name: 'Fireworks AI',
    adapterType: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    apiKey: '',
    models: 'accounts/fireworks/models/llama-v3p1-70b-instruct, accounts/fireworks/models/mixtral-8x22b-instruct',
    description: 'Fireworks AI快速推理',
  },
  'novita': {
    name: 'Novita AI',
    adapterType: 'openai',
    baseUrl: 'https://api.novita.ai/v3/openai',
    apiKey: '',
    models: 'meta-llama/llama-3.1-70b-instruct, mistralai/mistral-nemo-12b-instruct',
    description: 'Novita AI多模型服务',
  },
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [customModelInput, setCustomModelInput] = useState('')

  const [form, setForm] = useState({
    name: '',
    adapterType: 'openai',
    baseUrl: '',
    apiKey: '',
    models: '',
    enabled: true,
    priority: 0,
    customHeaders: {} as Record<string, string>,
    headersTemplate: '',
    requestBodyTemplate: '',
    advanced: {
      streaming: { enabled: false, chunkSize: 1024 },
      thinking: { enableReasoning: false, defaultLevel: 'medium', adaptThinking: true, sendThinkingAsMessage: false },
      llm: { temperature: 0.7, maxTokens: 4000, topP: 1, frequencyPenalty: 0, presencePenalty: 0 }
    },
    imageConfig: {
      transferMode: 'auto' as 'base64' | 'url' | 'auto',
      convertFormat: true,
      targetFormat: 'auto' as 'png' | 'jpeg' | 'auto',
      compress: true,
      quality: 85,
      maxSize: 4096,
      processAnimated: true
    }
  })
  const [newHeaderKey, setNewHeaderKey] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')
  const [showJsonEditor, setShowJsonEditor] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const fetchChannels = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await channelsApi.list(true)
      setChannels(res?.data || [])
    } catch (error) {
      toast.error('加载渠道失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChannels()
  }, [])

  const defaultAdvanced = {
    streaming: { enabled: false, chunkSize: 1024 },
    thinking: { enableReasoning: false, defaultLevel: 'medium', adaptThinking: true, sendThinkingAsMessage: false },
    llm: { temperature: 0.7, maxTokens: 4000, topP: 1, frequencyPenalty: 0, presencePenalty: 0 }
  }

  const defaultImageConfig = {
    transferMode: 'auto' as 'base64' | 'url' | 'auto',
    convertFormat: true,
    targetFormat: 'auto' as 'png' | 'jpeg' | 'auto',
    compress: true,
    quality: 85,
    maxSize: 4096,
    processAnimated: true
  }

  const resetForm = () => {
    setForm({
      name: '',
      adapterType: 'openai',
      baseUrl: '',
      apiKey: '',
      models: '',
      enabled: true,
      priority: 0,
      customHeaders: {},
      headersTemplate: '',
      requestBodyTemplate: '',
      advanced: { ...defaultAdvanced },
      imageConfig: { ...defaultImageConfig }
    })
    setEditingChannel(null)
    setShowAdvanced(false)
    setShowJsonEditor(false)
    setNewHeaderKey('')
    setNewHeaderValue('')
  }

  const handleOpenDialog = (channel?: Channel) => {
    if (channel) {
      setEditingChannel(channel)
      setForm({
        name: channel.name || '',
        adapterType: channel.adapterType || 'openai',
        baseUrl: channel.baseUrl || '',
        apiKey: channel.apiKey || '',
        models: channel.models?.join(', ') || '',
        enabled: channel.enabled !== false,
        priority: channel.priority || 0,
        customHeaders: channel.customHeaders || {},
        headersTemplate: (channel as any).headersTemplate || '',
        requestBodyTemplate: (channel as any).requestBodyTemplate || '',
        advanced: (channel as any).advanced || { ...defaultAdvanced },
        imageConfig: (channel as any).imageConfig || { ...defaultImageConfig }
      })
    } else {
      resetForm()
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.apiKey) {
      toast.error('请填写渠道名称和 API Key')
      return
    }

    setSaving(true)
    try {
      const data = {
        ...form,
        models: form.models.split(',').map(m => m.trim()).filter(Boolean),
        customHeaders: form.customHeaders,
        headersTemplate: form.headersTemplate,
        requestBodyTemplate: form.requestBodyTemplate,
        imageConfig: form.imageConfig,
      }

      if (editingChannel) {
        await channelsApi.update(editingChannel.id, data)
        toast.success('渠道已更新')
      } else {
        await channelsApi.create(data)
        toast.success('渠道已创建')
      }

      setDialogOpen(false)
      resetForm()
      fetchChannels()
    } catch (error) {
      toast.error('保存失败')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此渠道？')) return
    try {
      await channelsApi.delete(id)
      toast.success('渠道已删除')
      fetchChannels()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const handleTest = async (channel: Channel) => {
    setTesting(channel.id)
    try {
      const res = await channelsApi.test({
        id: channel.id,
        adapterType: channel.adapterType,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        models: channel.models,
      }) as any
      if (res?.data?.success || res?.success) {
        toast.success(res?.data?.message || res?.message || '连接成功')
      } else {
        toast.error(res?.data?.message || res?.message || '连接失败')
      }
      fetchChannels()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || '测试失败')
    } finally {
      setTesting(null)
    }
  }

  // 获取默认 baseUrl
  const getDefaultBaseUrl = (adapterType: string) => {
    const defaults: Record<string, string> = {
      openai: 'https://api.openai.com',
      claude: 'https://api.anthropic.com',
      gemini: 'https://generativelanguage.googleapis.com'
    }
    return defaults[adapterType] || ''
  }

  // 检测 URL 是否已包含自定义路径
  const hasCustomPath = (url: string) => {
    try {
      const parsed = new URL(url)
      const path = parsed.pathname.replace(/\/+$/, '')
      return path && path !== ''
    } catch {
      return /\/v\d+/.test(url) || /\/api\//.test(url) || /\/openai\//.test(url)
    }
  }

  // 获取完整的 API 路径预览
  // 默认添加 /v1，除非用户已指定自定义路径
  const getApiPathPreview = (baseUrl: string, adapterType: string) => {
    const url = baseUrl || getDefaultBaseUrl(adapterType)
    if (!url) return ''
    
    // 移除尾部斜杠
    const cleanUrl = url.replace(/\/+$/, '')
    
    // 检测是否有自定义路径
    const hasPath = hasCustomPath(cleanUrl)
    
    // 根据适配器类型显示完整路径
    switch (adapterType) {
      case 'openai':
        // 没有自定义路径时默认添加 /v1
        if (hasPath) {
          return `${cleanUrl}/chat/completions`
        }
        return `${cleanUrl}/v1/chat/completions`
      case 'claude':
        if (hasPath) {
          return `${cleanUrl}/messages`
        }
        return `${cleanUrl}/v1/messages`
      case 'gemini':
        return `${cleanUrl}/v1beta/models/{model}:generateContent`
      default:
        return `${cleanUrl}/chat/completions`
    }
  }

  const handleFetchModels = async () => {
    if (!form.apiKey) {
      toast.error('请先填写 API Key')
      return
    }
    setFetchingModels(true)
    try {
      const res = await channelsApi.fetchModels({
        adapterType: form.adapterType,
        baseUrl: form.baseUrl || getDefaultBaseUrl(form.adapterType),
        apiKey: form.apiKey,
      }) as any
      const models = res?.data?.models || res?.models || []
      if (Array.isArray(models) && models.length > 0) {
        // 提取模型ID
        const modelIds = models.map((m: any) => typeof m === 'string' ? m : m.id || m.name).filter(Boolean)
        setAvailableModels(modelIds)
        // 设置当前已选模型
        const currentModels = form.models.split(',').map(m => m.trim()).filter(Boolean)
        setSelectedModels(currentModels.filter(m => modelIds.includes(m)))
        setModelSelectorOpen(true)
        toast.success(`获取到 ${modelIds.length} 个模型`)
      } else {
        toast.error('未获取到模型列表')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      toast.error(err.response?.data?.message || '获取模型失败')
    } finally {
      setFetchingModels(false)
    }
  }

  // 确认模型选择
  const handleConfirmModels = () => {
    setForm({ ...form, models: selectedModels.join(', ') })
    setModelSelectorOpen(false)
  }

  // 导出渠道
  const exportChannels = () => {
    const exportData = channels.map(ch => ({
      name: ch.name,
      adapterType: ch.adapterType,
      baseUrl: ch.baseUrl,
      models: ch.models,
      priority: ch.priority,
      enabled: ch.enabled,
      // 不导出 apiKey
    }))
    const data = JSON.stringify(exportData, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `channels_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('导出成功（不含 API Key）')
  }

  // 导入渠道
  const importChannels = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!Array.isArray(data)) {
          toast.error('无效的渠道文件格式')
          return
        }
        let imported = 0
        for (const channel of data) {
          try {
            if (!channel.apiKey) {
              channel.apiKey = 'PLEASE_FILL_YOUR_API_KEY'
            }
            await channelsApi.create(channel)
            imported++
          } catch (err) {
            console.error('导入渠道失败:', channel.name, err)
          }
        }
        toast.success(`成功导入 ${imported} 个渠道，请编辑填写 API Key`)
        fetchChannels()
      } catch (err) {
        toast.error('导入失败: ' + (err as Error).message)
      }
    }
    input.click()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="渠道管理"
        description="管理API渠道和模型配置"
        icon={Plug}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={importChannels}>
              <Upload className="mr-2 h-4 w-4" />
              导入
            </Button>
            <Button variant="outline" size="sm" onClick={exportChannels} disabled={channels.length === 0}>
              <FileDown className="mr-2 h-4 w-4" />
              导出
            </Button>
            <Button variant="outline" size="sm" onClick={fetchChannels}>
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => handleOpenDialog()}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加渠道
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingChannel ? '编辑渠道' : '添加渠道'}</DialogTitle>
                <DialogDescription>配置API渠道信息</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4 p-1">
                  {/* 预设选择器 - 仅新建时显示 */}
                  {!editingChannel && (
                    <div className="grid gap-2">
                      <Label>快速预设</Label>
                      <Select
                        onValueChange={(key) => {
                          const preset = CHANNEL_PRESETS[key]
                          if (!preset) return
                          
                          setForm({
                            ...form,
                            name: preset.name,
                            adapterType: preset.adapterType,
                            baseUrl: preset.baseUrl,
                            apiKey: preset.apiKey,
                            models: preset.models,
                          })
                          
                          // 根据预设类型显示不同提示
                          const presetHints: Record<string, { type: 'success' | 'info', message: string, url?: string }> = {
                            'free-glm': { type: 'success', message: '免费GLM配置已填充' },
                            'free-xiaomi': { type: 'success', message: '免费小米MiMo' },
                            'free-gemini': { type: 'info', message: '免费Gemini - 需手动获取API Key', url: preset.authUrl },
                            'free-grok': { type: 'info', message: '免费Grok - 需在 x.ai 获取API Key' },
                            'openai': { type: 'info', message: 'OpenAI - 请填入API Key（sk-xxx），可在 platform.openai.com 获取' },
                            'gemini': { type: 'info', message: 'Gemini - 请填入API Key，可在 aistudio.google.com 获取' },
                            'claude': { type: 'info', message: 'Claude - 请填入API Key，可在 console.anthropic.com 获取' },
                            'grok': { type: 'info', message: 'Grok - 请填入API Key，可在 console.x.ai 获取' },
                            'mistral': { type: 'info', message: 'Mistral AI - 请填入API Key，可在 console.mistral.ai 获取' },
                            'groq': { type: 'info', message: 'Groq - 请填入API Key，可在 console.groq.com 免费获取' },
                            'deepseek': { type: 'info', message: 'DeepSeek - 请填入API Key，可在 platform.deepseek.com 获取' },
                            'zhipu': { type: 'info', message: '智谱AI - 请填入API Key，可在 open.bigmodel.cn 获取' },
                            'qwen': { type: 'info', message: '通义千问 - 请填入API Key，可在 dashscope.console.aliyun.com 获取' },
                            'moonshot': { type: 'info', message: 'Kimi - 请填入API Key，可在 platform.moonshot.cn 获取' },
                            'minimax': { type: 'info', message: 'MiniMax - 请填入API Key，可在 platform.minimaxi.com 获取' },
                            'yi': { type: 'info', message: '零一万物 - 请填入API Key，可在 platform.lingyiwanwu.com 获取' },
                            'baichuan': { type: 'info', message: '百川智能 - 请填入API Key，可在 platform.baichuan-ai.com 获取' },
                            'doubao': { type: 'info', message: '豆包 - 需配置endpoint_id，可在 console.volcengine.com 获取' },
                            'spark': { type: 'info', message: '讯飞星火 - 请填入APIKey:APISecret格式，可在 xinghuo.xfyun.cn 获取' },
                            'openrouter': { type: 'info', message: 'OpenRouter - 请填入API Key，可在 openrouter.ai 获取' },
                            'siliconflow': { type: 'info', message: '硅基流动 - 请填入API Key，可在 cloud.siliconflow.cn 获取' },
                            'together': { type: 'info', message: 'Together AI - 请填入API Key，可在 api.together.xyz 获取' },
                          }
                          
                          const hint = presetHints[key]
                          if (hint) {
                            if (hint.url) {
                              toast.info(
                                <div className="space-y-1">
                                  <p><strong>{preset.name}</strong></p>
                                  <p className="text-xs">{hint.message}</p>
                                  <p className="text-xs">访问 <a href={hint.url} target="_blank" rel="noopener" className="underline text-blue-500">{hint.url}</a></p>
                                </div>,
                                { duration: 8000 }
                              )
                            } else if (hint.type === 'success') {
                              toast.success(hint.message)
                            } else {
                              toast.info(hint.message, { duration: 5000 })
                            }
                          } else {
                            toast.success(`已填充 ${preset.name} 配置，请填入API Key`)
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="选择预设快速配置..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-[400px]">
                          {PRESET_CATEGORIES.map((category) => (
                            <div key={category.name}>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
                                {category.icon} {category.name}
                              </div>
                              {category.presets.map((key) => {
                                const preset = CHANNEL_PRESETS[key]
                                if (!preset) return null
                                return (
                                  <SelectItem key={key} value={key}>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{preset.name}</span>
                                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">- {preset.description}</span>
                                    </div>
                                  </SelectItem>
                                )
                              })}
                            </div>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor="name">渠道名称</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="我的渠道"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="adapterType">适配器类型</Label>
                    <Select
                      value={form.adapterType}
                      onValueChange={(value) => setForm({ ...form, adapterType: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                        <SelectItem value="claude">Claude</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="baseUrl">Base URL</Label>
                    <Input
                      id="baseUrl"
                      value={form.baseUrl}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder={getDefaultBaseUrl(form.adapterType)}
                    />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        留空使用官方地址。支持自定义路径，如 <code className="bg-muted px-1 rounded">openai.com/api/paas/v4</code>
                      </p>
                      {(form.baseUrl || getDefaultBaseUrl(form.adapterType)) && (
                        <p className="text-xs text-blue-500 dark:text-blue-400 font-mono truncate">
                          → {getApiPathPreview(form.baseUrl, form.adapterType)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="apiKey">API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="apiKey"
                        type={showApiKey ? 'text' : 'password'}
                        value={form.apiKey}
                        onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label>模型列表</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleFetchModels}
                          disabled={fetchingModels}
                        >
                          {fetchingModels ? (
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-3 w-3" />
                          )}
                          获取模型
                        </Button>
                        {availableModels.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const currentModels = form.models.split(',').map(m => m.trim()).filter(Boolean)
                              setSelectedModels(currentModels)
                              setModelSelectorOpen(true)
                            }}
                          >
                            <Settings2 className="mr-2 h-3 w-3" />
                            选择模型
                          </Button>
                        )}
                      </div>
                    </div>
                    {/* 已选模型 Badge 显示 */}
                    {form.models && (
                      <div className="flex flex-wrap gap-1.5 p-2 border rounded-lg bg-muted/30 max-h-[120px] overflow-y-auto">
                        {form.models.split(',').map(m => m.trim()).filter(Boolean).map((model) => (
                          <Badge 
                            key={model} 
                            variant="secondary" 
                            className="gap-1 pr-1 text-xs font-normal"
                          >
                            <span className="max-w-[150px] truncate">{model}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const newModels = form.models.split(',').map(m => m.trim()).filter(m => m && m !== model)
                                setForm({ ...form, models: newModels.join(', ') })
                              }}
                              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {!form.models && (
                      <p className="text-xs text-muted-foreground p-2 border rounded-lg bg-muted/30">
                        点击"获取模型"自动获取可用模型，或"选择模型"从列表中选择
                      </p>
                    )}
                    {/* 自定义模型输入 */}
                    <div className="flex gap-2">
                      <Input
                        value={customModelInput}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customModelInput.trim()) {
                            e.preventDefault()
                            const newModels = customModelInput.split(',').map(m => m.trim()).filter(Boolean)
                            const currentModels = form.models.split(',').map(m => m.trim()).filter(Boolean)
                            const uniqueNew = newModels.filter(m => !currentModels.includes(m))
                            if (uniqueNew.length > 0) {
                              setForm({ ...form, models: [...currentModels, ...uniqueNew].join(', ') })
                            }
                            setCustomModelInput('')
                          }
                        }}
                        placeholder="输入模型名称，多个用逗号分隔..."
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!customModelInput.trim()}
                        onClick={() => {
                          const newModels = customModelInput.split(',').map(m => m.trim()).filter(Boolean)
                          if (newModels.length === 0) return
                          const currentModels = form.models.split(',').map(m => m.trim()).filter(Boolean)
                          const uniqueNew = newModels.filter(m => !currentModels.includes(m))
                          if (uniqueNew.length > 0) {
                            setForm({ ...form, models: [...currentModels, ...uniqueNew].join(', ') })
                          }
                          setCustomModelInput('')
                        }}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        添加
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="priority">优先级</Label>
                    <Input
                      id="priority"
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>启用渠道</Label>
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
                    />
                  </div>

                  {/* 高级设置 */}
                  <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between px-0">
                        <span className="flex items-center gap-2">
                          <Settings2 className="h-4 w-4" />
                          高级设置
                        </span>
                        {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-4">
                      {/* 流式输出设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">流式输出</h4>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">启用流式输出</Label>
                          <Switch
                            checked={form.advanced.streaming.enabled}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              advanced: { ...form.advanced, streaming: { ...form.advanced.streaming, enabled: checked } }
                            })}
                          />
                        </div>
                      </div>

                      {/* 思考控制设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">思考控制</h4>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">启用推理模式</Label>
                          <Switch
                            checked={form.advanced.thinking.enableReasoning}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              advanced: { ...form.advanced, thinking: { ...form.advanced.thinking, enableReasoning: checked } }
                            })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-sm">默认思考级别</Label>
                          <Select
                            value={form.advanced.thinking.defaultLevel}
                            onValueChange={(value) => setForm({
                              ...form,
                              advanced: { ...form.advanced, thinking: { ...form.advanced.thinking, defaultLevel: value } }
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">低 (Low)</SelectItem>
                              <SelectItem value="medium">中 (Medium)</SelectItem>
                              <SelectItem value="high">高 (High)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">自适应思考</Label>
                          <Switch
                            checked={form.advanced.thinking.adaptThinking}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              advanced: { ...form.advanced, thinking: { ...form.advanced.thinking, adaptThinking: checked } }
                            })}
                          />
                        </div>
                      </div>

                      {/* 图片处理设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">图片处理</h4>
                        <div className="grid gap-2">
                          <Label className="text-sm">图片传递方式</Label>
                          <Select
                            value={form.imageConfig.transferMode}
                            onValueChange={(value: 'base64' | 'url' | 'auto') => setForm({
                              ...form,
                              imageConfig: { ...form.imageConfig, transferMode: value }
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">自动检测</SelectItem>
                              <SelectItem value="base64">Base64 编码</SelectItem>
                              <SelectItem value="url">URL 链接</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">自动检测会根据API类型自动选择最佳方式</p>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">转换图片格式</Label>
                            <p className="text-xs text-muted-foreground">将GIF/WebP转为PNG/JPG</p>
                          </div>
                          <Switch
                            checked={form.imageConfig.convertFormat}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              imageConfig: { ...form.imageConfig, convertFormat: checked }
                            })}
                          />
                        </div>
                        {form.imageConfig.convertFormat && (
                          <div className="grid gap-2">
                            <Label className="text-sm">目标格式</Label>
                            <Select
                              value={form.imageConfig.targetFormat}
                              onValueChange={(value: 'png' | 'jpeg' | 'auto') => setForm({
                                ...form,
                                imageConfig: { ...form.imageConfig, targetFormat: value }
                              })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">自动选择</SelectItem>
                                <SelectItem value="png">PNG (无损)</SelectItem>
                                <SelectItem value="jpeg">JPEG (有损)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">压缩图片</Label>
                            <p className="text-xs text-muted-foreground">压缩大图以减少传输大小</p>
                          </div>
                          <Switch
                            checked={form.imageConfig.compress}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              imageConfig: { ...form.imageConfig, compress: checked }
                            })}
                          />
                        </div>
                        {form.imageConfig.compress && (
                          <>
                            <div className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <Label>压缩质量</Label>
                                <span className="text-muted-foreground">{form.imageConfig.quality}%</span>
                              </div>
                              <Slider
                                value={[form.imageConfig.quality]}
                                min={10}
                                max={100}
                                step={5}
                                onValueChange={(v) => setForm({
                                  ...form,
                                  imageConfig: { ...form.imageConfig, quality: v[0] }
                                })}
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label className="text-sm">最大尺寸 (像素)</Label>
                              <Input
                                type="number"
                                value={form.imageConfig.maxSize}
                                onChange={(e) => setForm({
                                  ...form,
                                  imageConfig: { ...form.imageConfig, maxSize: parseInt(e.target.value) || 4096 }
                                })}
                              />
                              <p className="text-xs text-muted-foreground">超过此尺寸的图片会被缩放</p>
                            </div>
                          </>
                        )}
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">处理动图</Label>
                            <p className="text-xs text-muted-foreground">将GIF动图转为静态图</p>
                          </div>
                          <Switch
                            checked={form.imageConfig.processAnimated}
                            onCheckedChange={(checked) => setForm({
                              ...form,
                              imageConfig: { ...form.imageConfig, processAnimated: checked }
                            })}
                          />
                        </div>
                      </div>

                      {/* LLM 参数设置 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">LLM 参数</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <Label>Temperature</Label>
                            <span className="text-muted-foreground">{form.advanced.llm.temperature}</span>
                          </div>
                          <Slider
                            value={[form.advanced.llm.temperature]}
                            min={0}
                            max={2}
                            step={0.1}
                            onValueChange={(v) => setForm({
                              ...form,
                              advanced: { ...form.advanced, llm: { ...form.advanced.llm, temperature: v[0] } }
                            })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="text-sm">Max Tokens</Label>
                          <Input
                            type="number"
                            value={form.advanced.llm.maxTokens}
                            onChange={(e) => setForm({
                              ...form,
                              advanced: { ...form.advanced, llm: { ...form.advanced.llm, maxTokens: parseInt(e.target.value) || 4000 } }
                            })}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <Label>Top P</Label>
                            <span className="text-muted-foreground">{form.advanced.llm.topP}</span>
                          </div>
                          <Slider
                            value={[form.advanced.llm.topP]}
                            min={0}
                            max={1}
                            step={0.1}
                            onValueChange={(v) => setForm({
                              ...form,
                              advanced: { ...form.advanced, llm: { ...form.advanced.llm, topP: v[0] } }
                            })}
                          />
                        </div>
                      </div>

                      {/* 自定义请求头 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <h4 className="font-medium text-sm">自定义请求头</h4>
                        <p className="text-xs text-muted-foreground">
                          支持覆写 X-Forwarded-For、Authorization、User-Agent 等请求头
                        </p>
                        
                        {/* 已添加的请求头列表 */}
                        {Object.keys(form.customHeaders).length > 0 && (
                          <div className="space-y-2">
                            {Object.entries(form.customHeaders).map(([key, value]) => (
                              <div key={key} className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                                <code className="text-xs font-mono flex-1 truncate">{key}</code>
                                <code className="text-xs font-mono flex-1 truncate text-muted-foreground">
                                  {value.length > 30 ? value.substring(0, 30) + '...' : value}
                                </code>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                  onClick={() => {
                                    const newHeaders = { ...form.customHeaders }
                                    delete newHeaders[key]
                                    setForm({ ...form, customHeaders: newHeaders })
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {/* 添加新请求头 */}
                        <div className="flex gap-2">
                          <Input
                            placeholder="Header名称 (如 X-Forwarded-For)"
                            value={newHeaderKey}
                            onChange={(e) => setNewHeaderKey(e.target.value)}
                            className="flex-1 text-xs"
                          />
                          <Input
                            placeholder="Header值"
                            value={newHeaderValue}
                            onChange={(e) => setNewHeaderValue(e.target.value)}
                            className="flex-1 text-xs"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!newHeaderKey.trim() || !newHeaderValue.trim()}
                            onClick={() => {
                              if (newHeaderKey.trim() && newHeaderValue.trim()) {
                                setForm({
                                  ...form,
                                  customHeaders: {
                                    ...form.customHeaders,
                                    [newHeaderKey.trim()]: newHeaderValue.trim()
                                  }
                                })
                                setNewHeaderKey('')
                                setNewHeaderValue('')
                              }
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        
                        {/* 常用请求头快捷添加 */}
                        <div className="flex flex-wrap gap-1">
                          {['X-Forwarded-For', 'Authorization', 'User-Agent', 'X-Real-IP'].map((header) => (
                            !form.customHeaders[header] && (
                              <Badge
                                key={header}
                                variant="outline"
                                className="text-xs cursor-pointer hover:bg-muted"
                                onClick={() => setNewHeaderKey(header)}
                              >
                                + {header}
                              </Badge>
                            )
                          ))}
                        </div>
                      </div>

                      {/* JSON模板编辑器 */}
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm">JSON模板（高级）</h4>
                          <Switch
                            checked={showJsonEditor}
                            onCheckedChange={setShowJsonEditor}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          使用JSON格式定义请求头，支持占位符
                        </p>
                        
                        {showJsonEditor && (
                          <>
                            {/* 占位符说明 */}
                            <div className="p-2 bg-muted/50 rounded text-xs">
                              <p className="font-medium mb-1">可用占位符：</p>
                              <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                                <span><code className="text-primary">{'{{API_KEY}}'}</code> API密钥</span>
                                <span><code className="text-primary">{'{{MODEL}}'}</code> 模型名称</span>
                                <span><code className="text-primary">{'{{USER_AGENT}}'}</code> 随机UA</span>
                                <span><code className="text-primary">{'{{XFF}}'}</code> 随机IP</span>
                                <span><code className="text-primary">{'{{RANDOM_IP}}'}</code> 随机IP</span>
                                <span><code className="text-primary">{'{{TIMESTAMP}}'}</code> 时间戳</span>
                                <span><code className="text-primary">{'{{UUID}}'}</code> 随机UUID</span>
                                <span><code className="text-primary">{'{{NONCE}}'}</code> 随机串</span>
                              </div>
                            </div>
                            
                            {/* 请求头JSON模板 */}
                            <div className="space-y-2">
                              <Label className="text-sm">请求头模板 (JSON)</Label>
                              <textarea
                                className="w-full h-24 p-2 text-xs font-mono border rounded bg-background resize-y"
                                placeholder={`{\n  "User-Agent": "{{USER_AGENT}}",\n  "X-Forwarded-For": "{{XFF}}"\n}`}
                                value={form.headersTemplate}
                                onChange={(e) => setForm({ ...form, headersTemplate: e.target.value })}
                              />
                            </div>
                            
                            {/* 请求体JSON模板 */}
                            <div className="space-y-2">
                              <Label className="text-sm">请求体扩展 (JSON)</Label>
                              <textarea
                                className="w-full h-24 p-2 text-xs font-mono border rounded bg-background resize-y"
                                placeholder={`{\n  "extra_headers": {\n    "custom-key": "value"\n  }\n}`}
                                value={form.requestBodyTemplate}
                                onChange={(e) => setForm({ ...form, requestBodyTemplate: e.target.value })}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  保存
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      {channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Plug className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无渠道配置</p>
            <Button className="mt-4" onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              添加第一个渠道
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((channel) => (
            <Card key={channel.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{channel.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {(channel.adapterType || 'openai').toUpperCase()}
                    </Badge>
                    {channel.enabled ? (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">启用</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">禁用</Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="font-mono text-xs truncate">
                  {channel.baseUrl}
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-3">
                {/* 状态和统计 */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {channel.status === 'active' ? (
                      <Badge variant="outline" className="text-green-600 border-green-200 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />正常
                      </Badge>
                    ) : channel.status === 'error' ? (
                      <Badge variant="destructive" className="text-xs">
                        <XCircle className="h-3 w-3 mr-1" />异常
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">未测试</Badge>
                    )}
                    {channel.stats?.totalCalls ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs cursor-help">
                              <Zap className="h-3 w-3 mr-1" />
                              {channel.stats.totalCalls}次
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>成功率: {channel.stats.successCalls && channel.stats.totalCalls 
                              ? Math.round(channel.stats.successCalls / channel.stats.totalCalls * 100) 
                              : 0}%</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">优先级: {channel.priority || 0}</span>
                </div>

                {/* 模型列表 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">模型 ({channel.models?.length || 0})</span>
                  </div>
                  {channel.models && channel.models.length > 0 ? (
                    <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
                      {channel.models.map((model) => (
                        <Badge key={model} variant="secondary" className="text-xs font-normal">
                          {model.length > 20 ? model.slice(0, 20) + '...' : model}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">未配置模型</p>
                  )}
                </div>
                
                {/* 操作按钮 */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleTest(channel)}
                    disabled={testing === channel.id}
                  >
                    {testing === channel.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <TestTube className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    测试
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleOpenDialog(channel)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(channel.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 模型选择对话框 - 移动端优化 */}
      <Dialog open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] sm:max-h-[80vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              选择模型
            </DialogTitle>
            <DialogDescription>
              从列表中选择需要使用的模型
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden min-h-0">
            <ModelSelector
              value={selectedModels}
              allModels={availableModels}
              onChange={setSelectedModels}
            />
          </div>
          <DialogFooter className="flex-shrink-0 pt-4 border-t mt-2 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setModelSelectorOpen(false)} className="flex-1 sm:flex-none">
              取消
            </Button>
            <Button onClick={handleConfirmModels} className="flex-1 sm:flex-none">
              确认选择 ({selectedModels.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
