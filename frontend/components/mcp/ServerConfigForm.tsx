'use client'

import React, { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Info, AlertTriangle } from 'lucide-react'
import type { McpTransportType, AddServerFormData } from '@/types/mcp'

interface ServerConfigFormProps {
    /** 初始表单数据 */
    initialData?: Partial<AddServerFormData>
    /** 表单数据变更回调 */
    onChange: (data: AddServerFormData, isValid: boolean) => void
    /** 是否显示名称字段 */
    showName?: boolean
    /** 是否禁用类型选择 */
    disableTypeSelect?: boolean
}

/**
 * 验证服务器配置
 */
function validateConfig(data: AddServerFormData): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!data.name?.trim()) {
        errors.push('服务器名称不能为空')
    } else if (!/^[a-zA-Z0-9_-]+$/.test(data.name)) {
        errors.push('服务器名称只能包含字母、数字、下划线和连字符')
    }

    switch (data.type) {
        case 'stdio':
            if (!data.command?.trim()) {
                errors.push('命令不能为空')
            }
            break
        case 'npm':
        case 'npx':
            if (!data.package?.trim()) {
                errors.push('npm 包名不能为空')
            } else if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(data.package)) {
                errors.push('npm 包名格式无效')
            }
            break
        case 'sse':
        case 'http':
            if (!data.url?.trim()) {
                errors.push('URL 不能为空')
            } else {
                try {
                    new URL(data.url)
                } catch {
                    errors.push('URL 格式无效')
                }
            }
            break
    }

    // 验证 JSON 格式的字段
    if (data.env?.trim()) {
        try {
            JSON.parse(data.env)
        } catch {
            errors.push('环境变量必须是有效的 JSON 格式')
        }
    }

    if (data.headers?.trim()) {
        try {
            JSON.parse(data.headers)
        } catch {
            errors.push('请求头必须是有效的 JSON 格式')
        }
    }

    return { valid: errors.length === 0, errors }
}

/**
 * MCP 服务器配置表单
 */
export function ServerConfigForm({
    initialData,
    onChange,
    showName = true,
    disableTypeSelect = false
}: ServerConfigFormProps) {
    const [formData, setFormData] = useState<AddServerFormData>({
        name: '',
        type: 'npm',
        ...initialData
    })
    const [errors, setErrors] = useState<string[]>([])

    // 处理字段变更
    const handleChange = (field: keyof AddServerFormData, value: string) => {
        const newData = { ...formData, [field]: value }
        setFormData(newData)

        const validation = validateConfig(newData)
        setErrors(validation.errors)
        onChange(newData, validation.valid)
    }

    // 初始验证
    useEffect(() => {
        const validation = validateConfig(formData)
        setErrors(validation.errors)
        onChange(formData, validation.valid)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="space-y-4">
            {/* 服务器名称 */}
            {showName && (
                <div className="space-y-2">
                    <Label htmlFor="name">服务器名称 *</Label>
                    <Input
                        id="name"
                        placeholder="如: filesystem, github"
                        value={formData.name}
                        onChange={e => handleChange('name', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">只能包含字母、数字、下划线和连字符</p>
                </div>
            )}

            {/* 连接类型 */}
            <div className="space-y-2">
                <Label>连接类型 *</Label>
                <Select
                    value={formData.type}
                    onValueChange={(value: McpTransportType) => handleChange('type', value)}
                    disabled={disableTypeSelect}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="npm">
                            <div className="flex items-center gap-2">
                                <span>npm 包</span>
                                <Badge variant="secondary" className="text-xs">
                                    推荐
                                </Badge>
                            </div>
                        </SelectItem>
                        <SelectItem value="stdio">stdio (本地进程)</SelectItem>
                        <SelectItem value="sse">SSE (远程实时)</SelectItem>
                        <SelectItem value="http">HTTP (远程无状态)</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* npm/npx 类型配置 */}
            {(formData.type === 'npm' || formData.type === 'npx') && (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="package">npm 包名 *</Label>
                        <Input
                            id="package"
                            placeholder="如: @anthropic/mcp-server-filesystem"
                            value={formData.package || ''}
                            onChange={e => handleChange('package', e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">完整的 npm 包名，支持 scope 包</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="args">命令参数</Label>
                        <Input
                            id="args"
                            placeholder="如: /home/user/documents (多个参数用空格分隔)"
                            value={formData.args || ''}
                            onChange={e => handleChange('args', e.target.value)}
                        />
                    </div>
                </>
            )}

            {/* stdio 类型配置 */}
            {formData.type === 'stdio' && (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="command">执行命令 *</Label>
                        <Input
                            id="command"
                            placeholder="如: node, python, ./server"
                            value={formData.command || ''}
                            onChange={e => handleChange('command', e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="args">命令参数</Label>
                        <Input
                            id="args"
                            placeholder="如: server.js --port 3000"
                            value={formData.args || ''}
                            onChange={e => handleChange('args', e.target.value)}
                        />
                    </div>
                </>
            )}

            {/* SSE/HTTP 类型配置 */}
            {(formData.type === 'sse' || formData.type === 'http') && (
                <>
                    <div className="space-y-2">
                        <Label htmlFor="url">服务器 URL *</Label>
                        <Input
                            id="url"
                            placeholder={
                                formData.type === 'sse' ? 'https://mcp.example.com/sse' : 'https://api.example.com/mcp'
                            }
                            value={formData.url || ''}
                            onChange={e => handleChange('url', e.target.value)}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="headers">请求头 (JSON)</Label>
                        <Textarea
                            id="headers"
                            placeholder='{"Authorization": "Bearer xxx"}'
                            value={formData.headers || ''}
                            onChange={e => handleChange('headers', e.target.value)}
                            rows={3}
                        />
                    </div>
                </>
            )}

            {/* 环境变量 (所有类型) */}
            {(formData.type === 'npm' || formData.type === 'npx' || formData.type === 'stdio') && (
                <div className="space-y-2">
                    <Label htmlFor="env">环境变量 (JSON)</Label>
                    <Textarea
                        id="env"
                        placeholder='{"API_KEY": "xxx", "DEBUG": "true"}'
                        value={formData.env || ''}
                        onChange={e => handleChange('env', e.target.value)}
                        rows={3}
                    />
                    <p className="text-xs text-muted-foreground">某些 MCP 服务器需要特定的环境变量，如 API 密钥</p>
                </div>
            )}

            {/* 类型说明 */}
            <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                    {formData.type === 'npm' && (
                        <span>
                            <strong>npm 包</strong>：自动通过 npx 安装并运行 MCP 服务器包，如
                            <code className="mx-1 px-1 bg-muted rounded">@anthropic/mcp-server-filesystem</code>
                        </span>
                    )}
                    {formData.type === 'stdio' && (
                        <span>
                            <strong>stdio</strong>：通过标准输入输出与本地进程通信，支持任意语言实现的 MCP 服务器
                        </span>
                    )}
                    {formData.type === 'sse' && (
                        <span>
                            <strong>SSE</strong>：通过 Server-Sent Events 与远程服务建立持久连接，适合需要实时通信的场景
                        </span>
                    )}
                    {formData.type === 'http' && (
                        <span>
                            <strong>HTTP</strong>：通过标准 HTTP 请求与远程服务通信，适合简单的无状态 API
                        </span>
                    )}
                </AlertDescription>
            </Alert>

            {/* 错误提示 */}
            {errors.length > 0 && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                        <ul className="list-disc list-inside">
                            {errors.map((error, index) => (
                                <li key={index}>{error}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}
        </div>
    )
}

/**
 * 将表单数据转换为 MCP 服务器配置
 */
export function formDataToConfig(data: AddServerFormData): Record<string, unknown> {
    const config: Record<string, unknown> = {
        type: data.type
    }

    switch (data.type) {
        case 'npm':
        case 'npx':
            config.package = data.package
            if (data.args?.trim()) {
                config.args = data.args.split(/\s+/).filter(Boolean)
            }
            break
        case 'stdio':
            config.command = data.command
            if (data.args?.trim()) {
                config.args = data.args.split(/\s+/).filter(Boolean)
            }
            break
        case 'sse':
        case 'http':
            config.url = data.url
            if (data.headers?.trim()) {
                try {
                    config.headers = JSON.parse(data.headers)
                } catch {
                    // 忽略解析错误
                }
            }
            break
    }

    // 添加环境变量
    if (data.env?.trim()) {
        try {
            config.env = JSON.parse(data.env)
        } catch {
            // 忽略解析错误
        }
    }

    return config
}

export default ServerConfigForm
