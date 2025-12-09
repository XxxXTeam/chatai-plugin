'use client'

import { useEffect, useState } from 'react'
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
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { mcpApi, toolsApi } from '@/lib/api'
import { toast } from 'sonner'
import { RefreshCw, Server, Wrench, CheckCircle, XCircle, Loader2, Plus, Trash2, RotateCcw, FileJson, Pencil, Code, Eye, Play, Copy } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { CodeBlock } from '@/components/ui/code-block' 

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
    env: '',
    headers: '',
  })
  
  // 工具详情弹窗
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null)

  // 工具测试弹窗
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testArgs, setTestArgs] = useState('{}')
  const [testResult, setTestResult] = useState('')
  const [testLoading, setTestLoading] = useState(false)

  const fetchData = async () => {
    try {
      const [serversRes, toolsRes] = await Promise.all([
        mcpApi.listServers(),
        toolsApi.list()
      ])
      const serversData = (serversRes as any)?.data || serversRes || []
      const toolsData = (toolsRes as any)?.data || toolsRes || []
      setServers(Array.isArray(serversData) ? serversData : [])
      setTools(Array.isArray(toolsData) ? toolsData : [])
    } catch (error) {
      toast.error('加载MCP数据失败')
      console.error(error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

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
      env: '',
      headers: '',
    })
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
        if (serverForm.headers) {
          try {
            config.headers = JSON.parse(serverForm.headers)
          } catch {
            toast.error('Headers 格式错误 (JSON)')
            setSaving(false)
            return
          }
        }
      }

      if (serverForm.env) {
        try {
          config.env = JSON.parse(serverForm.env)
        } catch {
          toast.error('环境变量格式错误 (JSON)')
          setSaving(false)
          return
        }
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
      const res = await mcpApi.importConfig(config) as any
      const result = res?.data || res || {}
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
    const defaultArgs: Record<string, unknown> = {}
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        if (prop.type === 'string') defaultArgs[key] = ''
        else if (prop.type === 'number') defaultArgs[key] = 0
        else if (prop.type === 'boolean') defaultArgs[key] = false
        else if (prop.type === 'array') defaultArgs[key] = []
        else if (prop.type === 'object') defaultArgs[key] = {}
      })
    }
    setTestArgs(JSON.stringify(defaultArgs, null, 2))
    setTestResult('')
    setTestDialogOpen(true)
  }

  // 执行工具测试
  const handleTestTool = async () => {
    if (!selectedTool) return
    setTestLoading(true)
    setTestResult('')
    try {
      const args = JSON.parse(testArgs)
      const res = await toolsApi.test({ toolName: selectedTool.name, arguments: args }) as any
      if (res?.data !== undefined) {
        setTestResult(JSON.stringify(res.data, null, 2))
        toast.success('测试成功')
      } else {
        setTestResult(JSON.stringify(res, null, 2))
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || '测试失败'
      setTestResult(`Error: ${msg}`)
      toast.error('测试失败: ' + msg)
    } finally {
      setTestLoading(false)
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
    parameters: ${JSON.stringify(tool.inputSchema || { type: 'object', properties: {} }, null, 4).split('\n').join('\n    ')}
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
    } catch (error: any) {
      toast.error('复制失败: ' + (error?.response?.data?.message || error?.message || '未知错误'))
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">MCP 工具管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            刷新
          </Button>
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <FileJson className="mr-2 h-4 w-4" />
            导入配置
          </Button>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            添加服务器
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">服务器数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{servers.length}</div>
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
              {servers.map((server) => (
                <Card key={server.name}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{server.name}</CardTitle>
                      <Badge variant={server.status === 'connected' ? 'default' : 'secondary'}>
                        {server.status === 'connected' ? (
                          <><CheckCircle className="h-3 w-3 mr-1" /> 已连接</>
                        ) : (
                          <><XCircle className="h-3 w-3 mr-1" /> 离线</>
                        )}
                      </Badge>
                    </div>
                    <CardDescription>{server.config?.type || server.type || '未知类型'}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">工具数</span>
                        <span className="font-medium">{server.toolsCount || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">资源数</span>
                        <span className="font-medium">{server.resourcesCount || 0}</span>
                      </div>
                      {server.config?.command && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">命令</span>
                          <span className="truncate max-w-[200px] font-mono text-xs">{server.config.command}</span>
                        </div>
                      )}
                      {server.config?.url && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">URL</span>
                          <span className="truncate max-w-[200px] font-mono text-xs">{server.config.url}</span>
                        </div>
                      )}
                      {server.connectedAt && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">连接时间</span>
                          <span>{new Date(server.connectedAt).toLocaleString('zh-CN')}</span>
                        </div>
                      )}
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

            {/* 内置工具 */}
            <TabsContent value="builtin">
              {builtinTools.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">暂无内置工具</p>
                  </CardContent>
                </Card>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                    {builtinTools.map((tool) => (
                      <Card key={tool.name} className="hover:shadow-md transition-shadow group">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <Code className="h-4 w-4 text-primary" />
                                <span className="font-medium truncate">{tool.name}</span>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {tool.description || '无描述'}
                              </p>
                              {tool.inputSchema?.properties && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {Object.keys(tool.inputSchema.properties).slice(0, 3).map((param) => (
                                    <Badge key={param} variant="secondary" className="text-xs">
                                      {param}
                                    </Badge>
                                  ))}
                                  {Object.keys(tool.inputSchema.properties).length > 3 && (
                                    <Badge variant="secondary" className="text-xs">
                                      +{Object.keys(tool.inputSchema.properties).length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewDetail(tool)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenTest(tool)}>
                                <Play className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopyToJsTool(tool)} title="复制为 JS 工具">
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

            {/* 外部工具 */}
            <TabsContent value="external">
              {externalTools.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Server className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">暂无外部 MCP 工具</p>
                    <p className="text-xs text-muted-foreground mt-1">添加 MCP 服务器后，其工具将显示在这里</p>
                  </CardContent>
                </Card>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                    {externalTools.map((tool) => (
                      <Card key={tool.name} className="hover:shadow-md transition-shadow group">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <Server className="h-4 w-4 text-blue-500" />
                                <span className="font-medium truncate">{tool.name}</span>
                                <Badge variant="outline" className="text-xs shrink-0">
                                  {tool.serverName}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {tool.description || '无描述'}
                              </p>
                              {tool.inputSchema?.properties && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {Object.keys(tool.inputSchema.properties).slice(0, 3).map((param) => (
                                    <Badge key={param} variant="secondary" className="text-xs">
                                      {param}
                                    </Badge>
                                  ))}
                                  {Object.keys(tool.inputSchema.properties).length > 3 && (
                                    <Badge variant="secondary" className="text-xs">
                                      +{Object.keys(tool.inputSchema.properties).length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewDetail(tool)}>
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenTest(tool)}>
                                <Play className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopyToJsTool(tool)} title="复制为 JS 工具">
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加 MCP 服务器</DialogTitle>
            <DialogDescription>
              配置新的 MCP 服务器连接
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={serverForm.name}
                onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
                placeholder="服务器名称"
              />
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select
                value={serverForm.type}
                onValueChange={(v) => setServerForm({ ...serverForm, type: v })}
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

            {serverForm.type === 'stdio' && (
              <>
                <div className="space-y-2">
                  <Label>命令</Label>
                  <Input
                    value={serverForm.command}
                    onChange={(e) => setServerForm({ ...serverForm, command: e.target.value })}
                    placeholder="例如: node, npx, python"
                  />
                </div>
                <div className="space-y-2">
                  <Label>参数 (空格分隔)</Label>
                  <Input
                    value={serverForm.args}
                    onChange={(e) => setServerForm({ ...serverForm, args: e.target.value })}
                    placeholder="-y @modelcontextprotocol/server-filesystem /"
                  />
                </div>
              </>
            )}

            {serverForm.type === 'npm' && (
              <>
                <div className="space-y-2">
                  <Label>NPM 包名</Label>
                  <Input
                    value={serverForm.package}
                    onChange={(e) => setServerForm({ ...serverForm, package: e.target.value })}
                    placeholder="@modelcontextprotocol/server-filesystem"
                  />
                </div>
                <div className="space-y-2">
                  <Label>参数 (空格分隔)</Label>
                  <Input
                    value={serverForm.args}
                    onChange={(e) => setServerForm({ ...serverForm, args: e.target.value })}
                    placeholder="/"
                  />
                </div>
              </>
            )}

            {(serverForm.type === 'sse' || serverForm.type === 'http') && (
              <>
                <div className="space-y-2">
                  <Label>URL</Label>
                  <Input
                    value={serverForm.url}
                    onChange={(e) => setServerForm({ ...serverForm, url: e.target.value })}
                    placeholder="http://localhost:8080/mcp"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Headers (JSON 格式)</Label>
                  <Textarea
                    value={serverForm.headers}
                    onChange={(e) => setServerForm({ ...serverForm, headers: e.target.value })}
                    placeholder='{"Authorization": "Bearer xxx"}'
                    rows={3}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>环境变量 (JSON 格式，可选)</Label>
              <Textarea
                value={serverForm.env}
                onChange={(e) => setServerForm({ ...serverForm, env: e.target.value })}
                placeholder='{"API_KEY": "xxx"}'
                rows={2}
              />
            </div>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>导入 MCP 配置</DialogTitle>
            <DialogDescription>
              粘贴 Claude Desktop 或其他 MCP 客户端的配置 JSON
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={'{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-xxx"]\n    }\n  }\n}'}
              rows={12}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleImport}>
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 工具详情弹窗 */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                  onChange={(e) => setTestArgs(e.target.value)}
                  placeholder='{"key": "value"}'
                  rows={8}
                  className="font-mono text-sm mt-2 bg-[#1e1e1e] text-[#d4d4d4] border-neutral-700"
                  style={{ fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace" }}
                />
              </div>
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
    </div>
  )
}
