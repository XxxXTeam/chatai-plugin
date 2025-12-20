'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { conversationsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Trash2, MessageSquare, Eye, RefreshCw, Loader2, User, Bot, FileDown, Search, Filter } from 'lucide-react'
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
const INTERNAL_PREFIXES = ['group_summary_', 'user_profile_', 'memory_', 'system_']

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showInternal, setShowInternal] = useState(false)
  const [messageLimit, setMessageLimit] = useState(100)

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
  const isInternalConversation = (id: string) => {
    return INTERNAL_PREFIXES.some(prefix => id.startsWith(prefix))
  }

  useEffect(() => {
    fetchConversations()
  }, [])

  const handleViewMessages = async (conversation: Conversation, limit = messageLimit) => {
    setSelectedConversation(conversation)
    setLoadingMessages(true)
    try {
      const res = await conversationsApi.getMessages(conversation.id, limit) as { data: Message[] }
      const messageList = res.data || res || []
      setMessages(Array.isArray(messageList) ? messageList : [])
    } catch (error) {
      toast.error('加载消息失败')
      console.error(error)
    } finally {
      setLoadingMessages(false)
    }
  }
  
  const loadMoreMessages = () => {
    if (selectedConversation) {
      const newLimit = messageLimit + 100
      setMessageLimit(newLimit)
      handleViewMessages(selectedConversation, newLimit)
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

  // 过滤对话列表
  const filteredConversations = conversations.filter(c => {
    // 过滤内部记录
    if (!showInternal && isInternalConversation(c.id)) return false
    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return c.id.toLowerCase().includes(term) ||
        c.userId?.toLowerCase().includes(term) ||
        c.groupId?.toLowerCase().includes(term) ||
        c.lastMessage?.toLowerCase().includes(term)
    }
    return true
  })
  
  // 统计
  const totalCount = conversations.length
  const internalCount = conversations.filter(c => isInternalConversation(c.id)).length
  const chatCount = totalCount - internalCount

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

      {/* 统计和筛选 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{chatCount} 对话</Badge>
          {internalCount > 0 && (
            <Badge variant="secondary">{internalCount} 内部记录</Badge>
          )}
        </div>
        <div className="flex-1 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索对话ID、用户、群组..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={showInternal ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowInternal(!showInternal)}
        >
          <Filter className="mr-2 h-4 w-4" />
          {showInternal ? '隐藏内部记录' : '显示内部记录'}
        </Button>
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
        <DialogContent className="w-[95vw] max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  对话详情
                  {isInternalConversation(selectedConversation?.id || '') && (
                    <Badge variant="secondary">内部记录</Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="truncate max-w-md">
                  {selectedConversation?.id}
                </DialogDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportConversation} disabled={loadingMessages || messages.length === 0}>
                  <FileDown className="mr-2 h-4 w-4" />
                  导出
                </Button>
              </div>
            </div>
          </DialogHeader>
          
          {loadingMessages ? (
            <div className="flex-1 flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4" />
              <p>暂无消息记录</p>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-2 p-4">
                  {messages.map((message, index) => {
                    let role = typeof message.role === 'string' ? message.role : 'user'
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
                        <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs
                          ${isAssistant ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                          {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                        </div>
                        <div className={`rounded-lg px-3 py-2 max-w-[85%] min-w-0
                          ${isAssistant ? 'bg-muted' : 'bg-primary/10 border'}`}>
                          <p className="text-sm whitespace-pre-wrap break-words">{text}</p>
                          {message.timestamp && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {formatTime(message.timestamp)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  }).filter(Boolean)}
                </div>
              </ScrollArea>
              
              {/* 加载更多 */}
              {messages.length >= messageLimit && (
                <div className="flex-shrink-0 border-t pt-3 flex justify-center">
                  <Button variant="outline" size="sm" onClick={loadMoreMessages} disabled={loadingMessages}>
                    {loadingMessages ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    加载更多 (当前 {messages.length} 条)
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
