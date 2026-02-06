/**
 * Shared navigation configuration
 * Used by Sidebar, PageTabs, and route-title mapping
 */

export interface NavItemConfig {
    href: string
    label: string
    icon: string // lucide icon name
    tourId?: string
}

export interface NavGroupConfig {
    id: string
    label: string
    icon: string
    items: NavItemConfig[]
    tourId?: string
}

export const navGroups: NavGroupConfig[] = [
    {
        id: 'overview',
        label: '仪表盘',
        icon: 'LayoutDashboard',
        items: [{ href: '/', label: '仪表盘', icon: 'LayoutDashboard' }]
    },
    {
        id: 'config',
        label: '配置中心',
        icon: 'Settings',
        tourId: 'config',
        items: [
            { href: '/settings', label: '基础设置', icon: 'Settings', tourId: 'settings' },
            { href: '/settings/system', label: '系统配置', icon: 'Server' },
            { href: '/settings/context', label: '上下文配置', icon: 'FileText' },
            { href: '/channels', label: '渠道管理', icon: 'Plug', tourId: 'channels' },
            { href: '/presets', label: '预设管理', icon: 'Palette', tourId: 'presets' },
            { href: '/scope', label: '人设管理', icon: 'UserCog' },
            { href: '/settings/proxy', label: '代理设置', icon: 'Globe' },
            { href: '/settings/links', label: '登录链接', icon: 'Link' }
        ]
    },
    {
        id: 'ai',
        label: 'AI扩展',
        icon: 'Cpu',
        tourId: 'ai',
        items: [
            { href: '/tools', label: '工具配置', icon: 'Wrench' },
            { href: '/mcp', label: 'MCP服务', icon: 'Bot' },
            { href: '/imagegen', label: '绘图预设', icon: 'Wand2' },
            { href: '/knowledge', label: '知识库', icon: 'BookOpen' },
            { href: '/memory', label: '记忆管理', icon: 'Brain' },
            { href: '/game', label: 'Galgame', icon: 'Gamepad2' }
        ]
    },
    {
        id: 'data',
        label: '数据记录',
        icon: 'Database',
        tourId: 'data',
        items: [
            { href: '/stats', label: '使用统计', icon: 'BarChart3' },
            { href: '/history/usage', label: '调用统计', icon: 'Activity' },
            { href: '/conversations', label: '对话历史', icon: 'MessageSquare' },
            { href: '/history', label: '工具调用', icon: 'History' }
        ]
    },
    {
        id: 'users',
        label: '用户管理',
        icon: 'Users',
        tourId: 'users',
        items: [
            { href: '/users', label: '用户管理', icon: 'Users' },
            { href: '/groups', label: '群组管理', icon: 'UsersRound', tourId: 'groups' }
        ]
    }
]

// Flat path -> NavItemConfig mapping for quick lookup
const _navMap = new Map<string, NavItemConfig>()
for (const group of navGroups) {
    for (const item of group.items) {
        _navMap.set(item.href, item)
    }
}

/**
 * Get nav item config by path. Supports exact match and prefix match.
 */
export function getNavItemByPath(path: string): NavItemConfig | undefined {
    // Exact match first
    if (_navMap.has(path)) return _navMap.get(path)
    // Prefix match (e.g. /groups/123 -> /groups)
    for (const [href, item] of _navMap) {
        if (href !== '/' && path.startsWith(href + '/')) {
            return item
        }
    }
    return undefined
}

// Sub-route suffix map for better tab labels
const subRouteSuffixes: Record<string, string> = {
    'edit': '编辑',
    'new': '新建',
    'detail': '详情',
    'test': '测试',
    'usage': '统计',
}

/**
 * Get label for a path. Sub-routes get a contextual suffix.
 * e.g. /groups -> "群组管理", /groups/edit -> "编辑群组", /groups/123 -> "群组详情"
 */
export function getPathLabel(path: string): string {
    const item = getNavItemByPath(path)
    if (!item) return path

    // Exact match - return as-is
    if (item.href === path) return item.label

    // Sub-route - generate contextual label
    const subPath = path.slice(item.href.length + 1) // e.g. "edit", "123", "edit?id=xxx"
    const subSegment = subPath.split('/')[0].split('?')[0] // first segment, strip query

    // Check known suffixes
    const suffix = subRouteSuffixes[subSegment]
    if (suffix) return `${suffix}${item.label.replace('管理', '')}`

    // Numeric ID -> "详情"
    if (/^\d+$/.test(subSegment)) return `${item.label}详情`

    return item.label
}

/**
 * Get icon name for a path
 */
export function getPathIcon(path: string): string {
    const item = getNavItemByPath(path)
    return item?.icon || 'FileText'
}
