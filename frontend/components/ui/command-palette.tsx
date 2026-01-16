'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Search,
    LayoutDashboard,
    Settings,
    Plug,
    Palette,
    UserCog,
    Wrench,
    Bot,
    Wand2,
    BookOpen,
    Brain,
    BarChart3,
    Activity,
    MessageSquare,
    History,
    Users,
    UsersRound,
    Server,
    FileText,
    Globe,
    Link as LinkIcon,
    ArrowRight,
    Command,
    Plus,
    Zap,
    Image,
    PartyPopper,
    Sparkles,
    Hand,
    Clock,
    UserPlus,
    Heart,
    Shield,
    Key,
    type LucideIcon
} from 'lucide-react'

interface CommandItem {
    id: string
    label: string
    description?: string
    icon: LucideIcon
    href: string
    keywords?: string[]
    group: string
    action?: string // 特殊操作标识
}

const commandItems: CommandItem[] = [
    // 仪表盘
    {
        id: 'dashboard',
        label: '仪表盘',
        description: '查看系统概览和统计数据',
        icon: LayoutDashboard,
        href: '/',
        keywords: ['首页', 'home', 'overview'],
        group: '仪表盘'
    },

    // 配置中心 - 基础设置
    {
        id: 'settings',
        label: '基础设置',
        description: '配置基本系统参数',
        icon: Settings,
        href: '/settings',
        keywords: ['配置', 'config', 'setting'],
        group: '配置中心'
    },
    {
        id: 'settings-trigger',
        label: '触发配置',
        description: '配置AI触发方式和前缀',
        icon: Zap,
        href: '/settings?tab=trigger',
        keywords: ['触发', 'trigger', '前缀', 'prefix', '@'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-basic',
        label: '基础功能',
        description: '命令前缀、调试模式等',
        icon: Settings,
        href: '/settings?tab=basic',
        keywords: ['命令', 'debug', '调试'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-llm',
        label: '模型配置',
        description: '配置默认模型和备选模型',
        icon: Bot,
        href: '/settings?tab=llm',
        keywords: ['模型', 'model', 'llm', 'ai'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-bym',
        label: '伪人配置',
        description: '配置伪人模式参数',
        icon: Sparkles,
        href: '/settings?tab=bym',
        keywords: ['伪人', 'bym', '模拟', '随机回复'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-proactive',
        label: '主动消息',
        description: '配置主动消息/推送频率与内容',
        icon: Sparkles,
        href: '/settings?tab=proactive',
        keywords: ['主动', '推送', '主动消息', 'proactive'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-tools',
        label: '工具调用配置',
        description: '工具执行和显示设置',
        icon: Wrench,
        href: '/settings?tab=tools',
        keywords: ['工具', 'tool', 'function'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-thinking',
        label: '思考链配置',
        description: '思考过程显示设置',
        icon: Brain,
        href: '/settings?tab=thinking',
        keywords: ['思考', 'thinking', 'chain'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-features',
        label: '高级功能',
        description: '群聊总结、用户画像等',
        icon: Sparkles,
        href: '/settings?tab=features',
        keywords: ['高级', '功能', 'feature', '总结', '画像'],
        group: '配置中心 / 基础设置'
    },
    {
        id: 'settings-admin',
        label: '管理与安全',
        description: '敏感操作、登录提醒等管理配置',
        icon: Shield,
        href: '/settings?tab=admin',
        keywords: ['管理', '安全', '敏感', 'login', 'admin'],
        group: '配置中心 / 基础设置'
    },

    // 配置中心 - 其他
    {
        id: 'system',
        label: '系统配置',
        description: '高级系统配置选项',
        icon: Server,
        href: '/settings/system',
        keywords: ['系统', 'system'],
        group: '配置中心'
    },
    {
        id: 'context',
        label: '上下文配置',
        description: '对话上下文相关设置',
        icon: FileText,
        href: '/settings/context',
        keywords: ['上下文', 'context'],
        group: '配置中心'
    },
    {
        id: 'channels',
        label: '渠道管理',
        description: '管理AI服务渠道',
        icon: Plug,
        href: '/channels',
        keywords: ['渠道', 'channel', 'api'],
        group: '配置中心'
    },
    {
        id: 'channels-add',
        label: '添加渠道',
        description: '添加新的AI服务渠道',
        icon: Plus,
        href: '/channels?action=add',
        keywords: ['添加', '新建', 'add', 'channel'],
        group: '配置中心 / 渠道管理',
        action: 'add'
    },
    {
        id: 'presets',
        label: '预设管理',
        description: '管理AI预设配置',
        icon: Palette,
        href: '/presets',
        keywords: ['预设', 'preset', '模板'],
        group: '配置中心'
    },
    {
        id: 'presets-add',
        label: '添加预设',
        description: '创建新的AI预设',
        icon: Plus,
        href: '/presets?action=add',
        keywords: ['添加', '新建', 'add', 'preset'],
        group: '配置中心 / 预设管理',
        action: 'add'
    },
    {
        id: 'scope',
        label: '人设管理',
        description: '管理AI角色人设',
        icon: UserCog,
        href: '/scope',
        keywords: ['人设', 'scope', '角色', 'persona'],
        group: '配置中心'
    },
    {
        id: 'proxy',
        label: '代理设置',
        description: '配置网络代理',
        icon: Globe,
        href: '/settings/proxy',
        keywords: ['代理', 'proxy', '网络'],
        group: '配置中心'
    },
    {
        id: 'links',
        label: '登录链接',
        description: '管理登录链接',
        icon: LinkIcon,
        href: '/settings/links',
        keywords: ['链接', 'link', '登录'],
        group: '配置中心'
    },

    // AI扩展
    {
        id: 'tools',
        label: '工具配置',
        description: '配置AI可用工具',
        icon: Wrench,
        href: '/tools',
        keywords: ['工具', 'tool', 'function'],
        group: 'AI扩展'
    },
    {
        id: 'mcp',
        label: 'MCP服务',
        description: '管理MCP服务配置',
        icon: Bot,
        href: '/mcp',
        keywords: ['mcp', '服务', 'service'],
        group: 'AI扩展'
    },
    {
        id: 'imagegen',
        label: '绘图预设',
        description: '配置图像生成参数',
        icon: Wand2,
        href: '/imagegen',
        keywords: ['绘图', '图像', 'image', 'draw'],
        group: 'AI扩展'
    },
    {
        id: 'knowledge',
        label: '知识库',
        description: '管理知识库内容',
        icon: BookOpen,
        href: '/knowledge',
        keywords: ['知识', 'knowledge', 'rag'],
        group: 'AI扩展'
    },
    {
        id: 'knowledge-add',
        label: '添加知识库',
        description: '创建新的知识库',
        icon: Plus,
        href: '/knowledge?action=add',
        keywords: ['添加', '新建', 'add', 'knowledge'],
        group: 'AI扩展 / 知识库',
        action: 'add'
    },
    {
        id: 'knowledge-detail',
        label: '知识库详情',
        description: '查看或编辑知识库文档',
        icon: BookOpen,
        href: '/knowledge/[id]',
        keywords: ['知识库', '详情', '编辑', 'knowledge', 'doc'],
        group: 'AI扩展 / 知识库'
    },
    {
        id: 'memory',
        label: '记忆管理',
        description: '管理AI长期记忆',
        icon: Brain,
        href: '/memory',
        keywords: ['记忆', 'memory', '存储'],
        group: 'AI扩展'
    },

    // 数据记录
    {
        id: 'stats',
        label: '使用统计',
        description: '查看使用统计数据',
        icon: BarChart3,
        href: '/stats',
        keywords: ['统计', 'stats', '数据'],
        group: '数据记录'
    },
    {
        id: 'usage',
        label: '调用统计',
        description: '查看API调用统计',
        icon: Activity,
        href: '/history/usage',
        keywords: ['调用', 'usage', 'api'],
        group: '数据记录'
    },
    {
        id: 'conversations',
        label: '对话历史',
        description: '查看对话记录',
        icon: MessageSquare,
        href: '/conversations',
        keywords: ['对话', 'chat', '历史', 'conversation'],
        group: '数据记录'
    },
    {
        id: 'conversations-detail',
        label: '对话详情',
        description: '查看单个对话的消息记录',
        icon: MessageSquare,
        href: '/conversations/detail',
        keywords: ['对话', '详情', 'conversation', 'detail'],
        group: '数据记录'
    },
    {
        id: 'history',
        label: '工具调用',
        description: '查看工具调用记录',
        icon: History,
        href: '/history',
        keywords: ['工具', '调用', 'history'],
        group: '数据记录'
    },

    // 用户管理
    {
        id: 'users',
        label: '用户管理',
        description: '管理系统用户',
        icon: Users,
        href: '/users',
        keywords: ['用户', 'user', '管理'],
        group: '用户管理'
    },
    {
        id: 'users-add',
        label: '添加用户',
        description: '添加新用户配置',
        icon: UserPlus,
        href: '/users?action=add',
        keywords: ['添加', '新建', 'add', 'user'],
        group: '用户管理',
        action: 'add'
    },
    {
        id: 'groups',
        label: '群组管理',
        description: '管理群组配置',
        icon: UsersRound,
        href: '/groups',
        keywords: ['群组', 'group', '群'],
        group: '用户管理'
    },
    {
        id: 'groups-add',
        label: '添加群组',
        description: '添加新群组配置',
        icon: Plus,
        href: '/groups?action=add',
        keywords: ['添加', '新建', 'add', 'group', '群'],
        group: '用户管理',
        action: 'add'
    },

    // 群组管理子功能
    {
        id: 'groups-basic',
        label: '群组基础设置',
        description: '群号、预设、触发模式',
        icon: Settings,
        href: '/groups?tab=basic',
        keywords: ['群组', '基础', '预设', '触发'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-features',
        label: '群组功能开关',
        description: '工具调用、绘图、总结',
        icon: Zap,
        href: '/groups?tab=features',
        keywords: ['功能', '工具', '绘图', '总结'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-bym',
        label: '群组伪人设置',
        description: '群组伪人模式配置',
        icon: Sparkles,
        href: '/groups?tab=bym',
        keywords: ['伪人', 'bym', '模拟'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-events',
        label: '群组事件处理',
        description: '入群欢迎、退群提醒等',
        icon: PartyPopper,
        href: '/groups?tab=events',
        keywords: ['事件', '欢迎', '入群', '退群'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-welcome',
        label: '入群欢迎配置',
        description: '配置新成员入群欢迎',
        icon: UserPlus,
        href: '/groups?feature=welcome',
        keywords: ['欢迎', '入群', 'welcome'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-poke',
        label: '戳一戳配置',
        description: '配置戳一戳回复',
        icon: Hand,
        href: '/groups?feature=poke',
        keywords: ['戳', 'poke', '互动'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-summary',
        label: '定时总结配置',
        description: '配置群聊定时总结',
        icon: Clock,
        href: '/groups?feature=summary',
        keywords: ['总结', '定时', 'summary'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-imagegen',
        label: '群组绘图设置',
        description: '配置群组绘图功能',
        icon: Image,
        href: '/groups?feature=imagegen',
        keywords: ['绘图', '图片', 'image'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-emoji',
        label: '表情包小偷',
        description: '配置表情包收集功能',
        icon: Sparkles,
        href: '/groups?feature=emoji',
        keywords: ['表情', 'emoji', '小偷'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-models',
        label: '群组模型配置',
        description: '配置群组专用模型',
        icon: Bot,
        href: '/groups?tab=advanced',
        keywords: ['模型', 'model', '群组'],
        group: '用户管理 / 群组管理'
    },
    {
        id: 'groups-knowledge',
        label: '群组知识库',
        description: '配置群组关联知识库',
        icon: BookOpen,
        href: '/groups?tab=advanced',
        keywords: ['知识库', 'knowledge', '群组'],
        group: '用户管理 / 群组管理'
    }
]

function fuzzyMatch(text: string, query: string): boolean {
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()

    // 直接包含
    if (lowerText.includes(lowerQuery)) return true

    // 拼音首字母匹配（简化版）
    let queryIndex = 0
    for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
        if (lowerText[i] === lowerQuery[queryIndex]) {
            queryIndex++
        }
    }
    return queryIndex === lowerQuery.length
}

function searchItems(query: string): CommandItem[] {
    if (!query.trim()) return commandItems

    return commandItems.filter(item => {
        const searchTexts = [item.label, item.description || '', ...(item.keywords || []), item.group]
        return searchTexts.some(text => fuzzyMatch(text, query))
    })
}

function groupItems(items: CommandItem[]): Record<string, CommandItem[]> {
    return items.reduce(
        (acc, item) => {
            if (!acc[item.group]) {
                acc[item.group] = []
            }
            acc[item.group].push(item)
            return acc
        },
        {} as Record<string, CommandItem[]>
    )
}

interface CommandPaletteProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
    const router = useRouter()
    const [query, setQuery] = React.useState('')
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const inputRef = React.useRef<HTMLInputElement>(null)

    const filteredItems = React.useMemo(() => searchItems(query), [query])
    const groupedItems = React.useMemo(() => groupItems(filteredItems), [filteredItems])
    const flatItems = React.useMemo(() => filteredItems, [filteredItems])

    // 重置选中状态
    React.useEffect(() => {
        setSelectedIndex(0)
    }, [query])

    // 聚焦输入框
    React.useEffect(() => {
        if (open) {
            setQuery('')
            setSelectedIndex(0)
            setTimeout(() => inputRef.current?.focus(), 0)
        }
    }, [open])

    const handleSelect = React.useCallback(
        (item: CommandItem) => {
            onOpenChange(false)
            router.push(item.href)
        },
        [router, onOpenChange]
    )

    const handleKeyDown = React.useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    setSelectedIndex(i => (i + 1) % flatItems.length)
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    setSelectedIndex(i => (i - 1 + flatItems.length) % flatItems.length)
                    break
                case 'Enter':
                    e.preventDefault()
                    if (flatItems[selectedIndex]) {
                        handleSelect(flatItems[selectedIndex])
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    onOpenChange(false)
                    break
            }
        },
        [flatItems, selectedIndex, handleSelect, onOpenChange]
    )

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="p-0 gap-0 max-w-2xl overflow-hidden bg-background/95 backdrop-blur-xl border-border/50 shadow-2xl"
                showCloseButton={false}
            >
                <DialogTitle className="sr-only">全局搜索</DialogTitle>

                {/* 搜索输入框 */}
                <div className="flex items-center gap-3 px-4 border-b border-border/50">
                    <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="搜索功能或页面..."
                        className="flex-1 h-14 bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
                    />
                    <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-2 text-xs text-muted-foreground">
                        <span className="text-[10px]">ESC</span>
                    </kbd>
                </div>

                {/* 搜索结果 */}
                <ScrollArea className="max-h-[60vh]">
                    <div className="p-2">
                        {filteredItems.length === 0 ? (
                            <div className="py-12 text-center">
                                <div className="mx-auto w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                                    <Search className="h-6 w-6 text-muted-foreground/50" />
                                </div>
                                <p className="text-sm text-muted-foreground">未找到匹配的功能</p>
                                <p className="text-xs text-muted-foreground/60 mt-1">尝试其他关键词</p>
                            </div>
                        ) : (
                            Object.entries(groupedItems).map(([group, items]) => (
                                <div key={group} className="mb-2">
                                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
                                        {group}
                                    </div>
                                    {items.map(item => {
                                        const globalIndex = flatItems.indexOf(item)
                                        const isSelected = globalIndex === selectedIndex
                                        const Icon = item.icon

                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => handleSelect(item)}
                                                onMouseEnter={() => setSelectedIndex(globalIndex)}
                                                className={cn(
                                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 group',
                                                    isSelected
                                                        ? 'bg-primary text-primary-foreground shadow-md'
                                                        : 'hover:bg-accent/50'
                                                )}
                                            >
                                                <div
                                                    className={cn(
                                                        'flex h-9 w-9 items-center justify-center rounded-lg transition-all',
                                                        isSelected
                                                            ? 'bg-white/20'
                                                            : 'bg-muted/50 group-hover:bg-background'
                                                    )}
                                                >
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div
                                                        className={cn(
                                                            'font-medium text-sm',
                                                            isSelected ? 'text-primary-foreground' : 'text-foreground'
                                                        )}
                                                    >
                                                        {item.label}
                                                    </div>
                                                    {item.description && (
                                                        <div
                                                            className={cn(
                                                                'text-xs truncate',
                                                                isSelected
                                                                    ? 'text-primary-foreground/70'
                                                                    : 'text-muted-foreground'
                                                            )}
                                                        >
                                                            {item.description}
                                                        </div>
                                                    )}
                                                </div>
                                                <ArrowRight
                                                    className={cn(
                                                        'h-4 w-4 shrink-0 transition-all',
                                                        isSelected
                                                            ? 'opacity-100 translate-x-0'
                                                            : 'opacity-0 -translate-x-2 group-hover:opacity-50 group-hover:translate-x-0'
                                                    )}
                                                />
                                            </button>
                                        )
                                    })}
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>

                {/* 底部提示 */}
                <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-muted/30">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 text-[10px]">
                                ↑
                            </kbd>
                            <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 text-[10px]">
                                ↓
                            </kbd>
                            <span className="ml-1">导航</span>
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="inline-flex h-5 items-center rounded border border-border/50 bg-background px-1.5 text-[10px]">
                                ↵
                            </kbd>
                            <span className="ml-1">确认</span>
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Command className="h-3 w-3" />
                        <span>+</span>
                        <span>K</span>
                        <span className="ml-1">打开</span>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// 全局快捷键Hook
export function useCommandPalette() {
    const [open, setOpen] = React.useState(false)

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl/Cmd + K
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault()
                setOpen(prev => !prev)
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    return { open, setOpen }
}
