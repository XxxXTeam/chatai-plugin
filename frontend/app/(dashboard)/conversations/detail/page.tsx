'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { conversationsApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  ArrowLeft, 
  Loader2, 
  User, 
  Bot, 
  FileDown, 
  MessageSquare,
  RefreshCw,
  Trash2,
  ChevronDown
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface Message {
  id?: string
  role: string | Record<string, unknown>
  content: unknown
  timestamp?: number
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
}

interface Conversation {
  id: string
  userId: string
  groupId?: string
  messageCount: number
  lastMessage: string
  updatedAt: number
}

const INTERNAL_PREFIXES = ['group_summary_', 'user_profile_', 'memory_', 'system_']

export default function ConversationDetailPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const conversationId = searchParams.get('id') || ''
  
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [messageLimit, setMessageLimit] = useState(100)

  const isInternalConversation = (id: string) => {
    return INTERNAL_PREFIXES.some(prefix => id.startsWith(prefix))
  }

  const fetchMessages = async (limit = messageLimit) => {
    if (!conversationId) return
    try {
      const res = await conversationsApi.getMessages(conversationId, limit) as { data: Message[] }
      const messageList = res.data || res || []
      setMessages(Array.isArray(messageList) ? messageList : [])
    } catch (error) {
      toast.error('加载消息失败')
      console.error(error)
    }
  }

  const fetchConversation = async () => {
    if (!conversationId) return
    try {
      const res = await conversationsApi.list() as { data: Conversation[] }
      const found = (res.data || []).find(c => c.id === conversationId)
      if (found) {
        setConversation(found)
      }
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    if (!conversationId) {
      router.push('/conversations')
      return
    }
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchConversation(), fetchMessages()])
      setLoading(false)
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const loadMoreMessages = async () => {
    setLoadingMore(true)
    const newLimit = messageLimit + 100
    setMessageLimit(newLimit)
    await fetchMessages(newLimit)
    setLoadingMore(false)
  }

  const handleDelete = async () => {
    try {
      await conversationsApi.delete(conversationId)
      toast.success('对话已删除')
      router.push('/conversations')
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const getMessageText = (content: unknown): string => {
    if (!content) return ''
    if (typeof content === 'string') return content
    
    if (Array.isArray(content)) {
      const texts: string[] = []
      for (const item of content) {
        if (typeof item === 'string') {
          texts.push(item)
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          if (obj.type === 'text' && typeof obj.text === 'string') {
            texts.push(obj.text)
          } else if (obj.type === 'reasoning' && typeof obj.text === 'string') {
            texts.push(`[思考] ${obj.text}`)
          } else if (obj.type === 'tool' && obj.content) {
            texts.push(`[工具结果] ${String(obj.content).slice(0, 200)}...`)
          } else if ('text' in obj && obj.text) {
            texts.push(String(obj.text))
          } else if ('content' in obj && typeof obj.content === 'string') {
            texts.push(obj.content)
          } else if ('content' in obj && obj.content) {
            const nested = getMessageText(obj.content)
            if (nested) texts.push(nested)
          } else {
            const values = Object.values(obj)
            if (values.length > 0 && typeof values[0] === 'string') {
              texts.push(values[0])
            }
          }
        }
      }
      return texts.filter(Boolean).join('\n')
    }
    
    if (typeof content === 'object' && content !== null) {
      const obj = content as Record<string, unknown>
      if ('text' in obj && typeof obj.text === 'string') return obj.text
      if ('content' in obj) return getMessageText(obj.content)
      
      const values = Object.values(obj)
      for (const val of values) {
        if (typeof val === 'string') return val
      }
      for (const val of values) {
        if (val && typeof val === 'object') {
          const nested = getMessageText(val)
          if (nested) return nested
        }
      }
    }
    
    return ''
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN')
  }

  const exportConversation = () => {
    if (!messages.length) return
    const exportData = {
      conversationId,
      conversation,
      messages: messages.map(m => ({
        role: m.role,
        content: getMessageText(m.content),
        timestamp: m.timestamp ? formatTime(m.timestamp) : undefined
      }))
    }
    const data = JSON.stringify(exportData, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conversation_${conversationId}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('导出成功')
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-20 flex-1 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/conversations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              对话详情
              {isInternalConversation(conversationId) && (
                <Badge variant="secondary">内部记录</Badge>
              )}
              {conversation?.groupId && (
                <Badge variant="outline">群聊</Badge>
              )}
            </h2>
            <p className="text-sm text-muted-foreground break-all max-w-lg">
              {conversationId}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchMessages(messageLimit)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={exportConversation} disabled={messages.length === 0}>
            <FileDown className="mr-2 h-4 w-4" />
            导出
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                删除
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认删除对话？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将永久删除该对话记录，无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  确认删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Stats */}
      {conversation && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>共 {conversation.messageCount} 条消息</span>
          <span>•</span>
          <span>更新于 {formatTime(conversation.updatedAt)}</span>
        </div>
      )}

      {/* Messages */}
      {messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无消息记录</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              {messages.map((message, index) => {
                const role = typeof message.role === 'string' ? message.role : 'user'
                const isAssistant = role === 'assistant'
                
                let text = getMessageText(message.content)
                if (!text && message.content) {
                  text = typeof message.content === 'string' 
                    ? message.content 
                    : JSON.stringify(message.content, null, 2)
                }
                if (!text) return null
                
                return (
                  <div key={index} className={`flex gap-3 ${isAssistant ? '' : 'flex-row-reverse'}`}>
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                      ${isAssistant ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                      {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </div>
                    <div className={`rounded-lg px-4 py-3 max-w-[80%]
                      ${isAssistant ? 'bg-muted' : 'bg-primary/10 border'}`}>
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{text}</p>
                      {message.timestamp && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {formatTime(message.timestamp)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              }).filter(Boolean)}
            </div>

            {/* Load More */}
            {messages.length >= messageLimit && (
              <div className="mt-6 flex justify-center">
                <Button variant="outline" onClick={loadMoreMessages} disabled={loadingMore}>
                  {loadingMore ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronDown className="mr-2 h-4 w-4" />
                  )}
                  加载更多 (当前 {messages.length} 条)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
