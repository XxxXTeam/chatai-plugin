'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
} from '@/components/ui/dialog'
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
import { conversationsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Trash2, MessageSquare, Eye, RefreshCw, Loader2, User, Bot, FileDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

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

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const fetchConversations = async () => {
    try {
      const res = await conversationsApi.list() as { data: Conversation[] }
      setConversations(res.data || [])
    } catch (error) {
      toast.error('加载对话失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConversations()
  }, [])

  const handleViewMessages = async (conversation: Conversation) => {
    setSelectedConversation(conversation)
    setLoadingMessages(true)
    try {
      const res = await conversationsApi.getMessages(conversation.id) as { data: Message[] }
      console.log('[对话详情] API响应:', res)
      const messageList = res.data || res || []
      console.log('[对话详情] 消息列表:', messageList)
      setMessages(Array.isArray(messageList) ? messageList : [])
    } catch (error) {
      toast.error('加载消息失败')
      console.error('[对话详情] 加载错误:', error)
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await conversationsApi.delete(id)
      toast.success('对话已删除')
      fetchConversations()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await conversationsApi.clearAll()
      toast.success('所有对话已清空')
      fetchConversations()
    } catch (error) {
      toast.error('清空失败')
      console.error(error)
    } finally {
      setClearing(false)
    }
  }

  const getMessageText = (content: unknown): string => {
    if (!content) return ''
    if (typeof content === 'string') return content
    
    // 处理数组类型 - 标准消息格式 [{type: 'text', text: '...'}, ...]
    if (Array.isArray(content)) {
      const texts: string[] = []
      for (const item of content) {
        if (typeof item === 'string') {
          texts.push(item)
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          // 标准格式: { type: 'text', text: '...' }
          if (obj.type === 'text' && typeof obj.text === 'string') {
            texts.push(obj.text)
          }
          // 推理格式: { type: 'reasoning', text: '...' }
          else if (obj.type === 'reasoning' && typeof obj.text === 'string') {
            texts.push(`[思考] ${obj.text}`)
          }
          // 工具结果格式: { type: 'tool', content: '...' }
          else if (obj.type === 'tool' && obj.content) {
            texts.push(`[工具结果] ${String(obj.content).slice(0, 200)}...`)
          }
          // 直接 text 字段
          else if ('text' in obj && obj.text) {
            texts.push(String(obj.text))
          }
          // 直接 content 字段
          else if ('content' in obj && typeof obj.content === 'string') {
            texts.push(obj.content)
          }
          // 嵌套 content
          else if ('content' in obj && obj.content) {
            const nested = getMessageText(obj.content)
            if (nested) texts.push(nested)
          }
          // {[userId]: text} 格式 - 取第一个值
          else {
            const values = Object.values(obj)
            if (values.length > 0 && typeof values[0] === 'string') {
              texts.push(values[0])
            }
          }
        }
      }
      return texts.filter(Boolean).join('\n')
    }
    
    // 处理对象类型
    if (typeof content === 'object' && content !== null) {
      const obj = content as Record<string, unknown>
      // 标准字段
      if ('text' in obj && typeof obj.text === 'string') return obj.text
      if ('content' in obj) return getMessageText(obj.content)
      
      // {[userId]: text} 格式 - 取第一个字符串值
      const values = Object.values(obj)
      for (const val of values) {
        if (typeof val === 'string') return val
      }
      // 递归处理嵌套对象
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

  const filteredConversations = conversations.filter(c => 
    c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.userId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.groupId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.lastMessage?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const exportConversation = () => {
    if (!selectedConversation || !messages.length) return
    const exportData = {
      conversation: selectedConversation,
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
    a.download = `conversation_${selectedConversation.id}_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('导出成功')
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">对话历史</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchConversations}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={conversations.length === 0 || clearing}>
                {clearing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                清空所有
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认清空所有对话？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作将永久删除所有对话记录，无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearAll}>
                  确认清空
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索对话ID、用户、群组或消息内容..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {filteredConversations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无对话记录</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredConversations.map((conversation) => (
            <Card key={conversation.id} className="hover:bg-accent/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium truncate">{conversation.id}</span>
                      {conversation.groupId && (
                        <Badge variant="secondary">群聊</Badge>
                      )}
                      <Badge variant="outline">{conversation.messageCount} 条消息</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {conversation.lastMessage || '无消息'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      更新于 {formatTime(conversation.updatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewMessages(conversation)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(conversation.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Messages Dialog */}
      <Dialog open={!!selectedConversation} onOpenChange={() => setSelectedConversation(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>对话详情</DialogTitle>
                <DialogDescription>{selectedConversation?.id}</DialogDescription>
              </div>
              <Button variant="outline" size="sm" onClick={exportConversation} disabled={loadingMessages || messages.length === 0}>
                <FileDown className="mr-2 h-4 w-4" />
                导出
              </Button>
            </div>
          </DialogHeader>
          {loadingMessages ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4" />
              <p>暂无消息记录</p>
            </div>
          ) : (
            <ScrollArea className="h-[50vh]">
              <div className="space-y-4 p-4">
                {messages.map((message, index) => {
                  // 获取角色，支持多种格式
                  let role = 'user'
                  if (typeof message.role === 'string') {
                    role = message.role
                  }
                  
                  const isAssistant = role === 'assistant'
                  
                  // 获取消息文本 - 尝试多种方式
                  let text = getMessageText(message.content)
                  
                  // 如果 content 解析失败，尝试从整个 message 对象解析
                  if (!text && message.content) {
                    // 可能整个对象就是消息内容
                    text = typeof message.content === 'string' 
                      ? message.content 
                      : JSON.stringify(message.content, null, 2)
                  }
                  
                  // 跳过完全空的消息
                  if (!text) return null
                  
                  return (
                    <div
                      key={message.id || index}
                      className={`flex gap-3 ${isAssistant ? '' : 'flex-row-reverse'}`}
                    >
                      <div className={`
                        flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                        ${isAssistant ? 'bg-primary text-primary-foreground' : 'bg-muted'}
                      `}>
                        {isAssistant ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                      </div>
                      <div className={`
                        flex-1 rounded-lg p-3 max-w-[80%]
                        ${isAssistant ? 'bg-muted' : 'bg-primary text-primary-foreground'}
                      `}>
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {text || <span className="opacity-50 italic">(无文本内容)</span>}
                        </p>
                        {message.timestamp && (
                          <p className="text-xs opacity-70 mt-1">
                            {formatTime(message.timestamp)}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                }).filter(Boolean)}
                {messages.filter(m => {
                  const r = typeof m.role === 'string' ? m.role : ''
                  return r === 'user' || r === 'assistant'
                }).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>该对话只包含系统消息或工具调用</p>
                    <p className="text-xs mt-2">共 {messages.length} 条原始消息</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
