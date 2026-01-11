'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CodeEditor } from '@/components/ui/code-editor'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    AlertTriangle,
    Eye,
    Play,
    RefreshCw,
    Search,
    Settings,
    Wrench,
    Loader2,
    X,
    Plus,
    Edit,
    Trash2,
    Code,
    FileCode,
    Power,
    PowerOff,
    RotateCcw,
    Activity,
    Zap,
    FileSearch
} from 'lucide-react'
import { toolsApi } from '@/lib/api'
import { toast } from 'sonner'
import { CodeBlock } from '@/components/ui/code-block'

interface Tool {
    name: string
    description?: string
    serverName?: string
    isBuiltin?: boolean
    isJs?: boolean
    code?: string
    inputSchema?: {
        properties?: Record<
            string,
            {
                type?: string
                description?: string
                default?: unknown
            }
        >
    }
}

interface JsTool {
    name: string
    filename: string
    description: string
    parameters?: string
    code?: string
}

interface BuiltinConfig {
    enabled: boolean
    allowDangerous: boolean
    dangerousTools: string[]
    allowedTools: string[]
    disabledTools: string[]
}

interface ToolStats {
    total: number
    enabled: number
    disabled: number
    categories: Record<string, { name: string; total: number; enabled: number; disabled: number }>
    jsTools: { total: number; enabled: number; disabled: number }
}

interface EventProbabilityConfig {
    enabled: boolean
    probability: number
    enabledEvents: string[]
    eventProbabilities: Record<string, number>
}

interface WatcherStatus {
    enabled: boolean
    watchPath: string
    jsToolsCount: number
}

export default function ToolsPage() {
    const [tools, setTools] = useState<Tool[]>([])
    const [loading, setLoading] = useState(true)
    const [searchText, setSearchText] = useState('')
    const [filterType, setFilterType] = useState<string>('__all__')
    const [filterServer, setFilterServer] = useState<string>('__all__')

    // 弹窗状态
    const [detailOpen, setDetailOpen] = useState(false)
    const [testOpen, setTestOpen] = useState(false)
    const [configOpen, setConfigOpen] = useState(false)
    const [selectedTool, setSelectedTool] = useState<Tool | null>(null)

    // 测试状态
    const [testArgs, setTestArgs] = useState('{}')
    const [testResult, setTestResult] = useState('')
    const [testLoading, setTestLoading] = useState(false)

    // 内置工具配置
    const [builtinConfig, setBuiltinConfig] = useState<BuiltinConfig>({
        enabled: true,
        allowDangerous: false,
        dangerousTools: ['kick_member', 'mute_member', 'recall_message'],
        allowedTools: [],
        disabledTools: []
    })
    const [configSaving, setConfigSaving] = useState(false)
    const [newDangerousTool, setNewDangerousTool] = useState('')
    const [newAllowedTool, setNewAllowedTool] = useState('')
    const [newDisabledTool, setNewDisabledTool] = useState('')

    // JS工具编辑
    const [jsTools, setJsTools] = useState<JsTool[]>([])
    const [jsEditOpen, setJsEditOpen] = useState(false)
    const [jsEditMode, setJsEditMode] = useState(false)

    // 新增状态
    const [toolStats, setToolStats] = useState<ToolStats | null>(null)
    const [eventProbConfig, setEventProbConfig] = useState<EventProbabilityConfig>({
        enabled: true,
        probability: 1.0,
        enabledEvents: ['poke', 'recall', 'welcome', 'goodbye'],
        eventProbabilities: {}
    })
    const [watcherStatus, setWatcherStatus] = useState<WatcherStatus>({
        enabled: false,
        watchPath: '',
        jsToolsCount: 0
    })
    const [eventProbOpen, setEventProbOpen] = useState(false)
    const [reloadingAll, setReloadingAll] = useState(false)
    const [enablingAll, setEnablingAll] = useState(false)
    const [disablingAll, setDisablingAll] = useState(false)
    const [togglingWatcher, setTogglingWatcher] = useState(false)
    const [jsForm, setJsForm] = useState({
        name: '',
        filename: '',
        description: '',
        parameters: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
        code: '// 工具代码\nasync function execute(args, context) {\n  // args: 输入参数\n  // context: 上下文信息\n  return { result: "success" }\n}'
    })
    const [jsSaving, setJsSaving] = useState(false)

    // 获取工具列表
    const fetchTools = async () => {
        setLoading(true)
        try {
            const res = (await toolsApi.list()) as { data?: Tool[] }
            const data = res?.data || []
            setTools(Array.isArray(data) ? data : [])
            toast.success(`成功加载 ${Array.isArray(data) ? data.length : 0} 个工具`)
        } catch (error) {
            toast.error('获取工具列表失败')
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    // 获取内置工具配置
    const fetchBuiltinConfig = async () => {
        try {
            const res = (await toolsApi.getBuiltinConfig()) as { data?: BuiltinConfig }
            if (res?.data) {
                setBuiltinConfig(res.data)
            }
        } catch (error) {
            console.error('Failed to fetch builtin config', error)
        }
    }

    // 获取 JS 工具列表
    const fetchJsTools = async () => {
        try {
            const res = (await toolsApi.getJs()) as { data?: JsTool[] }
            setJsTools(res?.data || [])
        } catch (error) {
            console.error('Failed to fetch JS tools', error)
        }
    }

    // 获取工具统计
    const fetchToolStats = async () => {
        try {
            const res = (await toolsApi.getStats()) as { data?: ToolStats }
            if (res?.data) setToolStats(res.data)
        } catch (error) {
            console.error('Failed to fetch tool stats', error)
        }
    }

    // 获取事件概率配置
    const fetchEventProbability = async () => {
        try {
            const res = (await toolsApi.getEventProbability()) as { data?: EventProbabilityConfig }
            if (res?.data) setEventProbConfig(res.data)
        } catch (error) {
            console.error('Failed to fetch event probability', error)
        }
    }

    // 获取文件监听器状态
    const fetchWatcherStatus = async () => {
        try {
            const res = (await toolsApi.getWatcherStatus()) as { data?: WatcherStatus }
            if (res?.data) setWatcherStatus(res.data)
        } catch (error) {
            console.error('Failed to fetch watcher status', error)
        }
    }

    // 一键启用所有工具
    const enableAllTools = async () => {
        setEnablingAll(true)
        try {
            const res = (await toolsApi.enableAll()) as { data?: { enabledCount: number } }
            toast.success(`已启用 ${res?.data?.enabledCount || 0} 个工具`)
            fetchTools()
            fetchToolStats()
        } catch (error) {
            toast.error('启用失败')
        } finally {
            setEnablingAll(false)
        }
    }

    // 一键禁用所有工具
    const disableAllTools = async () => {
        setDisablingAll(true)
        try {
            const res = (await toolsApi.disableAll()) as { data?: { disabledCount: number } }
            toast.success(`已禁用 ${res?.data?.disabledCount || 0} 个工具`)
            fetchTools()
            fetchToolStats()
        } catch (error) {
            toast.error('禁用失败')
        } finally {
            setDisablingAll(false)
        }
    }

    // 热重载所有工具
    const reloadAllTools = async () => {
        setReloadingAll(true)
        try {
            const res = (await toolsApi.reloadAll()) as { data?: { totalCount: number } }
            toast.success(`已重载 ${res?.data?.totalCount || 0} 个工具`)
            fetchTools()
            fetchJsTools()
            fetchToolStats()
        } catch (error) {
            toast.error('重载失败')
        } finally {
            setReloadingAll(false)
        }
    }

    // 切换文件监听器
    const toggleWatcher = async () => {
        setTogglingWatcher(true)
        try {
            const newEnabled = !watcherStatus.enabled
            await toolsApi.toggleWatcher(newEnabled)
            setWatcherStatus({ ...watcherStatus, enabled: newEnabled })
            toast.success(newEnabled ? '文件监听器已启动' : '文件监听器已停止')
        } catch (error) {
            toast.error('切换失败')
        } finally {
            setTogglingWatcher(false)
        }
    }

    // 保存事件概率配置
    const saveEventProbability = async () => {
        try {
            await toolsApi.updateEventProbability(eventProbConfig)
            toast.success('事件概率配置已保存')
            setEventProbOpen(false)
        } catch (error) {
            toast.error('保存失败')
        }
    }

    useEffect(() => {
        fetchTools()
        fetchBuiltinConfig()
        fetchJsTools()
        fetchToolStats()
        fetchEventProbability()
        fetchWatcherStatus()
    }, [])

    // 打开 JS 工具编辑弹窗
    const openJsEdit = async (tool?: JsTool) => {
        if (tool) {
            setJsEditMode(true)
            // 使用 filename 获取工具源码（去掉.js后缀）
            const fileKey = tool.filename?.replace(/\.js$/, '') || tool.name
            try {
                const res = (await toolsApi.getJsDetail(fileKey)) as {
                    data?: { description?: string; parameters?: unknown; source?: string; code?: string }
                }
                const data = res?.data || {}
                setJsForm({
                    name: tool.name,
                    filename: tool.filename || `${tool.name}.js`,
                    description: data.description || tool.description || '',
                    parameters: data.parameters
                        ? typeof data.parameters === 'string'
                            ? data.parameters
                            : JSON.stringify(data.parameters, null, 2)
                        : '{}',
                    code: data.source || data.code || ''
                })
            } catch (error) {
                toast.error('获取工具源码失败')
                return
            }
        } else {
            setJsEditMode(false)
            setJsForm({
                name: '',
                filename: '',
                description: '',
                parameters: '{\n  "type": "object",\n  "properties": {},\n  "required": []\n}',
                code: '// 工具代码\nasync function execute(args, context) {\n  // args: 输入参数\n  // context: 上下文信息\n  return { result: "success" }\n}'
            })
        }
        setJsEditOpen(true)
    }

    // 保存 JS 工具
    const saveJsTool = async () => {
        if (!jsForm.name) {
            toast.warning('请输入工具名称')
            return
        }
        setJsSaving(true)
        try {
            let params
            try {
                params = JSON.parse(jsForm.parameters)
            } catch {
                toast.error('参数 JSON 格式错误')
                setJsSaving(false)
                return
            }

            if (jsEditMode) {
                // 更新工具使用 filename（去掉.js后缀）
                const fileKey = jsForm.filename?.replace(/\.js$/, '') || jsForm.name
                await toolsApi.updateJs(fileKey, { source: jsForm.code })
                toast.success('工具已更新')
            } else {
                // 创建工具需要 name 和 source
                await toolsApi.createJs({ name: jsForm.name, source: jsForm.code })
                toast.success('工具已创建')
            }
            setJsEditOpen(false)
            fetchTools()
            fetchJsTools()
        } catch (error) {
            toast.error('保存失败: ' + ((error as Error)?.message || '未知错误'))
        } finally {
            setJsSaving(false)
        }
    }

    // 删除 JS 工具
    const deleteJsTool = async (tool: JsTool) => {
        const fileKey = tool.filename?.replace(/\.js$/, '') || tool.name
        try {
            await toolsApi.deleteJs(fileKey)
            toast.success('工具已删除')
            fetchTools()
            fetchJsTools()
        } catch (error) {
            toast.error('删除失败')
        }
    }

    // 重新加载 JS 工具
    const reloadJsTools = async () => {
        try {
            await toolsApi.reloadJs()
            toast.success('JS 工具已重新加载')
            fetchTools()
            fetchJsTools()
        } catch (error) {
            toast.error('重新加载失败')
        }
    }

    // 计算服务器选项
    const serverOptions = useMemo(() => {
        const servers = new Set<string>()
        tools.forEach(t => servers.add(t.serverName || 'builtin'))
        return Array.from(servers)
    }, [tools])

    // 筛选工具
    const filteredTools = useMemo(() => {
        let result = tools

        if (searchText) {
            const search = searchText.toLowerCase()
            result = result.filter(
                t => t.name.toLowerCase().includes(search) || t.description?.toLowerCase().includes(search)
            )
        }

        if (filterServer && filterServer !== '__all__') {
            result = result.filter(t => (t.serverName || 'builtin') === filterServer)
        }

        if (filterType === 'builtin') {
            result = result.filter(t => t.isBuiltin)
        } else if (filterType === 'mcp') {
            result = result.filter(t => !t.isBuiltin)
        }

        return result
    }, [tools, searchText, filterType, filterServer])

    const builtinToolsCount = useMemo(() => tools.filter(t => t.isBuiltin).length, [tools])
    const mcpToolsCount = useMemo(() => tools.filter(t => !t.isBuiltin).length, [tools])

    // 查看详情
    const viewDetail = (tool: Tool) => {
        setSelectedTool(tool)
        setDetailOpen(true)
    }

    // 打开测试弹窗
    const openTestModal = (tool: Tool) => {
        setSelectedTool(tool)
        setTestArgs(JSON.stringify(getDefaultArgs(tool), null, 2))
        setTestResult('')
        setTestOpen(true)
    }

    // 获取默认参数
    const getDefaultArgs = (tool: Tool) => {
        const params = tool.inputSchema || {}
        const args: Record<string, unknown> = {}

        if (params.properties) {
            Object.keys(params.properties).forEach(key => {
                const prop = params.properties![key]
                if (prop.type === 'string') {
                    args[key] = prop.default || ''
                } else if (prop.type === 'number') {
                    args[key] = prop.default || 0
                } else if (prop.type === 'boolean') {
                    args[key] = prop.default || false
                } else if (prop.type === 'array') {
                    args[key] = prop.default || []
                } else if (prop.type === 'object') {
                    args[key] = prop.default || {}
                }
            })
        }

        return args
    }

    // 测试工具
    const testTool = async () => {
        if (!selectedTool) return

        setTestLoading(true)
        setTestResult('')

        try {
            const args = JSON.parse(testArgs)
            const res = (await toolsApi.test({ toolName: selectedTool.name, arguments: args })) as { data?: unknown }

            if (res?.data !== undefined) {
                setTestResult(JSON.stringify(res.data, null, 2))
                toast.success('工具测试成功')
            } else {
                setTestResult(JSON.stringify(res, null, 2))
            }
        } catch (error) {
            const err = error as { response?: { data?: { message?: string } }; message?: string }
            const msg = err?.response?.data?.message || err?.message || '测试失败'
            setTestResult(`Error: ${msg}`)
            toast.error('工具测试失败: ' + msg)
        } finally {
            setTestLoading(false)
        }
    }

    // 保存内置工具配置
    const saveBuiltinConfig = async () => {
        setConfigSaving(true)
        try {
            await toolsApi.updateBuiltinConfig(builtinConfig)
            toast.success('配置已保存')
            fetchTools()
        } catch (error) {
            toast.error('保存失败: ' + ((error as Error)?.message || '未知错误'))
        } finally {
            setConfigSaving(false)
        }
    }

    // 刷新内置工具
    const refreshBuiltinTools = async () => {
        try {
            const res = (await toolsApi.refreshBuiltin()) as { data?: { count?: number } }
            toast.success(`已刷新 ${res?.data?.count || 0} 个内置工具`)
            fetchTools()
        } catch (error) {
            toast.error('刷新失败')
        }
    }

    // 添加标签
    const addTag = (list: string[], setList: (v: string[]) => void, value: string, clear: () => void) => {
        if (value && !list.includes(value)) {
            setList([...list, value])
            clear()
        }
    }

    // 移除标签
    const removeTag = (list: string[], setList: (v: string[]) => void, value: string) => {
        setList(list.filter(v => v !== value))
    }

    if (loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-96 w-full" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* 内置工具配置 */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Wrench className="h-5 w-5" />
                                工具管理
                            </CardTitle>
                            <CardDescription>配置内置工具、事件处理和热重载</CardDescription>
                        </div>
                        {toolStats && (
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="bg-green-50 text-green-700">
                                    启用: {toolStats.enabled}
                                </Badge>
                                <Badge variant="outline" className="bg-red-50 text-red-700">
                                    禁用: {toolStats.disabled}
                                </Badge>
                                <Badge variant="outline">总计: {toolStats.total}</Badge>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* 开关配置 */}
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-4 sm:gap-6">
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={builtinConfig.enabled}
                                onCheckedChange={checked => {
                                    setBuiltinConfig({ ...builtinConfig, enabled: checked })
                                    setTimeout(saveBuiltinConfig, 100)
                                }}
                            />
                            <Label>启用内置工具</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={builtinConfig.allowDangerous}
                                onCheckedChange={checked => {
                                    setBuiltinConfig({ ...builtinConfig, allowDangerous: checked })
                                    setTimeout(saveBuiltinConfig, 100)
                                }}
                            />
                            <Label>允许危险操作</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={watcherStatus.enabled}
                                onCheckedChange={toggleWatcher}
                                disabled={togglingWatcher}
                            />
                            <Label className="flex items-center gap-1">
                                <FileSearch className="h-4 w-4" />
                                自动监听热重载
                            </Label>
                        </div>
                    </div>

                    {/* 一键操作按钮 */}
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={enableAllTools} disabled={enablingAll}>
                            {enablingAll ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Power className="mr-2 h-4 w-4" />
                            )}
                            一键启用
                        </Button>
                        <Button variant="outline" size="sm" onClick={disableAllTools} disabled={disablingAll}>
                            {disablingAll ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <PowerOff className="mr-2 h-4 w-4" />
                            )}
                            一键禁用
                        </Button>
                        <Button variant="outline" size="sm" onClick={reloadAllTools} disabled={reloadingAll}>
                            {reloadingAll ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RotateCcw className="mr-2 h-4 w-4" />
                            )}
                            热重载全部
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setEventProbOpen(true)}>
                            <Zap className="mr-2 h-4 w-4" />
                            事件概率配置
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
                            <Settings className="mr-2 h-4 w-4" />
                            高级配置
                        </Button>
                    </div>

                    {!builtinConfig.enabled && (
                        <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            <span className="text-sm text-amber-700 dark:text-amber-300">
                                内置工具已禁用，AI将无法使用QQ相关功能
                            </span>
                        </div>
                    )}

                    {watcherStatus.enabled && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-2">
                            <Activity className="h-4 w-4 text-blue-600 animate-pulse" />
                            <span className="text-sm text-blue-700 dark:text-blue-300">
                                文件监听器运行中，JS工具变化将自动重载
                            </span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* JS 自定义工具 */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <FileCode className="h-5 w-5" />
                                自定义 JS 工具
                            </CardTitle>
                            <CardDescription>创建和管理自定义 JavaScript 工具</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline">{jsTools.length} 个工具</Badge>
                            <Button variant="outline" size="sm" onClick={reloadJsTools}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                重载
                            </Button>
                            <Button size="sm" onClick={() => openJsEdit()}>
                                <Plus className="mr-2 h-4 w-4" />
                                新建工具
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {jsTools.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Code className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>暂无自定义工具</p>
                            <Button variant="link" onClick={() => openJsEdit()}>
                                创建第一个工具
                            </Button>
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {jsTools.map(tool => (
                                <div
                                    key={tool.name}
                                    className="p-4 border rounded-lg hover:shadow-sm transition-shadow"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-medium truncate">{tool.name}</h4>
                                            <p className="text-sm text-muted-foreground truncate">
                                                {tool.description || '无描述'}
                                            </p>
                                        </div>
                                        <div className="flex gap-1 ml-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => openJsEdit(tool)}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive"
                                                onClick={() => deleteJsTool(tool)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 工具列表 */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                            <CardTitle>工具管理</CardTitle>
                            <CardDescription>查看和测试所有可用工具</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100">
                                内置: {builtinToolsCount}
                            </Badge>
                            <Badge variant="default" className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                                MCP: {mcpToolsCount}
                            </Badge>
                            <Button onClick={fetchTools} disabled={loading}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                刷新
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {/* 筛选器 - 移动端优化 */}
                    <div className="flex flex-col sm:flex-row gap-3 mb-4">
                        <div className="relative flex-1 min-w-0 sm:min-w-[200px] sm:max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                placeholder="搜索工具..."
                                className="pl-9"
                            />
                        </div>
                        <Select value={filterType} onValueChange={setFilterType}>
                            <SelectTrigger className="w-full sm:w-[130px]">
                                <SelectValue placeholder="类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">全部类型</SelectItem>
                                <SelectItem value="builtin">内置工具</SelectItem>
                                <SelectItem value="mcp">MCP工具</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={filterServer} onValueChange={setFilterServer}>
                            <SelectTrigger className="w-full sm:w-[150px]">
                                <SelectValue placeholder="来源" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">全部来源</SelectItem>
                                {serverOptions.map(server => (
                                    <SelectItem key={server} value={server}>
                                        {server}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 工具表格 - 移动端支持横向滑动 */}
                    <ScrollArea className="h-[400px] sm:h-[500px]">
                        <div className="min-w-[700px]">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[60px]">启用</TableHead>
                                        <TableHead className="w-[180px]">名称</TableHead>
                                        <TableHead>描述</TableHead>
                                        <TableHead className="w-[80px]">类型</TableHead>
                                        <TableHead className="w-[100px]">来源</TableHead>
                                        <TableHead className="w-[100px] text-right">操作</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredTools.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                                                暂无工具
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredTools.map(tool => {
                                            const isDisabled = builtinConfig.disabledTools.includes(tool.name)
                                            return (
                                                <TableRow key={tool.name} className={isDisabled ? 'opacity-50' : ''}>
                                                    <TableCell>
                                                        <Switch
                                                            checked={!isDisabled}
                                                            onCheckedChange={async checked => {
                                                                try {
                                                                    await toolsApi.toggleTool(tool.name, checked)
                                                                    if (checked) {
                                                                        setBuiltinConfig({
                                                                            ...builtinConfig,
                                                                            disabledTools:
                                                                                builtinConfig.disabledTools.filter(
                                                                                    t => t !== tool.name
                                                                                )
                                                                        })
                                                                    } else {
                                                                        setBuiltinConfig({
                                                                            ...builtinConfig,
                                                                            disabledTools: [
                                                                                ...builtinConfig.disabledTools,
                                                                                tool.name
                                                                            ]
                                                                        })
                                                                    }
                                                                    toast.success(
                                                                        checked
                                                                            ? `${tool.name} 已启用`
                                                                            : `${tool.name} 已禁用`
                                                                    )
                                                                } catch (error) {
                                                                    toast.error('切换失败')
                                                                }
                                                            }}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="font-medium whitespace-nowrap">
                                                        <div className="flex items-center gap-2">
                                                            {tool.name}
                                                            {builtinConfig.dangerousTools.includes(tool.name) && (
                                                                <Badge variant="destructive" className="text-xs">
                                                                    危险
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="max-w-[200px] sm:max-w-[300px] truncate text-muted-foreground">
                                                        {tool.description || '-'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge
                                                            variant={tool.isBuiltin ? 'default' : 'secondary'}
                                                            className={
                                                                tool.isBuiltin
                                                                    ? 'bg-green-100 text-green-700 hover:bg-green-100'
                                                                    : 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                                                            }
                                                        >
                                                            {tool.isBuiltin ? '内置' : 'MCP'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground">
                                                        {tool.serverName || 'builtin'}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => viewDetail(tool)}
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => openTestModal(tool)}
                                                            >
                                                                <Play className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* 详情弹窗 */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="w-[95vw] max-w-2xl">
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

            {/* 测试弹窗 */}
            <Dialog open={testOpen} onOpenChange={setTestOpen}>
                <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>测试工具</DialogTitle>
                        <DialogDescription>{selectedTool?.name}</DialogDescription>
                    </DialogHeader>
                    {selectedTool && (
                        <div className="space-y-4">
                            <div>
                                <Label>参数 (JSON)</Label>
                                <Textarea
                                    value={testArgs}
                                    onChange={e => setTestArgs(e.target.value)}
                                    placeholder='{"key": "value"}'
                                    rows={8}
                                    className="font-mono text-sm mt-2 bg-[#1e1e1e] text-[#d4d4d4] border-neutral-700"
                                    style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace" }}
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button onClick={testTool} disabled={testLoading}>
                                    {testLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    执行测试
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setTestArgs(JSON.stringify(getDefaultArgs(selectedTool), null, 2))}
                                >
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

            {/* 高级配置弹窗 */}
            <Dialog open={configOpen} onOpenChange={setConfigOpen}>
                <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>内置工具高级配置</DialogTitle>
                        <DialogDescription>配置工具的访问权限和危险操作</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>启用内置工具</Label>
                                <p className="text-sm text-muted-foreground">是否允许AI使用内置工具</p>
                            </div>
                            <Switch
                                checked={builtinConfig.enabled}
                                onCheckedChange={checked => setBuiltinConfig({ ...builtinConfig, enabled: checked })}
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>允许危险操作</Label>
                                <p className="text-sm text-muted-foreground">危险操作包括踢人、禁言、撤回等</p>
                            </div>
                            <Switch
                                checked={builtinConfig.allowDangerous}
                                onCheckedChange={checked =>
                                    setBuiltinConfig({ ...builtinConfig, allowDangerous: checked })
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>危险工具列表</Label>
                            <div className="flex flex-wrap gap-2">
                                {builtinConfig.dangerousTools.map(tool => (
                                    <Badge key={tool} variant="destructive" className="gap-1 pr-1">
                                        {tool}
                                        <button
                                            type="button"
                                            className="ml-1 rounded-full hover:bg-red-700/50 p-0.5"
                                            onClick={e => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setBuiltinConfig({
                                                    ...builtinConfig,
                                                    dangerousTools: builtinConfig.dangerousTools.filter(t => t !== tool)
                                                })
                                            }}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    value={newDangerousTool}
                                    onChange={e => setNewDangerousTool(e.target.value)}
                                    placeholder="添加危险工具"
                                    className="flex-1"
                                    onKeyDown={e =>
                                        e.key === 'Enter' &&
                                        addTag(
                                            builtinConfig.dangerousTools,
                                            v => setBuiltinConfig({ ...builtinConfig, dangerousTools: v }),
                                            newDangerousTool,
                                            () => setNewDangerousTool('')
                                        )
                                    }
                                />
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() =>
                                        addTag(
                                            builtinConfig.dangerousTools,
                                            v => setBuiltinConfig({ ...builtinConfig, dangerousTools: v }),
                                            newDangerousTool,
                                            () => setNewDangerousTool('')
                                        )
                                    }
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>允许的工具</Label>
                            <p className="text-xs text-muted-foreground">留空表示允许所有工具</p>
                            <div className="flex flex-wrap gap-2">
                                {builtinConfig.allowedTools.map(tool => (
                                    <Badge key={tool} variant="default" className="gap-1 pr-1">
                                        {tool}
                                        <button
                                            type="button"
                                            className="ml-1 rounded-full hover:bg-primary-foreground/20 p-0.5"
                                            onClick={e => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setBuiltinConfig({
                                                    ...builtinConfig,
                                                    allowedTools: builtinConfig.allowedTools.filter(t => t !== tool)
                                                })
                                            }}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    value={newAllowedTool}
                                    onChange={e => setNewAllowedTool(e.target.value)}
                                    placeholder="添加允许的工具"
                                    className="flex-1"
                                    onKeyDown={e =>
                                        e.key === 'Enter' &&
                                        addTag(
                                            builtinConfig.allowedTools,
                                            v => setBuiltinConfig({ ...builtinConfig, allowedTools: v }),
                                            newAllowedTool,
                                            () => setNewAllowedTool('')
                                        )
                                    }
                                />
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() =>
                                        addTag(
                                            builtinConfig.allowedTools,
                                            v => setBuiltinConfig({ ...builtinConfig, allowedTools: v }),
                                            newAllowedTool,
                                            () => setNewAllowedTool('')
                                        )
                                    }
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>禁用的工具</Label>
                            <div className="flex flex-wrap gap-2">
                                {builtinConfig.disabledTools.map(tool => (
                                    <Badge key={tool} variant="secondary" className="gap-1 pr-1">
                                        {tool}
                                        <button
                                            type="button"
                                            className="ml-1 rounded-full hover:bg-muted p-0.5"
                                            onClick={e => {
                                                e.preventDefault()
                                                e.stopPropagation()
                                                setBuiltinConfig({
                                                    ...builtinConfig,
                                                    disabledTools: builtinConfig.disabledTools.filter(t => t !== tool)
                                                })
                                            }}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <Input
                                    value={newDisabledTool}
                                    onChange={e => setNewDisabledTool(e.target.value)}
                                    placeholder="添加禁用的工具"
                                    className="flex-1"
                                    onKeyDown={e =>
                                        e.key === 'Enter' &&
                                        addTag(
                                            builtinConfig.disabledTools,
                                            v => setBuiltinConfig({ ...builtinConfig, disabledTools: v }),
                                            newDisabledTool,
                                            () => setNewDisabledTool('')
                                        )
                                    }
                                />
                                <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() =>
                                        addTag(
                                            builtinConfig.disabledTools,
                                            v => setBuiltinConfig({ ...builtinConfig, disabledTools: v }),
                                            newDisabledTool,
                                            () => setNewDisabledTool('')
                                        )
                                    }
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfigOpen(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={() => {
                                saveBuiltinConfig()
                                setConfigOpen(false)
                            }}
                            disabled={configSaving}
                        >
                            {configSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* JS 工具编辑弹窗 */}
            <Dialog open={jsEditOpen} onOpenChange={setJsEditOpen}>
                <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{jsEditMode ? '编辑 JS 工具' : '新建 JS 工具'}</DialogTitle>
                        <DialogDescription>使用 JavaScript 创建自定义工具</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>工具名称 *</Label>
                                <Input
                                    value={jsForm.name}
                                    onChange={e => setJsForm({ ...jsForm, name: e.target.value })}
                                    placeholder="my_tool"
                                    disabled={jsEditMode}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>描述</Label>
                                <Input
                                    value={jsForm.description}
                                    onChange={e => setJsForm({ ...jsForm, description: e.target.value })}
                                    placeholder="工具功能描述"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>参数定义 (JSON Schema)</Label>
                            <CodeEditor
                                value={jsForm.parameters}
                                onChange={value => setJsForm({ ...jsForm, parameters: value })}
                                language="json"
                                placeholder='{"type": "object", "properties": {}}'
                                minHeight="150px"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>工具代码 (JavaScript)</Label>
                            <CodeEditor
                                value={jsForm.code}
                                onChange={value => setJsForm({ ...jsForm, code: value })}
                                language="javascript"
                                placeholder="async function execute(args, context) { ... }"
                                minHeight="250px"
                            />
                            <p className="text-xs text-muted-foreground">
                                函数参数: args (输入参数), context (上下文信息，包含 e, Bot 等)
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setJsEditOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={saveJsTool} disabled={jsSaving}>
                            {jsSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            保存
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 事件概率配置弹窗 */}
            <Dialog open={eventProbOpen} onOpenChange={setEventProbOpen}>
                <DialogContent className="w-[95vw] max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Zap className="h-5 w-5" />
                            事件处理概率配置
                        </DialogTitle>
                        <DialogDescription>配置事件触发的概率，控制AI响应频率</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>启用事件处理</Label>
                                <p className="text-sm text-muted-foreground">是否处理戳一戳、撤回等事件</p>
                            </div>
                            <Switch
                                checked={eventProbConfig.enabled}
                                onCheckedChange={checked =>
                                    setEventProbConfig({ ...eventProbConfig, enabled: checked })
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>全局触发概率 ({Math.round(eventProbConfig.probability * 100)}%)</Label>
                            <Input
                                type="range"
                                min="0"
                                max="100"
                                value={eventProbConfig.probability * 100}
                                onChange={e =>
                                    setEventProbConfig({
                                        ...eventProbConfig,
                                        probability: Number(e.target.value) / 100
                                    })
                                }
                                className="w-full"
                            />
                            <p className="text-xs text-muted-foreground">
                                设置事件触发的默认概率，100%表示始终触发，0%表示从不触发
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>启用的事件类型</Label>
                            <div className="flex flex-wrap gap-2">
                                {['poke', 'recall', 'welcome', 'goodbye', 'ban', 'essence', 'admin', 'honor'].map(
                                    event => (
                                        <Badge
                                            key={event}
                                            variant={
                                                eventProbConfig.enabledEvents.includes(event) ? 'default' : 'outline'
                                            }
                                            className="cursor-pointer"
                                            onClick={() => {
                                                const enabled = eventProbConfig.enabledEvents.includes(event)
                                                setEventProbConfig({
                                                    ...eventProbConfig,
                                                    enabledEvents: enabled
                                                        ? eventProbConfig.enabledEvents.filter(e => e !== event)
                                                        : [...eventProbConfig.enabledEvents, event]
                                                })
                                            }}
                                        >
                                            {event}
                                        </Badge>
                                    )
                                )}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Label>单独事件概率配置</Label>
                            <p className="text-xs text-muted-foreground">为特定事件设置独立概率（覆盖全局配置）</p>
                            <div className="grid gap-3">
                                {eventProbConfig.enabledEvents.map(event => (
                                    <div key={event} className="flex items-center gap-3">
                                        <span className="w-20 text-sm">{event}</span>
                                        <Input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={
                                                (eventProbConfig.eventProbabilities[event] ??
                                                    eventProbConfig.probability) * 100
                                            }
                                            onChange={e =>
                                                setEventProbConfig({
                                                    ...eventProbConfig,
                                                    eventProbabilities: {
                                                        ...eventProbConfig.eventProbabilities,
                                                        [event]: Number(e.target.value) / 100
                                                    }
                                                })
                                            }
                                            className="flex-1"
                                        />
                                        <span className="w-12 text-sm text-muted-foreground">
                                            {Math.round(
                                                (eventProbConfig.eventProbabilities[event] ??
                                                    eventProbConfig.probability) * 100
                                            )}
                                            %
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEventProbOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={saveEventProbability}>保存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
