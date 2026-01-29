'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { 
    Users, 
    Shield, 
    Settings, 
    Key, 
    Info,
    Lock,
    Unlock,
    Cog,
    MessageSquare
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface GroupAccessGuideProps {
    className?: string
    variant?: 'full' | 'compact'
}

export function GroupAccessGuide({ className, variant = 'full' }: GroupAccessGuideProps) {
    if (variant === 'compact') {
        return (
            <Alert className={cn('border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20', className)}>
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertTitle className="text-blue-800 dark:text-blue-300">群组管理说明</AlertTitle>
                <AlertDescription className="text-blue-700 dark:text-blue-400 text-sm">
                    <p className="mb-2">本页面为 <strong>Bot管理员</strong> 专用，可管理所有群组配置。</p>
                    <p>群管理员请使用群内命令 <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">#群管理面板</code> 获取独立管理链接。</p>
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <div className={cn('space-y-4', className)}>
            <div className="grid gap-4 md:grid-cols-2">
                {/* Bot 管理员面板 */}
                <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-primary/10">
                                <Shield className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    Bot 管理面板
                                    <Badge variant="default" className="text-[10px]">当前页面</Badge>
                                </CardTitle>
                                <CardDescription>面向 Bot 管理员</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-2 text-sm">
                            <div className="flex items-start gap-2">
                                <Unlock className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                                <span>管理所有群组的配置</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <Cog className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                <span>设置全局默认配置、渠道、模型等</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <Key className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                                <span>需要 Bot 管理员密码登录</span>
                            </div>
                        </div>
                        <div className="pt-2 border-t">
                            <p className="text-xs text-muted-foreground">
                                适用场景：Bot 部署者、维护者使用
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* 群管理员面板 */}
                <Card className="border-orange-200 dark:border-orange-900/50 bg-gradient-to-br from-orange-50/50 dark:from-orange-950/20 to-transparent">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-orange-100 dark:bg-orange-900/30">
                                <Users className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                            </div>
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    群管理面板
                                    <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600">独立入口</Badge>
                                </CardTitle>
                                <CardDescription>面向群管理员</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-2 text-sm">
                            <div className="flex items-start gap-2">
                                <Lock className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
                                <span>仅能管理自己的群组配置</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <Settings className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
                                <span>设置群专属人设、功能开关等</span>
                            </div>
                            <div className="flex items-start gap-2">
                                <MessageSquare className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
                                <span>通过群内命令获取登录码</span>
                            </div>
                        </div>
                        <div className="pt-2 border-t">
                            <p className="text-xs text-muted-foreground">
                                获取方式：在群内发送 <code className="bg-orange-100 dark:bg-orange-900/50 px-1 rounded">#群管理面板</code>
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* 功能对比表 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">功能权限对比</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 pr-4 font-medium">功能</th>
                                    <th className="text-center py-2 px-4 font-medium">
                                        <div className="flex items-center justify-center gap-1">
                                            <Shield className="h-3.5 w-3.5" />
                                            Bot管理
                                        </div>
                                    </th>
                                    <th className="text-center py-2 pl-4 font-medium">
                                        <div className="flex items-center justify-center gap-1">
                                            <Users className="h-3.5 w-3.5" />
                                            群管理
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                <tr>
                                    <td className="py-2 pr-4">查看/管理所有群组</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-muted-foreground">✗</td>
                                </tr>
                                <tr>
                                    <td className="py-2 pr-4">管理自己的群配置</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-green-600">✓</td>
                                </tr>
                                <tr>
                                    <td className="py-2 pr-4">设置群专属人设</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-green-600">✓</td>
                                </tr>
                                <tr>
                                    <td className="py-2 pr-4">配置独立渠道</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-green-600">✓</td>
                                </tr>
                                <tr>
                                    <td className="py-2 pr-4">管理全局渠道/模型</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-muted-foreground">✗</td>
                                </tr>
                                <tr>
                                    <td className="py-2 pr-4">管理预设库</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-muted-foreground">✗</td>
                                </tr>
                                <tr>
                                    <td className="py-2 pr-4">禁止群使用全局模型</td>
                                    <td className="text-center py-2 px-4 text-green-600">✓</td>
                                    <td className="text-center py-2 pl-4 text-muted-foreground">✗</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

export default GroupAccessGuide
