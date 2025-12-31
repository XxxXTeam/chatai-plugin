'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
  Play
} from 'lucide-react'

import { channelsApi } from '@/lib/api'

interface TestResult {
  model: string
  success: boolean
  elapsed: number
  response?: string
  error?: string
}

type TestStatus = '未开始' | '测试中' | '成功' | '失败'

interface BatchTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: string
  channelName: string
  models: string[]
}

export function BatchTestPanel({ 
  open, 
  onOpenChange, 
  channelId, 
  channelName, 
  models 
}: BatchTestPanelProps) {
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [results, setResults] = useState<Map<string, TestResult>>(new Map())
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [endpointType, setEndpointType] = useState('auto')
  const pageSize = 10

  // 初始化选中所有模型
  useEffect(() => {
    if (open && models.length > 0) {
      setSelectedModels([...models])
      setResults(new Map())
      setCurrentPage(1)
    }
  }, [open, models])

  // 过滤模型列表
  const filteredModels = models.filter(m => 
    m.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // 分页
  const totalPages = Math.ceil(filteredModels.length / pageSize)
  const paginatedModels = filteredModels.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  // 切换单个模型选择
  const toggleModel = (model: string) => {
    setSelectedModels(prev => 
      prev.includes(model) 
        ? prev.filter(m => m !== model)
        : [...prev, model]
    )
  }

  // 获取模型状态
  const getModelStatus = (model: string): TestStatus => {
    if (testingModel === model) return '测试中'
    const result = results.get(model)
    if (!result) return '未开始'
    return result.success ? '成功' : '失败'
  }

  // 测试单个模型
  const testSingleModel = async (model: string) => {
    setTestingModel(model)
    try {
      const res = await channelsApi.testModel({ channelId, model }) as { 
        data?: { success?: boolean; elapsed?: number; error?: string } 
      }
      const data = res?.data
      setResults(prev => new Map(prev).set(model, {
        model,
        success: data?.success ?? false,
        elapsed: data?.elapsed ?? 0,
        error: data?.error
      }))
      if (data?.success) {
        toast.success(`${model} 测试成功`)
      } else {
        toast.error(`${model} 测试失败: ${data?.error || '未知错误'}`)
      }
    } catch (error: unknown) {
      const err = error as Error
      setResults(prev => new Map(prev).set(model, {
        model,
        success: false,
        elapsed: 0,
        error: err.message
      }))
      toast.error(`${model} 测试失败: ${err.message}`)
    } finally {
      setTestingModel(null)
    }
  }

  // 批量测试所有选中模型
  const startBatchTest = async () => {
    if (selectedModels.length === 0) {
      toast.error('请选择要测试的模型')
      return
    }

    setTesting(true)
    setResults(new Map())

    try {
      const res = await channelsApi.batchTest({
        channelId,
        models: selectedModels,
        concurrency: 3,
      }) as { data?: { results?: TestResult[], success?: number, failed?: number } }
      
      const data = res?.data
      if (data?.results) {
        const newResults = new Map<string, TestResult>()
        data.results.forEach(r => newResults.set(r.model, r))
        setResults(newResults)
        toast.success(`批量测试完成: ${data.success || 0}/${selectedModels.length} 成功`)
      }
    } catch (error: unknown) {
      const err = error as Error
      toast.error(`批量测试失败: ${err.message}`)
    } finally {
      setTesting(false)
    }
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
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        {/* 标题栏 */}
        <DialogHeader className="px-6 py-4 border-b bg-muted/30">
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            <span>{channelName} 渠道的模型测试</span>
            <Badge variant="secondary" className="ml-2 font-normal">
              {models.length} 个模型
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* 搜索和操作栏 */}
        <div className="px-6 py-3 border-b bg-background flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索模型..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              className="h-9 pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={copySelected} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            复制已选
          </Button>
          <Button variant="outline" size="sm" onClick={selectSuccessModels} className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            选择成功
          </Button>
        </div>

        {/* 模型列表 */}
        <div className="flex-1 overflow-hidden">
          {/* 表头 */}
          <div className="flex items-center px-6 py-2.5 border-b bg-muted/20 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <div className="w-10">
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
            <div className="flex-1">模型名称</div>
            <div className="w-24 text-center">状态</div>
            <div className="w-20 text-center">操作</div>
          </div>

          {/* 列表 */}
          <ScrollArea className="h-[320px]">
            {paginatedModels.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                暂无模型
              </div>
            ) : (
              paginatedModels.map((model) => {
                const status = getModelStatus(model)
                const isSelected = selectedModels.includes(model)
                const result = results.get(model)
                return (
                  <div 
                    key={model} 
                    className={`flex items-center px-6 py-3 border-b transition-colors hover:bg-muted/40 ${
                      isSelected ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="w-10">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleModel(model)}
                        disabled={testing}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm truncate block">{model}</span>
                      {result && result.elapsed > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {result.elapsed}ms
                        </span>
                      )}
                    </div>
                    <div className="w-24 text-center">
                      {status === '成功' && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          成功
                        </Badge>
                      )}
                      {status === '失败' && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 gap-1">
                          <XCircle className="h-3 w-3" />
                          失败
                        </Badge>
                      )}
                      {status === '测试中' && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800 gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          测试中
                        </Badge>
                      )}
                      {status === '未开始' && (
                        <span className="text-xs text-muted-foreground">未开始</span>
                      )}
                    </div>
                    <div className="w-20 text-center">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 px-2 text-primary hover:text-primary"
                        onClick={() => testSingleModel(model)}
                        disabled={testing || testingModel === model}
                      >
                        {testingModel === model ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <span className="flex items-center gap-1">
                            <Play className="h-3.5 w-3.5" />
                            测试
                          </span>
                        )}
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </ScrollArea>
        </div>

        {/* 分页 */}
        <div className="px-6 py-3 border-t bg-muted/20 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            显示第 {(currentPage - 1) * pageSize + 1} 条-第 {Math.min(currentPage * pageSize, filteredModels.length)} 条, 共 {filteredModels.length} 条
          </span>
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
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
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
                  className="h-8 w-8 p-0"
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
        <DialogFooter className="px-6 py-4 border-t bg-background gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button 
            onClick={startBatchTest} 
            disabled={testing || selectedModels.length === 0}
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                测试中...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                批量测试{selectedModels.length}个模型
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default BatchTestPanel
