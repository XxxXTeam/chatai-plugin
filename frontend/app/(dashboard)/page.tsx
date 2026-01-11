'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader, PageContainer } from '@/components/layout/PageHeader'
import { configApi, channelsApi, toolsApi, mcpApi } from '@/lib/api'
import {
    Bot,
    MessageSquare,
    Plug,
    Wrench,
    Settings,
    Users,
    Activity,
    Palette,
    Server,
    ArrowRight,
    History,
    LayoutDashboard,
    BookOpen
} from 'lucide-react'

interface Channel {
    id: string
    name: string
    status: string
    enabled: boolean
}

interface DashboardData {
    channels: Channel[]
    config: Record<string, unknown>
    toolsCount: number
    serversCount: number
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null)
    const [loading, setLoading] = useState(true)
    const searchParams = useSearchParams()
    const router = useRouter()

    // 处理从后端重定向过来的 auth_token 参数
    useEffect(() => {
        const authToken = searchParams.get('auth_token')
        if (authToken) {
            // 保存token到localStorage
            localStorage.setItem('chatai_token', authToken)
            // 清除URL中的token参数
            router.replace('/')
        }
    }, [searchParams, router])

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [channelsRes, configRes, toolsRes, serversRes] = await Promise.all([
                    channelsApi.list(true),
                    configApi.get(),
                    toolsApi.list().catch(() => ({ data: [] })),
                    mcpApi.listServers().catch(() => ({ data: [] }))
                ])
                setData({
                    channels: (channelsRes as { data?: Channel[] })?.data || [],
                    config: (configRes as { data?: Record<string, unknown> })?.data || {},
                    toolsCount: Array.isArray((toolsRes as { data?: unknown[] })?.data)
                        ? (toolsRes as { data: unknown[] }).data.length
                        : 0,
                    serversCount: Array.isArray((serversRes as { data?: unknown[] })?.data)
                        ? (serversRes as { data: unknown[] }).data.length
                        : 0
                })
            } catch (error) {
                console.error('Failed to fetch dashboard data:', error)
            } finally {
                setLoading(false)
            }
        }
        fetchData()
    }, [])

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <Card key={i}>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-4 w-4" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-8 w-16" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    const activeChannels = data?.channels.filter(c => c.enabled && c.status === 'active').length || 0
    const totalChannels = data?.channels.length || 0
    const totalModels =
        data?.channels.reduce(
            (acc: number, c: Channel & { models?: string[] }) => acc + (Array.isArray(c.models) ? c.models.length : 0),
            0
        ) || 0

    const stats = [
        {
            title: '活跃渠道',
            value: `${activeChannels}/${totalChannels}`,
            icon: Plug,
            description: '可用API渠道',
            href: '/channels',
            gradient: 'from-green-500/10 to-emerald-600/10 hover:from-green-500/20 hover:to-emerald-600/20',
            textGradient: 'text-green-600 dark:text-green-400',
            iconColor: 'text-green-600 dark:text-green-400'
        },
        {
            title: 'MCP服务器',
            value: data?.serversCount || 0,
            icon: Server,
            description: '已连接服务',
            href: '/mcp',
            gradient: 'from-cyan-500/10 to-blue-600/10 hover:from-cyan-500/20 hover:to-blue-600/20',
            textGradient: 'text-cyan-600 dark:text-cyan-400',
            iconColor: 'text-cyan-600 dark:text-cyan-400'
        },
        {
            title: 'AI模型',
            value: totalModels,
            icon: Bot,
            description: '可用模型数',
            href: '/channels',
            gradient: 'from-purple-500/10 to-indigo-600/10 hover:from-purple-500/20 hover:to-indigo-600/20',
            textGradient: 'text-purple-600 dark:text-purple-400',
            iconColor: 'text-purple-600 dark:text-purple-400'
        },
        {
            title: '工具数',
            value: data?.toolsCount || 0,
            icon: Wrench,
            description: 'MCP工具',
            href: '/tools',
            gradient: 'from-amber-500/10 to-orange-600/10 hover:from-amber-500/20 hover:to-orange-600/20',
            textGradient: 'text-amber-600 dark:text-amber-400',
            iconColor: 'text-amber-600 dark:text-amber-400'
        }
    ]

    const quickGroups = [
        {
            title: '配置中心',
            items: [
                { label: '系统设置', icon: Settings, href: '/settings', color: 'text-blue-500' },
                { label: '渠道管理', icon: Plug, href: '/channels', color: 'text-green-500' },
                { label: '预设管理', icon: Palette, href: '/presets', color: 'text-purple-500' }
            ]
        },
        {
            title: 'AI扩展',
            items: [
                { label: '工具配置', icon: Wrench, href: '/tools', color: 'text-amber-500' },
                { label: 'MCP服务', icon: Server, href: '/mcp', color: 'text-cyan-500' },
                { label: '知识库', icon: BookOpen, href: '/knowledge', color: 'text-emerald-500' }
            ]
        },
        {
            title: '数据记录',
            items: [
                { label: '对话历史', icon: MessageSquare, href: '/conversations', color: 'text-pink-500' },
                { label: '调用记录', icon: History, href: '/history', color: 'text-orange-500' },
                { label: '用户管理', icon: Users, href: '/users', color: 'text-indigo-500' }
            ]
        }
    ]

    return (
        <PageContainer>
            <PageHeader title="仪表盘" description="系统概览与快捷入口" icon={LayoutDashboard} />

            {/* Stats Grid */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {stats.map((stat, index) => (
                    <Link
                        key={stat.title}
                        href={stat.href}
                        className="animate-fade-in-up"
                        style={{ animationDelay: `${index * 100}ms` }}
                    >
                        <Card
                            className={`group relative overflow-hidden transition-all duration-300 cursor-pointer h-full border border-border/40 shadow-sm hover:shadow-lg hover:-translate-y-1 bg-gradient-to-br ${stat.gradient}`}
                        >
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground/80">
                                    {stat.title}
                                </CardTitle>
                                <div
                                    className={`p-2 rounded-xl bg-background/50 backdrop-blur-sm group-hover:scale-110 transition-all duration-300 shadow-sm`}
                                >
                                    <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className={`text-3xl font-bold tracking-tight ${stat.textGradient}`}>
                                    {stat.value}
                                </div>
                                <p className="text-xs text-muted-foreground/70 mt-1.5 font-medium">
                                    {stat.description}
                                </p>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>

            {/* 快捷入口 - 分组展示 */}
            <div className="grid gap-4 md:grid-cols-3">
                {quickGroups.map((group, groupIndex) => (
                    <Card
                        key={group.title}
                        className="glass-card overflow-hidden hover:shadow-md transition-shadow duration-300 animate-fade-in-up"
                        style={{ animationDelay: `${200 + groupIndex * 100}ms` }}
                    >
                        <CardHeader className="pb-3 pt-4 border-b border-border/40 bg-muted/20">
                            <CardTitle className="text-sm font-bold text-foreground/70 tracking-wide uppercase flex items-center gap-2">
                                <span className="w-1 h-4 bg-primary rounded-full"></span>
                                {group.title}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-4 pb-4">
                            <div className="grid grid-cols-2 gap-3">
                                {group.items.map(item => (
                                    <Link key={item.href} href={item.href}>
                                        <Button
                                            variant="ghost"
                                            className="w-full h-auto flex flex-col gap-2 py-3 hover:bg-primary/5 hover:scale-[1.02] transition-all duration-300 rounded-xl group border border-transparent hover:border-primary/10"
                                        >
                                            <div className="p-2 rounded-xl bg-muted/50 group-hover:bg-background group-hover:shadow-sm transition-all duration-300">
                                                <item.icon className={`h-5 w-5 ${item.color}`} />
                                            </div>
                                            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                                                {item.label}
                                            </span>
                                        </Button>
                                    </Link>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Status Cards */}
            <div className="grid gap-4 md:grid-cols-2 animate-fade-in-up delay-300">
                <Card className="glass-card hover:shadow-md transition-all duration-300">
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 pb-4">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                                    <Plug className="h-4 w-4" />
                                </div>
                                渠道状态
                            </CardTitle>
                            <CardDescription className="mt-1">API渠道连接状态监控</CardDescription>
                        </div>
                        <Link href="/channels">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg hover:bg-primary hover:text-primary-foreground transition-colors"
                            >
                                查看全部 <ArrowRight className="ml-1 h-3 w-3" />
                            </Button>
                        </Link>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <div className="space-y-3">
                            {data?.channels.slice(0, 5).map(channel => (
                                <div
                                    key={channel.id}
                                    className="flex items-center justify-between p-2 hover:bg-muted/30 rounded-lg transition-colors group"
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <span
                                            className={`w-2 h-2 rounded-full ${channel.status === 'active' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : channel.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`}
                                        />
                                        <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                                            {channel.name}
                                        </span>
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={`${channel.status === 'active' ? 'bg-green-500/10 text-green-600 border-green-200' : channel.status === 'error' ? 'bg-red-500/10 text-red-600 border-red-200' : 'text-muted-foreground'}`}
                                    >
                                        {channel.status === 'active'
                                            ? '正常'
                                            : channel.status === 'error'
                                              ? '异常'
                                              : '未测试'}
                                    </Badge>
                                </div>
                            ))}
                            {(!data?.channels || data.channels.length === 0) && (
                                <div className="text-center py-8 flex flex-col items-center gap-2">
                                    <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
                                        <Plug className="h-6 w-6 text-muted-foreground/50" />
                                    </div>
                                    <p className="text-sm text-muted-foreground">暂无渠道配置</p>
                                    <Link href="/channels">
                                        <Button size="sm" variant="secondary" className="mt-2">
                                            添加渠道
                                        </Button>
                                    </Link>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="glass-card hover:shadow-md transition-all duration-300">
                    <CardHeader className="border-b border-border/40 pb-4">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500">
                                <Activity className="h-4 w-4" />
                            </div>
                            系统状态
                        </CardTitle>
                        <CardDescription className="mt-1">核心服务与组件运行概览</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                                        <Bot className="h-4 w-4 text-green-600" />
                                    </div>
                                    <span className="text-sm font-medium">AI Core</span>
                                </div>
                                <Badge className="bg-green-500/15 text-green-600 hover:bg-green-500/20 shadow-none border-0">
                                    正常运行
                                </Badge>
                            </div>

                            <div className="flex items-center justify-between p-2">
                                <span className="text-sm text-muted-foreground">MCP服务</span>
                                <Badge
                                    variant={
                                        (data?.config as { mcp?: { enabled?: boolean } })?.mcp?.enabled
                                            ? 'default'
                                            : 'secondary'
                                    }
                                    className="transition-colors"
                                >
                                    {(data?.config as { mcp?: { enabled?: boolean } })?.mcp?.enabled
                                        ? '已启用'
                                        : '已禁用'}
                                </Badge>
                            </div>

                            <div className="flex items-center justify-between p-2">
                                <span className="text-sm text-muted-foreground">伪人模式</span>
                                <Badge
                                    variant={
                                        (data?.config as { bym?: { enable?: boolean } })?.bym?.enable
                                            ? 'default'
                                            : 'secondary'
                                    }
                                    className="transition-colors"
                                >
                                    {(data?.config as { bym?: { enable?: boolean } })?.bym?.enable
                                        ? '已启用'
                                        : '已禁用'}
                                </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mt-2">
                                <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 text-center">
                                    <span className="text-2xl font-bold">{data?.serversCount || 0}</span>
                                    <span className="text-xs text-muted-foreground">MCP服务器</span>
                                </div>
                                <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 text-center">
                                    <span className="text-2xl font-bold">{data?.toolsCount || 0}</span>
                                    <span className="text-xs text-muted-foreground">可用工具</span>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </PageContainer>
    )
}
