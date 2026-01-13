'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { mcpApi, toolsApi } from '@/lib/api'
import { toast } from 'sonner'
import { ConnectionStatus } from '@/components/mcp/ConnectionStatus'
import { NpmPackageSelector, NpmPackageInfo } from '@/components/mcp/NpmPackageSelector'
import {
    RefreshCw,
    Server,
    Wrench,
    CheckCircle,
    XCircle,
    Loader2,
    Plus,
    Trash2,
    RotateCcw,
    FileJson,
    Code,
    Eye,
    Play,
    Copy,
    ChevronDown,
    ChevronUp,
    Image,
    Search,
    Clock,
    User,
    Users,
    MessageSquare,
    Shield,
    FolderOpen,
    Globe,
    Brain,
    History
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { CodeBlock } from '@/components/ui/code-block'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { KeyValueTable } from '@/components/ui/key-value-table'

// 工具类别图标映射
const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    basic: Clock,
    user: User,
    group: Users,
    message: MessageSquare,
    admin: Shield,
    file: FolderOpen,
    media: Image,
    web: Globe,
    search: Search,
    utils: Wrench,
    memory: Brain,
    context: History
}

interface ToolCategory {
    key: string
    name: string
    description: string
    icon: string
    toolCount: number
    tools: { name: string; description: string }[]
    enabled?: boolean
}

interface McpServer {
    name: string
    status: string
    type?: string
    config?: {
        type?: string
        command?: string
        args?: string[]
        url?: string
        package?: string
        env?: Record<string, string>
        headers?: Record<string, string>
    }
    toolsCount?: number
    resourcesCount?: number
    connectedAt?: number
}

interface McpTool {
    name: string
    description: string
    serverName: string
    isBuiltin: boolean
    isCustom: boolean
    inputSchema?: {
        properties?: Record<string, { type: string; description?: string }>
        required?: string[]
    }
}

export default function McpPage() {
    const [servers, setServers] = useState<McpServer[]>([])
    const [tools, setTools] = useState<McpTool[]>([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [importDialogOpen, setImportDialogOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [reconnecting, setReconnecting] = useState<string | null>(null)
    const [importJson, setImportJson] = useState('')
    const [serverForm, setServerForm] = useState({
        name: '',
        type: 'stdio',
        command: '',
        args: '',
        url: '',
        package: '',
        env: {} as Record<string, string>,
        headers: {} as Record<string, string>
    })

    // 工具详情弹窗
    const [detailDialogOpen, setDetailDialogOpen] = useState(false)
    const [selectedTool, setSelectedTool] = useState<McpTool | null>(null)

    // 工具测试弹窗
    const [testDialogOpen, setTestDialogOpen] = useState(false)
    const [testArgs, setTestArgs] = useState<Record<string, string>>({})
    const [testResult, setTestResult] = useState('')
    const [testLoading, setTestLoading] = useState(false)

    // 服务器编辑弹窗
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editingServer, setEditingServer] = useState<McpServer | null>(null)
    const [editForm, setEditForm] = useState({
        name: '',
        type: 'stdio',
        command: '',
        args: '',
        url: '',
        package: '',
        env: {} as Record<string, string>,
        headers: {} as Record<string, string>
    })
    const [editSaving, setEditSaving] = useState(false)

    // 工具类别
    const [categories, setCategories] = useState<ToolCategory[]>([])
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
    const [togglingCategory, setTogglingCategory] = useState<string | null>(null)

    // NPM 包快速选择
    const [showNpmSelector, setShowNpmSelector] = useState(false)

    const fetchData = useCallback(async () => {
        try {
            const [serversRes, toolsRes, categoriesRes] = await Promise.all([
                mcpApi.listServers(),
                toolsApi.list(),
                toolsApi.getCategories().catch(() => ({ data: [] }))
            ])
            const serversData = (serversRes as { data?: McpServer[] })?.data || []
            const toolsData = (toolsRes as { data?: McpTool[] })?.data || []
            const categoriesData = (categoriesRes as { data?: ToolCategory[] })?.data || []
            setServers(Array.isArray(serversData) ? serversData : [])
            setTools(Array.isArray(toolsData) ? toolsData : [])
            setCategories(Array.isArray(categoriesData) ? categoriesData : [])
        } catch (error) {
            toast.error('加载MCP数据失败')
            console.error(error)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // SSE 事件处理
    const handleSSEEvent = useCallback(
        (event: { event: string; data: Record<string, unknown> }) => {
            // 根据事件类型刷新数据
            if (
                event.event.startsWith('server-') ||
                event.event.startsWith('tool') ||
                event.event.startsWith('category')
            ) {
                fetchData()
            }
        },
        [fetchData]
    )

    const handleRefresh = () => {
        setRefreshing(true)
        fetchData()
    }

    const resetServerForm = () => {
        setServerForm({
            name: '',
            type: 'stdio',
            command: '',
            args: '',
            url: '',
            package: '',
            env: {},
            headers: {}
        })
        setShowNpmSelector(false)
    }

    // 处理 NPM 包选择
    const handleNpmPackageSelect = (pkg: NpmPackageInfo) => {
        setServerForm({
            ...serverForm,
            name: pkg.name.toLowerCase().replace(/\s+/g, '-'),
            type: 'npm',
            package: pkg.package,
            args: pkg.args || '',
            env: pkg.env || {}
        })
        setShowNpmSelector(false)
    }

    const handleAddServer = async () => {
        if (!serverForm.name) {
            toast.error('请输入服务器名称')
            return
        }

        setSaving(true)
        try {
            const config: Record<string, unknown> = { type: serverForm.type }

            if (serverForm.type === 'stdio') {
                if (!serverForm.command) {
                    toast.error('请输入命令')
                    setSaving(false)
                    return
                }
                config.command = serverForm.command
                if (serverForm.args) {
                    config.args = serverForm.args.split(' ').filter(a => a)
                }
            } else if (serverForm.type === 'npm') {
                if (!serverForm.package) {
                    toast.error('请输入NPM包名')
                    setSaving(false)
                    return
                }
                config.package = serverForm.package
                if (serverForm.args) {
                    config.args = serverForm.args.split(' ').filter(a => a)
                }
            } else {
                if (!serverForm.url) {
                    toast.error('请输入URL')
                    setSaving(false)
                    return
                }
                config.url = serverForm.url
                if (Object.keys(serverForm.headers).length > 0) {
                    config.headers = serverForm.headers
                }
            }

            if (Object.keys(serverForm.env).length > 0) {
                config.env = serverForm.env
            }

            await mcpApi.createServer({ name: serverForm.name, config })
            toast.success('服务器添加成功')
            setAddDialogOpen(false)
            resetServerForm()
            fetchData()
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } }
            toast.error(err.response?.data?.message || '添加失败')
        } finally {
            setSaving(false)
        }
    }

    const handleReconnect = async (name: string) => {
        setReconnecting(name)
        try {
            await mcpApi.reconnectServer(name)
            toast.success('重连成功')
            fetchData()
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } }
            toast.error(err.response?.data?.message || '重连失败')
        } finally {
            setReconnecting(null)
        }
    }

    const handleDeleteServer = async (name: string) => {
        if (!confirm(`确定要删除服务器 "${name}" 吗？`)) return
        try {
            await mcpApi.deleteServer(name)
            toast.success('服务器已删除')
            fetchData()
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } }
            toast.error(err.response?.data?.message || '删除失败')
        }
    }

    const handleImport = async () => {
        if (!importJson.trim()) {
            toast.error('请输入 JSON 配置')
            return
        }

        try {
            const config = JSON.parse(importJson)
            const res = (await mcpApi.importConfig(config)) as { data?: { success?: number; total?: number } }
            const result = res?.data || {}
            toast.success(`导入完成: 成功 ${result.success || 0}/${result.total || 0}`)
            setImportDialogOpen(false)
            setImportJson('')
            fetchData()
        } catch (error) {
            if (error instanceof SyntaxError) {
                toast.error('JSON 格式错误')
            } else {
                toast.error('导入失败')
            }
        }
    }

    // 查看工具详情
    const handleViewDetail = (tool: McpTool) => {
        setSelectedTool(tool)
        setDetailDialogOpen(true)
    }

    // 打开测试弹窗
    const handleOpenTest = (tool: McpTool) => {
        setSelectedTool(tool)
        // 生成默认参数
        const defaultArgs: Record<string, string> = {}
        if (tool.inputSchema?.properties) {
            Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
                if (prop.type === 'string') defaultArgs[key] = ''
                else if (prop.type === 'number') defaultArgs[key] = '0'
                else if (prop.type === 'boolean') defaultArgs[key] = 'false'
                else if (prop.type === 'array') defaultArgs[key] = '[]'
                else if (prop.type === 'object') defaultArgs[key] = '{}'
                else defaultArgs[key] = ''
            })
        }
        setTestArgs(defaultArgs)
        setTestResult('')
        setTestDialogOpen(true)
    }

    // 执行工具测试
    const handleTestTool = async () => {
        if (!selectedTool) return
        setTestLoading(true)
        setTestResult('')
        try {
            // 将 Record<string, string> 转换为正确的类型
            const args: Record<string, unknown> = {}
            const schema = selectedTool.inputSchema?.properties || {}
            Object.entries(testArgs).forEach(([key, value]) => {
                const propType = schema[key]?.type
                if (propType === 'number') {
                    args[key] = Number(value) || 0
                } else if (propType === 'boolean') {
                    args[key] = value === 'true'
                } else if (propType === 'array' || propType === 'object') {
                    try {
                        args[key] = JSON.parse(value)
                    } catch {
                        args[key] = value
                    }
                } else {
                    args[key] = value
                }
            })
            const res = (await toolsApi.test({ toolName: selectedTool.name, arguments: args })) as { data?: unknown }
            if (res?.data !== undefined) {
                setTestResult(JSON.stringify(res.data, null, 2))
                toast.success('测试成功')
            } else {
                setTestResult(JSON.stringify(res, null, 2))
            }
        } catch (error) {
            const err = error as { response?: { data?: { message?: string } }; message?: string }
            const msg = err?.response?.data?.message || err?.message || '测试失败'
            setTestResult(`Error: ${msg}`)
            toast.error('测试失败: ' + msg)
        } finally {
            setTestLoading(false)
        }
    }

    // 打开编辑服务器弹窗
    const handleOpenEdit = async (server: McpServer) => {
        try {
            // 获取完整的服务器配置
            const res = (await mcpApi.getServer(server.name)) as { data?: McpServer }
            const fullServer = res?.data || server
            setEditingServer(fullServer)
            const config = fullServer.config || {}
            // 优先使用 config.type，否则使用 server.type
            const serverType = config.type || fullServer.type || 'stdio'
            setEditForm({
                name: fullServer.name,
                type: serverType,
                command: config.command || '',
                args: config.args?.join(' ') || '',
                url: config.url || '',
                package: config.package || '',
                env: config.env || {},
                headers: config.headers || {}
            })
            setEditDialogOpen(true)
        } catch (error) {
            console.error('Failed to load server config:', error)
            toast.error('加载服务器配置失败')
        }
    }

    // 保存服务器编辑
    const handleSaveEdit = async () => {
        if (!editingServer) return
        setEditSaving(true)
        try {
            const config: Record<string, unknown> = { type: editForm.type }

            if (editForm.type === 'stdio') {
                config.command = editForm.command
                if (editForm.args) {
                    config.args = editForm.args.split(' ').filter(a => a)
                }
            } else if (editForm.type === 'npm') {
                config.package = editForm.package
                if (editForm.args) {
                    config.args = editForm.args.split(' ').filter(a => a)
                }
            } else {
                config.url = editForm.url
                if (Object.keys(editForm.headers).length > 0) {
                    config.headers = editForm.headers
                }
            }

            if (Object.keys(editForm.env).length > 0) {
                config.env = editForm.env
            }

            await mcpApi.updateServer(editingServer.name, { config })
            toast.success('服务器配置已更新')
            setEditDialogOpen(false)
            setEditingServer(null)
            fetchData()
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } } }
            toast.error(err.response?.data?.message || '更新失败')
        } finally {
            setEditSaving(false)
        }
    }

    // 复制工具为 JS 工具
    const handleCopyToJsTool = async (tool: McpTool) => {
        const toolName = `custom_${tool.name.replace(/[^a-zA-Z0-9_]/g, '_')}`
        const source = `/**
 * 基于 ${tool.name} 创建的自定义工具
 * 原始来源: ${tool.serverName || 'unknown'}
 */

export default {
  name: '${toolName}',
  
  function: {
    name: '${toolName}',
    description: '${(tool.description || '').replace(/'/g, "\\'")}',
    parameters: ${JSON.stringify(tool.inputSchema || { type: 'object', properties: {} }, null, 4)
        .split('\n')
        .join('\n    ')}
  },

  async run(args, context) {
    // TODO: 实现工具逻辑
    // args: 输入参数
    // context: 上下文信息，包含 getEvent(), getBot() 等
    
    return {
      success: true,
      message: '工具执行成功',
      args
    }
  }
}
`

        try {
            await toolsApi.createJs({ name: toolName, source })
            toast.success(`已复制为 JS 工具: ${toolName}`)
        } catch (error) {
            const err = error as { response?: { data?: { message?: string } }; message?: string }
            toast.error('复制失败: ' + (err?.response?.data?.message || err?.message || '未知错误'))
        }
    }

    // 切换工具类别
    const handleToggleCategory = async (categoryKey: string, enabled: boolean) => {
        setTogglingCategory(categoryKey)
        try {
            await toolsApi.toggleCategory(categoryKey, enabled)
            setCategories(prev => prev.map(cat => (cat.key === categoryKey ? { ...cat, enabled } : cat)))
            toast.success(`${enabled ? '启用' : '禁用'}成功`)
            // 刷新工具列表
            const toolsRes = await toolsApi.list()
            const toolsData = (toolsRes as { data?: McpTool[] })?.data || []
            setTools(Array.isArray(toolsData) ? toolsData : [])
        } catch (error) {
            const err = error as { response?: { data?: { message?: string } }; message?: string }
            toast.error('操作失败: ' + (err?.response?.data?.message || err?.message || '未知错误'))
        } finally {
            setTogglingCategory(null)
        }
    }

    // 安全的工具分类
    const builtinTools = tools.filter(t => t?.isBuiltin || t?.serverName === 'builtin')
    const externalTools = tools.filter(t => t && !t.isBuiltin && t.serverName !== 'builtin')

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
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold">MCP 工具管理</h2>
                    <ConnectionStatus showDetails onEvent={handleSSEEvent} />
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                        {refreshing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        刷新
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                        <FileJson className="mr-2 h-4 w-4" />
                        导入配置
                    </Button>
                    <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        添加服务器
                    </Button>
                </div>
            </div>

            {/* 统计卡片 */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">服务器数</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <div className="text-2xl font-bold">{servers.length}</div>
                            {servers.length > 0 && (
                                <div className="flex items-center gap-1 text-xs">
                                    <span className="flex items-center text-green-600">
                                        <CheckCircle className="h-3 w-3 mr-0.5" />
                                        {servers.filter(s => s.status === 'connected').length}
                                    </span>
                                    <span className="text-muted-foreground">/</span>
                                    <span className="flex items-center text-gray-500">
                                        <XCircle className="h-3 w-3 mr-0.5" />
                                        {servers.filter(s => s.status !== 'connected').length}
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">工具总数</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{tools.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">内置工具</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{builtinTools.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">外部工具</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{externalTools.length}</div>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="servers">
                <TabsList>
                    <TabsTrigger value="servers" className="flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        服务器 ({servers.length})
                    </TabsTrigger>
                    <TabsTrigger value="tools" className="flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        工具 ({tools.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="servers" className="space-y-4">
                    {servers.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <Server className="h-12 w-12 text-muted-foreground mb-4" />
                                <p className="text-muted-foreground">暂无MCP服务器</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                            {servers.map(server => (
                                <Card
                                    key={server.name}
                                    className={`transition-all border-l-4 ${server.status === 'connected' ? 'border-l-green-500' : 'border-l-gray-300'}`}
                                >
                                    <CardHeader className="pb-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className={`w-2 h-2 rounded-full ${server.status === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
                                                />
                                                <CardTitle className="text-base">{server.name}</CardTitle>
                                            </div>
                                            <Badge
                                                variant={server.status === 'connected' ? 'default' : 'secondary'}
                                                className={
                                                    server.status === 'connected'
                                                        ? 'bg-green-100 text-green-700 hover:bg-green-100'
                                                        : ''
                                                }
                                            >
                                                {server.status === 'connected' ? (
                                                    <>
                                                        <CheckCircle className="h-3 w-3 mr-1" /> 已连接
                                                    </>
                                                ) : (
                                                    <>
                                                        <XCircle className="h-3 w-3 mr-1" /> 离线
                                                    </>
                                                )}
                                            </Badge>
                                        </div>
                                        <CardDescription className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-xs">
                                                {server.config?.type || server.type || '未知'}
                                            </Badge>
                                            {server.config?.package && (
                                                <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                                                    {server.config.package}
                                                </span>
                                            )}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {/* 服务器信息表格 */}
                                        <div className="border rounded-lg overflow-hidden text-sm">
                                            <table className="w-full">
                                                <tbody className="divide-y divide-border">
                                                    <tr>
                                                        <td className="px-3 py-2 text-muted-foreground bg-muted/30 w-24">
                                                            工具数
                                                        </td>
                                                        <td className="px-3 py-2 font-medium">
                                                            {server.toolsCount || 0}
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td className="px-3 py-2 text-muted-foreground bg-muted/30">
                                                            资源数
                                                        </td>
                                                        <td className="px-3 py-2 font-medium">
                                                            {server.resourcesCount || 0}
                                                        </td>
                                                    </tr>
                                                    {server.connectedAt && (
                                                        <tr>
                                                            <td className="px-3 py-2 text-muted-foreground bg-muted/30">
                                                                连接时间
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                {new Date(server.connectedAt).toLocaleString('zh-CN')}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {server.config?.command && (
                                                        <tr>
                                                            <td className="px-3 py-2 text-muted-foreground bg-muted/30">
                                                                命令
                                                            </td>
                                                            <td className="px-3 py-2 font-mono text-xs truncate max-w-[180px]">
                                                                {server.config.command}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {server.config?.args && server.config.args.length > 0 && (
                                                        <tr>
                                                            <td className="px-3 py-2 text-muted-foreground bg-muted/30">
                                                                参数
                                                            </td>
                                                            <td className="px-3 py-2 font-mono text-xs truncate max-w-[180px]">
                                                                {server.config.args.join(' ')}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {server.config?.package && (
                                                        <tr>
                                                            <td className="px-3 py-2 text-muted-foreground bg-muted/30">
                                                                NPM 包
                                                            </td>
                                                            <td className="px-3 py-2 font-mono text-xs truncate max-w-[180px]">
                                                                {server.config.package}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    {server.config?.url && (
                                                        <tr>
                                                            <td className="px-3 py-2 text-muted-foreground bg-muted/30">
                                                                URL
                                                            </td>
                                                            <td className="px-3 py-2 font-mono text-xs truncate max-w-[180px]">
                                                                {server.config.url}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* 操作按钮 */}
                                        <div className="flex gap-2 pt-2 border-t">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="flex-1"
                                                onClick={() => handleReconnect(server.name)}
                                                disabled={reconnecting === server.name}
                                            >
                                                {reconnecting === server.name ? (
                                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                                )}
                                                重连
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleOpenEdit(server)}>
                                                <Code className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                onClick={() => handleDeleteServer(server.name)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="tools" className="space-y-4">
                    <Tabs defaultValue="builtin">
                        <TabsList className="flex-wrap h-auto gap-1">
                            <TabsTrigger value="builtin">内置工具 ({builtinTools.length})</TabsTrigger>
                            <TabsTrigger value="external">外部工具 ({externalTools.length})</TabsTrigger>
                        </TabsList>

                        {/* 内置工具 - 按类别分组 */}
                        <TabsContent value="builtin" className="space-y-4">
                            {categories.length > 0 ? (
                                <div className="max-h-[70vh] overflow-y-auto">
                                    <div className="space-y-3 pr-2">
                                        {categories.map(category => {
                                            const IconComponent = categoryIcons[category.key] || Wrench
                                            const isExpanded = expandedCategory === category.key
                                            const categoryTools = builtinTools.filter(t =>
                                                category.tools.some(ct => ct.name === t.name)
                                            )

                                            return (
                                                <Card
                                                    key={category.key}
                                                    className={`transition-all ${category.enabled === false ? 'opacity-60' : ''}`}
                                                >
                                                    <Collapsible
                                                        open={isExpanded}
                                                        onOpenChange={() =>
                                                            setExpandedCategory(isExpanded ? null : category.key)
                                                        }
                                                    >
                                                        <CollapsibleTrigger asChild>
                                                            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="p-2 rounded-lg bg-primary/10">
                                                                            <IconComponent className="h-5 w-5 text-primary" />
                                                                        </div>
                                                                        <div>
                                                                            <CardTitle className="text-base flex items-center gap-2">
                                                                                {category.name}
                                                                                <Badge
                                                                                    variant="secondary"
                                                                                    className="text-xs"
                                                                                >
                                                                                    {category.toolCount} 工具
                                                                                </Badge>
                                                                            </CardTitle>
                                                                            <CardDescription className="text-xs mt-0.5">
                                                                                {category.description}
                                                                            </CardDescription>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-3">
                                                                        <div
                                                                            className="flex items-center gap-2"
                                                                            onClick={e => e.stopPropagation()}
                                                                        >
                                                                            <Switch
                                                                                checked={category.enabled !== false}
                                                                                onCheckedChange={checked =>
                                                                                    handleToggleCategory(
                                                                                        category.key,
                                                                                        checked
                                                                                    )
                                                                                }
                                                                                disabled={
                                                                                    togglingCategory === category.key
                                                                                }
                                                                            />
                                                                            {togglingCategory === category.key && (
                                                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                                            )}
                                                                        </div>
                                                                        {isExpanded ? (
                                                                            <ChevronUp className="h-4 w-4" />
                                                                        ) : (
                                                                            <ChevronDown className="h-4 w-4" />
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </CardHeader>
                                                        </CollapsibleTrigger>
                                                        <CollapsibleContent>
                                                            <CardContent className="pt-0">
                                                                <div className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
                                                                    {categoryTools.map(tool => (
                                                                        <div
                                                                            key={tool.name}
                                                                            className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
                                                                        >
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-center gap-2">
                                                                                    <Code className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                                                                    <span className="font-medium text-sm truncate">
                                                                                        {tool.name}
                                                                                    </span>
                                                                                </div>
                                                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-1 pl-5">
                                                                                    {tool.description || '无描述'}
                                                                                </p>
                                                                            </div>
                                                                            <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="h-7 w-7"
                                                                                    onClick={() =>
                                                                                        handleViewDetail(tool)
                                                                                    }
                                                                                >
                                                                                    <Eye className="h-3.5 w-3.5" />
                                                                                </Button>
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="icon"
                                                                                    className="h-7 w-7"
                                                                                    onClick={() => handleOpenTest(tool)}
                                                                                >
                                                                                    <Play className="h-3.5 w-3.5" />
                                                                                </Button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </CardContent>
                                                        </CollapsibleContent>
                                                    </Collapsible>
                                                </Card>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <Card>
                                    <CardContent className="flex flex-col items-center justify-center py-12">
                                        <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-muted-foreground">暂无内置工具类别</p>
                                    </CardContent>
                                </Card>
                            )}
                        </TabsContent>

                        {/* 外部工具 */}
                        <TabsContent value="external">
                            {externalTools.length === 0 ? (
                                <Card>
                                    <CardContent className="flex flex-col items-center justify-center py-12">
                                        <Server className="h-12 w-12 text-muted-foreground mb-4" />
                                        <p className="text-muted-foreground">暂无外部 MCP 工具</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            添加 MCP 服务器后，其工具将显示在这里
                                        </p>
                                    </CardContent>
                                </Card>
                            ) : (
                                <ScrollArea className="h-[500px]">
                                    <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                                        {externalTools.map(tool => (
                                            <Card key={tool.name} className="hover:shadow-md transition-shadow group">
                                                <CardContent className="p-4">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <Server className="h-4 w-4 text-blue-500" />
                                                                <span className="font-medium truncate">
                                                                    {tool.name}
                                                                </span>
                                                                <Badge variant="outline" className="text-xs shrink-0">
                                                                    {tool.serverName}
                                                                </Badge>
                                                            </div>
                                                            <p className="text-sm text-muted-foreground line-clamp-2">
                                                                {tool.description || '无描述'}
                                                            </p>
                                                            {tool.inputSchema?.properties && (
                                                                <div className="mt-2 flex flex-wrap gap-1">
                                                                    {Object.keys(tool.inputSchema.properties)
                                                                        .slice(0, 3)
                                                                        .map(param => (
                                                                            <Badge
                                                                                key={param}
                                                                                variant="secondary"
                                                                                className="text-xs"
                                                                            >
                                                                                {param}
                                                                            </Badge>
                                                                        ))}
                                                                    {Object.keys(tool.inputSchema.properties).length >
                                                                        3 && (
                                                                        <Badge variant="secondary" className="text-xs">
                                                                            +
                                                                            {Object.keys(tool.inputSchema.properties)
                                                                                .length - 3}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => handleViewDetail(tool)}
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => handleOpenTest(tool)}
                                                            >
                                                                <Play className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => handleCopyToJsTool(tool)}
                                                                title="复制为 JS 工具"
                                                            >
                                                                <Copy className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </TabsContent>
                    </Tabs>
                </TabsContent>
            </Tabs>

            {/* 添加服务器对话框 */}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>添加 MCP 服务器</DialogTitle>
                        <DialogDescription>配置新的 MCP 服务器连接，或从常用包中快速选择</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>名称</Label>
                                <Input
                                    value={serverForm.name}
                                    onChange={e => setServerForm({ ...serverForm, name: e.target.value })}
                                    placeholder="服务器名称"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>类型</Label>
                                <Select
                                    value={serverForm.type}
                                    onValueChange={v => {
                                        setServerForm({ ...serverForm, type: v })
                                        if (v === 'npm') setShowNpmSelector(true)
                                        else setShowNpmSelector(false)
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="stdio">Stdio (本地命令)</SelectItem>
                                        <SelectItem value="npm">NPM 包 (npx)</SelectItem>
                                        <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                                        <SelectItem value="http">HTTP</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {serverForm.type === 'stdio' && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>命令</Label>
                                    <Input
                                        value={serverForm.command}
                                        onChange={e => setServerForm({ ...serverForm, command: e.target.value })}
                                        placeholder="例如: node, npx, python"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>参数 (空格分隔)</Label>
                                    <Input
                                        value={serverForm.args}
                                        onChange={e => setServerForm({ ...serverForm, args: e.target.value })}
                                        placeholder="-y @modelcontextprotocol/server-filesystem /"
                                    />
                                </div>
                            </div>
                        )}

                        {serverForm.type === 'npm' && (
                            <>
                                {/* NPM 包快速选择 */}
                                {showNpmSelector && (
                                    <div className="border rounded-lg p-4 bg-muted/30">
                                        <div className="flex items-center justify-between mb-3">
                                            <Label className="text-sm font-medium">快速选择常用包</Label>
                                            <Button variant="ghost" size="sm" onClick={() => setShowNpmSelector(false)}>
                                                手动输入
                                            </Button>
                                        </div>
                                        <NpmPackageSelector
                                            onSelect={handleNpmPackageSelect}
                                            selectedPackage={serverForm.package}
                                        />
                                    </div>
                                )}

                                {!showNpmSelector && (
                                    <>
                                        <div className="flex items-center justify-between">
                                            <Label className="text-sm font-medium">NPM 包配置</Label>
                                            <Button variant="ghost" size="sm" onClick={() => setShowNpmSelector(true)}>
                                                从列表选择
                                            </Button>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label>NPM 包名</Label>
                                                <Input
                                                    value={serverForm.package}
                                                    onChange={e =>
                                                        setServerForm({ ...serverForm, package: e.target.value })
                                                    }
                                                    placeholder="@modelcontextprotocol/server-filesystem"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>参数 (空格分隔)</Label>
                                                <Input
                                                    value={serverForm.args}
                                                    onChange={e =>
                                                        setServerForm({ ...serverForm, args: e.target.value })
                                                    }
                                                    placeholder="/"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        {(serverForm.type === 'sse' || serverForm.type === 'http') && (
                            <>
                                <div className="space-y-2">
                                    <Label>URL</Label>
                                    <Input
                                        value={serverForm.url}
                                        onChange={e => setServerForm({ ...serverForm, url: e.target.value })}
                                        placeholder={
                                            serverForm.type === 'sse'
                                                ? 'http://localhost:8080/sse'
                                                : 'http://localhost:8080/mcp'
                                        }
                                    />
                                </div>
                                <KeyValueTable
                                    title="请求头列表"
                                    value={serverForm.headers}
                                    onChange={headers => setServerForm({ ...serverForm, headers })}
                                    keyPlaceholder="Header 名称"
                                    valuePlaceholder="Header 值"
                                />
                            </>
                        )}

                        <KeyValueTable
                            title="环境变量 (可选)"
                            value={serverForm.env}
                            onChange={env => setServerForm({ ...serverForm, env })}
                            keyPlaceholder="变量名"
                            valuePlaceholder="变量值"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleAddServer} disabled={saving}>
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            添加
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 导入配置对话框 */}
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                <DialogContent className="w-[95vw] max-w-lg">
                    <DialogHeader>
                        <DialogTitle>导入 MCP 配置</DialogTitle>
                        <DialogDescription>粘贴 Claude Desktop 或其他 MCP 客户端的配置 JSON</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Textarea
                            value={importJson}
                            onChange={e => setImportJson(e.target.value)}
                            placeholder={
                                '{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-xxx"]\n    }\n  }\n}'
                            }
                            rows={12}
                            className="font-mono text-sm"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleImport}>导入</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 工具详情弹窗 */}
            <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>工具详情</DialogTitle>
                        <DialogDescription>{selectedTool?.name}</DialogDescription>
                    </DialogHeader>
                    {selectedTool && (
                        <div className="space-y-4">
                            <div>
                                <Label className="text-muted-foreground">名称</Label>
                                <p className="font-medium">{selectedTool.name}</p>
                            </div>
                            <div>
                                <Label className="text-muted-foreground">描述</Label>
                                <p>{selectedTool.description || '无描述'}</p>
                            </div>
                            <div>
                                <Label className="text-muted-foreground">来源</Label>
                                <Badge variant="outline" className="ml-2">
                                    {selectedTool.serverName || 'builtin'}
                                </Badge>
                            </div>
                            <div>
                                <Label className="text-muted-foreground">输入参数</Label>
                                <CodeBlock
                                    code={JSON.stringify(selectedTool.inputSchema || {}, null, 2)}
                                    language="json"
                                    className="mt-2"
                                    maxHeight="300px"
                                />
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 工具测试弹窗 */}
            <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>测试工具</DialogTitle>
                        <DialogDescription>{selectedTool?.name}</DialogDescription>
                    </DialogHeader>
                    {selectedTool && (
                        <div className="space-y-4">
                            <KeyValueTable
                                title="参数列表"
                                value={testArgs}
                                onChange={setTestArgs}
                                keyPlaceholder="参数名"
                                valuePlaceholder="参数值"
                            />
                            <div className="flex gap-2">
                                <Button onClick={handleTestTool} disabled={testLoading}>
                                    {testLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    执行测试
                                </Button>
                                <Button variant="outline" onClick={() => handleOpenTest(selectedTool)}>
                                    重置参数
                                </Button>
                            </div>
                            {testResult && (
                                <div>
                                    <Label>测试结果</Label>
                                    {testResult.startsWith('Error') ? (
                                        <pre className="mt-2 p-3 rounded-lg text-sm overflow-auto max-h-[300px] bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300">
                                            {testResult}
                                        </pre>
                                    ) : (
                                        <CodeBlock
                                            code={testResult}
                                            language="json"
                                            className="mt-2"
                                            maxHeight="300px"
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 编辑服务器弹窗 */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>编辑服务器</DialogTitle>
                        <DialogDescription>修改 {editingServer?.name} 的配置</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {/* 服务器名称（只读） */}
                        <div className="space-y-2">
                            <Label>名称</Label>
                            <Input value={editForm.name} disabled className="bg-muted" />
                        </div>

                        {/* 类型选择 */}
                        <div className="space-y-2">
                            <Label>类型</Label>
                            <Select value={editForm.type} onValueChange={v => setEditForm({ ...editForm, type: v })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="stdio">Stdio (本地命令)</SelectItem>
                                    <SelectItem value="npm">NPM 包 (npx)</SelectItem>
                                    <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                                    <SelectItem value="http">HTTP</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Stdio 配置 */}
                        {editForm.type === 'stdio' && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>命令</Label>
                                    <Input
                                        value={editForm.command}
                                        onChange={e => setEditForm({ ...editForm, command: e.target.value })}
                                        placeholder="例如: node, python"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>参数 (空格分隔)</Label>
                                    <Input
                                        value={editForm.args}
                                        onChange={e => setEditForm({ ...editForm, args: e.target.value })}
                                        placeholder="server.js --port 3000"
                                    />
                                </div>
                            </div>
                        )}

                        {/* NPM 配置 */}
                        {editForm.type === 'npm' && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>NPM 包名</Label>
                                    <Input
                                        value={editForm.package}
                                        onChange={e => setEditForm({ ...editForm, package: e.target.value })}
                                        placeholder="@modelcontextprotocol/server-filesystem"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>参数 (空格分隔)</Label>
                                    <Input
                                        value={editForm.args}
                                        onChange={e => setEditForm({ ...editForm, args: e.target.value })}
                                        placeholder="/"
                                    />
                                </div>
                            </div>
                        )}

                        {/* SSE/HTTP 配置 */}
                        {(editForm.type === 'sse' || editForm.type === 'http') && (
                            <>
                                <div className="space-y-2">
                                    <Label>URL</Label>
                                    <Input
                                        value={editForm.url}
                                        onChange={e => setEditForm({ ...editForm, url: e.target.value })}
                                        placeholder="http://localhost:8080/mcp"
                                    />
                                </div>
                                <KeyValueTable
                                    title="请求头列表"
                                    value={editForm.headers}
                                    onChange={headers => setEditForm({ ...editForm, headers })}
                                    keyPlaceholder="Header 名称"
                                    valuePlaceholder="Header 值"
                                />
                            </>
                        )}

                        {/* 环境变量 */}
                        <KeyValueTable
                            title="环境变量 (可选)"
                            value={editForm.env}
                            onChange={env => setEditForm({ ...editForm, env })}
                            keyPlaceholder="变量名"
                            valuePlaceholder="变量值"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSaveEdit} disabled={editSaving}>
                            {editSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
