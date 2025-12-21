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
  UsersRound,
  LayoutDashboard,
  Zap,
  BookOpen,
  Brain,
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
          mcpApi.listServers().catch(() => ({ data: [] })),
        ])
        setData({
          channels: (channelsRes as any)?.data || [],
          config: (configRes as any)?.data || {},
          toolsCount: Array.isArray((toolsRes as any)?.data) ? (toolsRes as any).data.length : 0,
          serversCount: Array.isArray((serversRes as any)?.data) ? (serversRes as any).data.length : 0,
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
  const totalModels = data?.channels.reduce((acc: number, c: any) => acc + (Array.isArray(c.models) ? c.models.length : 0), 0) || 0

  const stats = [
    {
      title: '活跃渠道',
      value: `${activeChannels}/${totalChannels}`,
      icon: Plug,
      description: '可用API渠道',
      href: '/channels',
      gradient: 'from-green-500 to-emerald-600',
      iconColor: 'text-green-600',
    },
    {
      title: 'MCP服务器',
      value: data?.serversCount || 0,
      icon: Server,
      description: '已连接服务',
      href: '/mcp',
      gradient: 'from-cyan-500 to-blue-600',
      iconColor: 'text-cyan-600',
    },
    {
      title: 'AI模型',
      value: totalModels,
      icon: Bot,
      description: '可用模型数',
      href: '/channels',
      gradient: 'from-purple-500 to-indigo-600',
      iconColor: 'text-purple-600',
    },
    {
      title: '工具数',
      value: data?.toolsCount || 0,
      icon: Wrench,
      description: 'MCP工具',
      href: '/tools',
      gradient: 'from-amber-500 to-orange-600',
      iconColor: 'text-amber-600',
    },
  ]

  // 快捷入口 - 与侧边栏分组一致
  const quickGroups = [
    {
      title: '配置中心',
      items: [
        { label: '系统设置', icon: Settings, href: '/settings', color: 'text-blue-500' },
        { label: '渠道管理', icon: Plug, href: '/channels', color: 'text-green-500' },
        { label: '预设管理', icon: Palette, href: '/presets', color: 'text-purple-500' },
      ]
    },
    {
      title: 'AI扩展',
      items: [
        { label: '工具配置', icon: Wrench, href: '/tools', color: 'text-amber-500' },
        { label: 'MCP服务', icon: Server, href: '/mcp', color: 'text-cyan-500' },
        { label: '知识库', icon: BookOpen, href: '/knowledge', color: 'text-emerald-500' },
      ]
    },
    {
      title: '数据记录',
      items: [
        { label: '对话历史', icon: MessageSquare, href: '/conversations', color: 'text-pink-500' },
        { label: '调用记录', icon: History, href: '/history', color: 'text-orange-500' },
        { label: '用户管理', icon: Users, href: '/users', color: 'text-indigo-500' },
      ]
    }
  ]

  return (
    <PageContainer>
      <PageHeader 
        title="仪表盘" 
        description="系统概览与快捷入口"
        icon={LayoutDashboard}
      />
      
      {/* Stats Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Link key={stat.title} href={stat.href} className="animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
            <Card className="group relative overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer h-full border-0 shadow-md dark:shadow-none dark:border dark:border-border/50">
              <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${stat.gradient}`} />
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <div className={`p-2.5 rounded-xl bg-muted/50 group-hover:scale-110 transition-all duration-300`}>
                  <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tracking-tight">{stat.value}</div>
                <p className="text-xs text-muted-foreground mt-1.5">{stat.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 快捷入口 - 分组展示 */}
      <div className="grid gap-4 md:grid-cols-3">
        {quickGroups.map((group, groupIndex) => (
          <Card key={group.title} className="overflow-hidden border-border/50 animate-fade-in" style={{ animationDelay: `${200 + groupIndex * 80}ms` }}>
            <CardHeader className="pb-3 pt-4 border-b border-border/30">
              <CardTitle className="text-sm font-semibold text-foreground/80 tracking-wide uppercase">
                {group.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant="ghost"
                      className="w-full h-auto flex flex-col gap-2 py-4 hover:bg-accent hover:scale-105 transition-all duration-200 rounded-xl group"
                    >
                      <div className="p-2 rounded-lg bg-muted group-hover:bg-background transition-colors">
                        <item.icon className={`h-5 w-5 ${item.color}`} />
                      </div>
                      <span className="text-xs font-medium">{item.label}</span>
                    </Button>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Plug className="h-5 w-5" />
                渠道状态
              </CardTitle>
              <CardDescription>API渠道连接状态</CardDescription>
            </div>
            <Link href="/channels">
              <Button variant="ghost" size="sm">
                查看全部 <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.channels.slice(0, 5).map((channel) => (
                <div key={channel.id} className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{channel.name}</span>
                  <Badge variant={channel.status === 'active' ? 'default' : channel.status === 'error' ? 'destructive' : 'secondary'}>
                    {channel.status === 'active' ? '正常' : channel.status === 'error' ? '异常' : '未测试'}
                  </Badge>
                </div>
              ))}
              {(!data?.channels || data.channels.length === 0) && (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">暂无渠道配置</p>
                  <Link href="/channels">
                    <Button size="sm">添加渠道</Button>
                  </Link>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              系统状态
            </CardTitle>
            <CardDescription>插件运行状态</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">AI响应</span>
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">正常</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">MCP服务</span>
                <Badge variant={(data?.config as any)?.mcp?.enabled ? 'default' : 'secondary'}>
                  {(data?.config as any)?.mcp?.enabled ? '已启用' : '已禁用'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">伪人模式</span>
                <Badge variant={(data?.config as any)?.bym?.enable ? 'default' : 'secondary'}>
                  {(data?.config as any)?.bym?.enable ? '已启用' : '已禁用'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">MCP服务器</span>
                <Badge variant="outline">{data?.serversCount || 0} 个</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">可用工具</span>
                <Badge variant="outline">{data?.toolsCount || 0} 个</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
