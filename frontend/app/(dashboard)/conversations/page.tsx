'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { conversationsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Trash2, MessageSquare, Eye, RefreshCw, Loader2, Search, Filter } from 'lucide-react'
import { Input } from '@/components/ui/input'

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
    const router = useRouter()
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)
    const [clearing, setClearing] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    const [showInternal, setShowInternal] = useState(false)

    const fetchConversations = async () => {
        try {
            const res = (await conversationsApi.list()) as { data: Conversation[] }
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

    const handleViewMessages = (conversation: Conversation) => {
        router.push(`/conversations/detail?id=${encodeURIComponent(conversation.id)}`)
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

    const formatTime = (timestamp: number) => {
        return new Date(timestamp).toLocaleString('zh-CN')
    }

    const filteredConversations = conversations.filter(c => {
        if (!showInternal && isInternalConversation(c.id)) return false
        if (searchTerm) {
            const term = searchTerm.toLowerCase()
            return (
                c.id.toLowerCase().includes(term) ||
                c.userId?.toLowerCase().includes(term) ||
                c.groupId?.toLowerCase().includes(term) ||
                c.lastMessage?.toLowerCase().includes(term)
            )
        }
        return true
    })

    const totalCount = conversations.length
    const internalCount = conversations.filter(c => isInternalConversation(c.id)).length
    const chatCount = totalCount - internalCount

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
                                <AlertDialogAction onClick={handleClearAll}>确认清空</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline">{chatCount} 对话</Badge>
                    {internalCount > 0 && <Badge variant="secondary">{internalCount} 内部记录</Badge>}
                </div>
                <div className="flex-1 relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="搜索对话ID、用户、群组..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
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
                    {filteredConversations.map(conversation => (
                        <Card key={conversation.id} className="hover:bg-accent/50 transition-colors">
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium truncate">{conversation.id}</span>
                                            {conversation.groupId && <Badge variant="secondary">群聊</Badge>}
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
        </div>
    )
}
