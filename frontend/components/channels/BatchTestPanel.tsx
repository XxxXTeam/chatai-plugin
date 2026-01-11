'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import {
    Loader2,
    ChevronLeft,
    ChevronRight,
    Search,
    Copy,
    CheckCircle2,
    XCircle,
    Clock,
    Play,
    Zap,
    RotateCcw,
    Filter,
    X as XIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'

import { channelsApi } from '@/lib/api'

interface TestResult {
    model: string
    success: boolean
    elapsed: number
    response?: string
    error?: string
}

type TestStatus = '未开始' | '测试中' | '成功' | '失败'
type FilterType = 'all' | 'success' | 'failed' | 'pending'

interface BatchTestPanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    channelId: string
    channelName: string
    models: string[]
}

export function BatchTestPanel({ open, onOpenChange, channelId, channelName, models }: BatchTestPanelProps) {
    const [selectedModels, setSelectedModels] = useState<string[]>([])
    const [testing, setTesting] = useState(false)
    const [testingModel, setTestingModel] = useState<string | null>(null)
    const [testingModels, setTestingModels] = useState<Set<string>>(new Set())
    const [results, setResults] = useState<Map<string, TestResult>>(new Map())
    const [searchTerm, setSearchTerm] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const [filterType, setFilterType] = useState<FilterType>('all')
    const [concurrency, setConcurrency] = useState(5)
    const [testedCount, setTestedCount] = useState(0)
    const pageSize = 10

    // 初始化选中所有模型
    useEffect(() => {
        if (open && models.length > 0) {
            setSelectedModels([...models])
            setResults(new Map())
            setCurrentPage(1)
            setFilterType('all')
            setTestedCount(0)
        }
    }, [open, models])

    // 统计数据
    const stats = useMemo(() => {
        const successCount = Array.from(results.values()).filter(r => r.success).length
        const failedCount = Array.from(results.values()).filter(r => !r.success).length
        const pendingCount = models.length - results.size
        const avgTime =
            results.size > 0
                ? Math.round(Array.from(results.values()).reduce((acc, r) => acc + r.elapsed, 0) / results.size)
                : 0
        return { successCount, failedCount, pendingCount, avgTime }
    }, [results, models.length])

    // 过滤模型列表
    const filteredModels = useMemo(() => {
        let filtered = models.filter(m => m.toLowerCase().includes(searchTerm.toLowerCase()))

        if (filterType === 'success') {
            filtered = filtered.filter(m => results.get(m)?.success === true)
        } else if (filterType === 'failed') {
            filtered = filtered.filter(m => results.get(m)?.success === false)
        } else if (filterType === 'pending') {
            filtered = filtered.filter(m => !results.has(m))
        }

        return filtered
    }, [models, searchTerm, filterType, results])

    // 分页
    const totalPages = Math.ceil(filteredModels.length / pageSize)
    const paginatedModels = filteredModels.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    // 测试进度
    const progress = testing ? Math.round((testedCount / selectedModels.length) * 100) : 0

    // 切换单个模型选择
    const toggleModel = (model: string) => {
        setSelectedModels(prev => (prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]))
    }

    // 获取模型状态
    const getModelStatus = (model: string): TestStatus => {
        if (testingModels.has(model) || testingModel === model) return '测试中'
        const result = results.get(model)
        if (!result) return '未开始'
        return result.success ? '成功' : '失败'
    }

    // 测试单个模型
    const testSingleModel = async (model: string) => {
        // 使用 Set 支持多个模型同时测试
        setTestingModels(prev => new Set(prev).add(model))
        try {
            const res = await channelsApi.testModel({ channelId, model })
            // 解析响应 - 兼容多种响应格式
            const rawData = res?.data as Record<string, unknown> | undefined

            let success = false
            let elapsed = 0
            let error: string | undefined

            if (rawData) {
                if (typeof rawData.data === 'object' && rawData.data !== null) {
                    const inner = rawData.data as Record<string, unknown>
                    success = inner.success === true
                    elapsed = typeof inner.elapsed === 'number' ? inner.elapsed : 0
                    error = typeof inner.error === 'string' ? inner.error : undefined
                } else if ('success' in rawData) {
                    success = rawData.success === true
                    elapsed = typeof rawData.elapsed === 'number' ? rawData.elapsed : 0
                    error = typeof rawData.error === 'string' ? rawData.error : undefined
                } else if (rawData.code === 0) {
                    success = true
                }
                if (!success && !error && typeof rawData.message === 'string') {
                    error = rawData.message
                }
            }

            setResults(prev => new Map(prev).set(model, { model, success, elapsed, error }))
            if (success) {
                toast.success(`${model} 测试成功`, { description: `耗时 ${elapsed}ms` })
            } else {
                toast.error(`${model} 测试失败: ${error || '未知错误'}`)
            }
        } catch (error: unknown) {
            const err = error as Error
            setResults(prev =>
                new Map(prev).set(model, {
                    model,
                    success: false,
                    elapsed: 0,
                    error: err.message
                })
            )
            toast.error(`${model} 测试失败: ${err.message}`)
        } finally {
            // 从测试中集合移除
            setTestingModels(prev => {
                const next = new Set(prev)
                next.delete(model)
                return next
            })
        }
    }

    // 批量测试所有选中模型（逐个测试，实时更新状态）
    const startBatchTest = async () => {
        if (selectedModels.length === 0) {
            toast.error('请选择要测试的模型')
            return
        }

        setTesting(true)
        setResults(new Map())
        setTestedCount(0)

        const modelsToTest = [...selectedModels]
        let successCount = 0
        let failedCount = 0

        // 分批并发测试
        const testModelAsync = async (model: string) => {
            // 添加到正在测试的模型集合
            setTestingModels(prev => new Set(prev).add(model))

            try {
                const res = await channelsApi.testModel({ channelId, model })
                // 解析响应 - 兼容多种响应格式
                const rawData = res?.data as Record<string, unknown> | undefined

                // 尝试从 data.data 或直接从 data 获取结果
                let success = false
                let elapsed = 0
                let error: string | undefined

                if (rawData) {
                    // 格式1: { code: 0, data: { success, elapsed, error } }
                    if (typeof rawData.data === 'object' && rawData.data !== null) {
                        const inner = rawData.data as Record<string, unknown>
                        success = inner.success === true
                        elapsed = typeof inner.elapsed === 'number' ? inner.elapsed : 0
                        error = typeof inner.error === 'string' ? inner.error : undefined
                    }
                    // 格式2: { success, elapsed, error } 直接在顶层
                    else if ('success' in rawData) {
                        success = rawData.success === true
                        elapsed = typeof rawData.elapsed === 'number' ? rawData.elapsed : 0
                        error = typeof rawData.error === 'string' ? rawData.error : undefined
                    }
                    // 格式3: 只有 code，code=0 表示成功
                    else if (rawData.code === 0) {
                        success = true
                    }

                    // 如果有错误消息
                    if (!success && !error && typeof rawData.message === 'string') {
                        error = rawData.message
                    }
                }

                const result: TestResult = { model, success, elapsed, error }

                // 从正在测试的集合中移除
                setTestingModels(prev => {
                    const next = new Set(prev)
                    next.delete(model)
                    return next
                })

                setResults(prev => new Map(prev).set(model, result))
                setTestedCount(prev => prev + 1)

                if (result.success) {
                    successCount++
                    toast.success(`✓ ${model}`, {
                        description: `耗时 ${result.elapsed}ms`,
                        duration: 2000
                    })
                } else {
                    failedCount++
                    toast.error(`✗ ${model}`, {
                        description: result.error || '测试失败',
                        duration: 3000
                    })
                }

                return result
            } catch (error: unknown) {
                const err = error as Error
                const result: TestResult = {
                    model,
                    success: false,
                    elapsed: 0,
                    error: err.message
                }

                // 从正在测试的集合中移除
                setTestingModels(prev => {
                    const next = new Set(prev)
                    next.delete(model)
                    return next
                })

                setResults(prev => new Map(prev).set(model, result))
                setTestedCount(prev => prev + 1)
                failedCount++

                toast.error(`✗ ${model}`, {
                    description: err.message,
                    duration: 3000
                })

                return result
            }
        }

        // 使用并发池控制并发数
        const runWithConcurrency = async (tasks: string[], limit: number) => {
            const executing: Promise<TestResult>[] = []

            for (const model of tasks) {
                const promise = testModelAsync(model).then(result => {
                    executing.splice(executing.indexOf(promise), 1)
                    return result
                })
                executing.push(promise)

                if (executing.length >= limit) {
                    await Promise.race(executing)
                }
            }

            await Promise.all(executing)
        }

        try {
            await runWithConcurrency(modelsToTest, concurrency)

            // 最终汇总提示
            if (failedCount === 0) {
                toast.success(`🎉 全部测试通过! ${successCount} 个模型`, { duration: 4000 })
            } else if (successCount === 0) {
                toast.error(`全部测试失败! ${failedCount} 个模型`, { duration: 4000 })
            } else {
                toast.info(`测试完成: ${successCount} 成功, ${failedCount} 失败`, { duration: 4000 })
            }
        } catch (error: unknown) {
            const err = error as Error
            toast.error(`批量测试出错: ${err.message}`)
        } finally {
            setTesting(false)
            setTestingModel(null)
            setTestingModels(new Set())
        }
    }

    // 重置测试结果
    const resetResults = () => {
        setResults(new Map())
        setTestedCount(0)
        toast.success('已重置测试结果')
    }

    // 复制已选模型
    const copySelected = () => {
        if (selectedModels.length === 0) {
            toast.error('没有选中的模型')
            return
        }
        navigator.clipboard.writeText(selectedModels.join(', '))
        toast.success(`已复制 ${selectedModels.length} 个模型`)
    }

    // 选择成功的模型
    const selectSuccessModels = () => {
        const successModels = Array.from(results.entries())
            .filter(([, r]) => r.success)
            .map(([model]) => model)
        if (successModels.length === 0) {
            toast.error('没有成功的模型')
            return
        }
        setSelectedModels(successModels)
        toast.success(`已选择 ${successModels.length} 个成功模型`)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
                {/* 标题栏 */}
                <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
                    <DialogTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10">
                                <Zap className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <span className="text-lg font-semibold">{channelName}</span>
                                <span className="text-muted-foreground ml-2">渠道模型测试</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono">
                                {models.length} 模型
                            </Badge>
                        </div>
                    </DialogTitle>
                </DialogHeader>

                {/* 测试进度条 */}
                {testing && (
                    <div className="px-6 py-3 border-b bg-blue-50/50 dark:bg-blue-950/20">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-blue-700 dark:text-blue-400 flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                正在测试 {selectedModels.length} 个模型...
                            </span>
                            <span className="text-sm text-blue-600 dark:text-blue-400">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                    </div>
                )}

                {/* 统计卡片 */}
                {results.size > 0 && !testing && (
                    <div className="px-6 py-3 border-b bg-muted/20">
                        <div className="grid grid-cols-4 gap-3">
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                <div>
                                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                                        {stats.successCount}
                                    </div>
                                    <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70">成功</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                                <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                <div>
                                    <div className="text-lg font-bold text-rose-700 dark:text-rose-400">
                                        {stats.failedCount}
                                    </div>
                                    <div className="text-xs text-rose-600/70 dark:text-rose-400/70">失败</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950/30 border border-slate-200 dark:border-slate-800">
                                <Clock className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                                <div>
                                    <div className="text-lg font-bold text-slate-700 dark:text-slate-400">
                                        {stats.pendingCount}
                                    </div>
                                    <div className="text-xs text-slate-600/70 dark:text-slate-400/70">待测试</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
                                <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                <div>
                                    <div className="text-lg font-bold text-violet-700 dark:text-violet-400">
                                        {stats.avgTime}
                                        <span className="text-xs font-normal">ms</span>
                                    </div>
                                    <div className="text-xs text-violet-600/70 dark:text-violet-400/70">平均耗时</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 搜索和操作栏 */}
                <div className="px-6 py-3 border-b bg-background flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="搜索模型..."
                            value={searchTerm}
                            onChange={e => {
                                setSearchTerm(e.target.value)
                                setCurrentPage(1)
                            }}
                            className="h-9 pl-9 pr-8"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <XIcon className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    <Select
                        value={filterType}
                        onValueChange={v => {
                            setFilterType(v as FilterType)
                            setCurrentPage(1)
                        }}
                    >
                        <SelectTrigger className="w-[120px] h-9">
                            <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部</SelectItem>
                            <SelectItem value="success">成功</SelectItem>
                            <SelectItem value="failed">失败</SelectItem>
                            <SelectItem value="pending">待测试</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="flex items-center gap-1">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-9 w-9" onClick={copySelected}>
                                    <Copy className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>复制已选模型</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="outline" size="icon" className="h-9 w-9" onClick={selectSuccessModels}>
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>仅选择成功模型</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={resetResults}
                                    disabled={results.size === 0}
                                >
                                    <RotateCcw className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>重置测试结果</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {/* 模型列表 */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* 表头 */}
                    <div className="flex items-center px-6 py-2.5 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
                        <div className="w-10 flex-shrink-0">
                            <Checkbox
                                checked={selectedModels.length === filteredModels.length && filteredModels.length > 0}
                                onCheckedChange={() => {
                                    if (selectedModels.length === filteredModels.length) {
                                        setSelectedModels([])
                                    } else {
                                        setSelectedModels([...filteredModels])
                                    }
                                }}
                            />
                        </div>
                        <div className="flex-1 min-w-0">模型名称</div>
                        <div className="w-28 text-center flex-shrink-0">状态</div>
                        <div className="w-24 text-center flex-shrink-0">操作</div>
                    </div>

                    {/* 列表 */}
                    <ScrollArea className="flex-1 min-h-0" style={{ height: '340px' }}>
                        {paginatedModels.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                                <Search className="h-10 w-10 mb-2 opacity-20" />
                                <span>暂无匹配的模型</span>
                            </div>
                        ) : (
                            <div className="divide-y">
                                {paginatedModels.map((model, index) => {
                                    const status = getModelStatus(model)
                                    const isSelected = selectedModels.includes(model)
                                    const result = results.get(model)

                                    return (
                                        <div
                                            key={model}
                                            className={cn(
                                                'flex items-center px-6 py-3 transition-all duration-200 group',
                                                'hover:bg-muted/50',
                                                isSelected && 'bg-primary/5',
                                                status === '成功' && 'bg-emerald-50/30 dark:bg-emerald-950/10',
                                                status === '失败' && 'bg-rose-50/30 dark:bg-rose-950/10',
                                                status === '测试中' && 'bg-blue-50/30 dark:bg-blue-950/10'
                                            )}
                                            style={{ animationDelay: `${index * 30}ms` }}
                                        >
                                            <div className="w-10 flex-shrink-0">
                                                <Checkbox
                                                    checked={isSelected}
                                                    onCheckedChange={() => toggleModel(model)}
                                                    disabled={testing}
                                                    className="transition-transform hover:scale-110"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0 pr-4">
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={cn(
                                                            'font-mono text-sm truncate',
                                                            status === '成功' &&
                                                                'text-emerald-700 dark:text-emerald-400',
                                                            status === '失败' && 'text-rose-700 dark:text-rose-400'
                                                        )}
                                                    >
                                                        {model}
                                                    </span>
                                                </div>
                                                {result && (
                                                    <div className="flex items-center gap-3 mt-1">
                                                        {result.elapsed > 0 && (
                                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                                <Clock className="h-3 w-3" />
                                                                {result.elapsed < 1000
                                                                    ? `${result.elapsed}ms`
                                                                    : `${(result.elapsed / 1000).toFixed(2)}s`}
                                                            </span>
                                                        )}
                                                        {result.error && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <span className="text-xs text-rose-600 dark:text-rose-400 truncate max-w-[200px] cursor-help">
                                                                        {result.error}
                                                                    </span>
                                                                </TooltipTrigger>
                                                                <TooltipContent side="bottom" className="max-w-[300px]">
                                                                    <p className="text-xs">{result.error}</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="w-28 text-center flex-shrink-0">
                                                {status === '成功' && (
                                                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-700 gap-1 font-medium shadow-sm">
                                                        <CheckCircle2 className="h-3 w-3" />
                                                        成功
                                                    </Badge>
                                                )}
                                                {status === '失败' && (
                                                    <Badge className="bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-700 gap-1 font-medium shadow-sm">
                                                        <XCircle className="h-3 w-3" />
                                                        失败
                                                    </Badge>
                                                )}
                                                {status === '测试中' && (
                                                    <Badge className="bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-700 gap-1 font-medium animate-pulse shadow-sm">
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                        测试中
                                                    </Badge>
                                                )}
                                                {status === '未开始' && (
                                                    <span className="text-xs text-muted-foreground/60 px-2 py-1 rounded bg-muted/50">
                                                        待测试
                                                    </span>
                                                )}
                                            </div>
                                            <div className="w-24 text-center flex-shrink-0">
                                                <Button
                                                    variant={status === '未开始' ? 'default' : 'outline'}
                                                    size="sm"
                                                    className={cn(
                                                        'h-8 px-3 gap-1.5 transition-all',
                                                        status === '未开始' && 'bg-primary hover:bg-primary/90',
                                                        status === '成功' &&
                                                            'text-emerald-600 border-emerald-300 hover:bg-emerald-50',
                                                        status === '失败' &&
                                                            'text-rose-600 border-rose-300 hover:bg-rose-50'
                                                    )}
                                                    onClick={() => testSingleModel(model)}
                                                    disabled={testing || testingModel === model}
                                                >
                                                    {testingModel === model ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <>
                                                            <Play className="h-3.5 w-3.5" />
                                                            {status === '未开始' ? '测试' : '重测'}
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                {/* 分页 */}
                <div className="px-6 py-3 border-t bg-muted/20 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">
                            {filteredModels.length > 0 ? (
                                <>
                                    第{' '}
                                    <span className="font-medium text-foreground">
                                        {(currentPage - 1) * pageSize + 1}
                                    </span>
                                    -
                                    <span className="font-medium text-foreground">
                                        {Math.min(currentPage * pageSize, filteredModels.length)}
                                    </span>{' '}
                                    条, 共 <span className="font-medium text-foreground">{filteredModels.length}</span>{' '}
                                    条
                                </>
                            ) : (
                                '无数据'
                            )}
                        </span>
                        {selectedModels.length > 0 && (
                            <Badge variant="secondary" className="font-normal">
                                已选 {selectedModels.length} 项
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        {totalPages > 0 &&
                            Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let page: number
                                if (totalPages <= 5) {
                                    page = i + 1
                                } else if (currentPage <= 3) {
                                    page = i + 1
                                } else if (currentPage >= totalPages - 2) {
                                    page = totalPages - 4 + i
                                } else {
                                    page = currentPage - 2 + i
                                }
                                return (
                                    <Button
                                        key={page}
                                        variant={currentPage === page ? 'default' : 'outline'}
                                        size="sm"
                                        className={cn(
                                            'h-8 w-8 p-0 transition-all',
                                            currentPage === page && 'shadow-sm'
                                        )}
                                        onClick={() => setCurrentPage(page)}
                                    >
                                        {page}
                                    </Button>
                                )
                            })}
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages || totalPages === 0}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* 底部按钮 */}
                <DialogFooter className="px-6 py-4 border-t bg-gradient-to-r from-muted/30 to-transparent flex-row justify-between sm:justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">并发数:</span>
                        <Select value={String(concurrency)} onValueChange={v => setConcurrency(Number(v))}>
                            <SelectTrigger className="w-[70px] h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">1</SelectItem>
                                <SelectItem value="3">3</SelectItem>
                                <SelectItem value="5">5</SelectItem>
                                <SelectItem value="10">10</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            关闭
                        </Button>
                        <Button
                            onClick={startBatchTest}
                            disabled={testing || selectedModels.length === 0}
                            className="min-w-[140px] gap-2"
                        >
                            {testing ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    测试中...
                                </>
                            ) : (
                                <>
                                    <Zap className="h-4 w-4" />
                                    批量测试 ({selectedModels.length})
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default BatchTestPanel
