'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search, Package, Star, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NpmPackageInfo {
    name: string
    package: string
    description: string
    category: string
    popular?: boolean
    args?: string
    env?: Record<string, string>
}

// 常用 MCP NPM 包列表
export const popularMcpPackages: NpmPackageInfo[] = [
    {
        name: 'Filesystem',
        package: '@modelcontextprotocol/server-filesystem',
        description: '文件系统访问，读写本地文件',
        category: '文件系统',
        popular: true,
        args: '/'
    },
    {
        name: 'Memory',
        package: '@modelcontextprotocol/server-memory',
        description: '持久化记忆存储',
        category: '存储',
        popular: true
    },
    {
        name: 'GitHub',
        package: '@modelcontextprotocol/server-github',
        description: 'GitHub API 集成',
        category: '开发工具',
        popular: true,
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }
    },
    {
        name: 'Brave Search',
        package: '@modelcontextprotocol/server-brave-search',
        description: 'Brave 搜索引擎',
        category: '搜索',
        popular: true,
        env: { BRAVE_API_KEY: '' }
    },
    {
        name: 'Puppeteer',
        package: '@modelcontextprotocol/server-puppeteer',
        description: '浏览器自动化',
        category: '浏览器',
        popular: true
    },
    {
        name: 'SQLite',
        package: '@modelcontextprotocol/server-sqlite',
        description: 'SQLite 数据库访问',
        category: '数据库'
    },
    {
        name: 'PostgreSQL',
        package: '@modelcontextprotocol/server-postgres',
        description: 'PostgreSQL 数据库',
        category: '数据库',
        env: { POSTGRES_CONNECTION_STRING: '' }
    },
    {
        name: 'Fetch',
        package: '@modelcontextprotocol/server-fetch',
        description: 'HTTP 请求工具',
        category: '网络'
    },
    {
        name: 'Slack',
        package: '@modelcontextprotocol/server-slack',
        description: 'Slack 集成',
        category: '通讯',
        env: { SLACK_BOT_TOKEN: '' }
    },
    {
        name: 'Google Maps',
        package: '@modelcontextprotocol/server-google-maps',
        description: 'Google 地图服务',
        category: '地图',
        env: { GOOGLE_MAPS_API_KEY: '' }
    },
    {
        name: 'AWS KB',
        package: '@modelcontextprotocol/server-aws-kb-retrieval',
        description: 'AWS 知识库检索',
        category: '云服务'
    },
    {
        name: 'Sentry',
        package: '@modelcontextprotocol/server-sentry',
        description: 'Sentry 错误监控',
        category: '监控',
        env: { SENTRY_AUTH_TOKEN: '' }
    },
    {
        name: 'GitLab',
        package: '@modelcontextprotocol/server-gitlab',
        description: 'GitLab API 集成',
        category: '开发工具',
        env: { GITLAB_PERSONAL_ACCESS_TOKEN: '' }
    },
    {
        name: 'Git',
        package: '@modelcontextprotocol/server-git',
        description: 'Git 版本控制操作',
        category: '开发工具'
    },
    {
        name: 'Sequential Thinking',
        package: '@modelcontextprotocol/server-sequential-thinking',
        description: '顺序思维推理',
        category: 'AI 增强',
        popular: true
    },
    {
        name: 'Everything',
        package: '@modelcontextprotocol/server-everything',
        description: '测试用全功能服务器',
        category: '测试'
    },
    {
        name: 'Context7',
        package: '@upstash/context7-mcp',
        description: '文档和代码示例检索',
        category: '知识库',
        popular: true
    },
    {
        name: 'Exa Search',
        package: 'exa-mcp-server',
        description: 'Exa AI 搜索引擎',
        category: '搜索',
        env: { EXA_API_KEY: '' }
    },
    {
        name: 'Playwright',
        package: '@anthropic-ai/playwright-mcp',
        description: '浏览器自动化测试',
        category: '浏览器'
    }
]

const categories = [...new Set(popularMcpPackages.map(p => p.category))]

interface NpmPackageSelectorProps {
    onSelect: (pkg: NpmPackageInfo) => void
    selectedPackage?: string
    className?: string
}

export function NpmPackageSelector({ onSelect, selectedPackage, className }: NpmPackageSelectorProps) {
    const [search, setSearch] = useState('')
    const [activeCategory, setActiveCategory] = useState<string | null>(null)

    const filteredPackages = popularMcpPackages.filter(pkg => {
        const matchesSearch =
            !search ||
            pkg.name.toLowerCase().includes(search.toLowerCase()) ||
            pkg.package.toLowerCase().includes(search.toLowerCase()) ||
            pkg.description.toLowerCase().includes(search.toLowerCase())

        const matchesCategory = !activeCategory || pkg.category === activeCategory

        return matchesSearch && matchesCategory
    })

    const popularPackages = filteredPackages.filter(p => p.popular)
    const otherPackages = filteredPackages.filter(p => !p.popular)

    return (
        <div className={cn('space-y-4', className)}>
            {/* 搜索框 */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="搜索 NPM 包..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                />
            </div>

            {/* 分类标签 */}
            <div className="flex flex-wrap gap-1.5">
                <Badge
                    variant={activeCategory === null ? 'default' : 'outline'}
                    className="cursor-pointer transition-colors"
                    onClick={() => setActiveCategory(null)}
                >
                    全部
                </Badge>
                {categories.map(cat => (
                    <Badge
                        key={cat}
                        variant={activeCategory === cat ? 'default' : 'outline'}
                        className="cursor-pointer transition-colors"
                        onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                    >
                        {cat}
                    </Badge>
                ))}
            </div>

            {/* 包列表 */}
            <ScrollArea className="h-[280px] pr-2">
                <div className="space-y-4">
                    {/* 热门包 */}
                    {popularPackages.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <Star className="h-3 w-3" />
                                热门
                            </div>
                            <div className="grid gap-2">
                                {popularPackages.map(pkg => (
                                    <PackageCard
                                        key={pkg.package}
                                        pkg={pkg}
                                        isSelected={selectedPackage === pkg.package}
                                        onSelect={() => onSelect(pkg)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 其他包 */}
                    {otherPackages.length > 0 && (
                        <div className="space-y-2">
                            {popularPackages.length > 0 && (
                                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                    <Package className="h-3 w-3" />
                                    其他
                                </div>
                            )}
                            <div className="grid gap-2">
                                {otherPackages.map(pkg => (
                                    <PackageCard
                                        key={pkg.package}
                                        pkg={pkg}
                                        isSelected={selectedPackage === pkg.package}
                                        onSelect={() => onSelect(pkg)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {filteredPackages.length === 0 && (
                        <div className="text-center py-8 text-muted-foreground text-sm">未找到匹配的包</div>
                    )}
                </div>
            </ScrollArea>

            {/* 自定义包提示 */}
            <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Package className="h-3 w-3" />
                <span>也可以手动输入任意 NPM 包名</span>
                <a
                    href="https://github.com/modelcontextprotocol/servers"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                    查看更多
                    <ExternalLink className="h-3 w-3" />
                </a>
            </div>
        </div>
    )
}

function PackageCard({
    pkg,
    isSelected,
    onSelect
}: {
    pkg: NpmPackageInfo
    isSelected: boolean
    onSelect: () => void
}) {
    return (
        <Button
            variant={isSelected ? 'secondary' : 'outline'}
            className={cn('w-full justify-start h-auto py-2.5 px-3 text-left', isSelected && 'ring-2 ring-primary')}
            onClick={onSelect}
        >
            <div className="flex flex-col gap-0.5 w-full min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{pkg.name}</span>
                    {pkg.popular && <Star className="h-3 w-3 text-yellow-500 shrink-0" />}
                    {pkg.env && Object.keys(pkg.env).length > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                            需配置
                        </Badge>
                    )}
                </div>
                <span className="text-xs text-muted-foreground truncate">{pkg.package}</span>
                <span className="text-xs text-muted-foreground/80 line-clamp-1">{pkg.description}</span>
            </div>
        </Button>
    )
}

export default NpmPackageSelector
