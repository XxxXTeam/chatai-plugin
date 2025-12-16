'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Settings,
  MessageSquare,
  Users,
  Plug,
  Bot,
  Wrench,
  History,
  Palette,
  Menu,
  UsersRound,
  ChevronDown,
  UserCog,
  Brain,
  BookOpen,
  Cpu,
  Database,
  BarChart3,
  Wand2,
  Globe,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/lib/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface NavItem {
  href: string
  label: string
  icon?: LucideIcon
}

interface NavGroup {
  id: string
  label: string
  icon: LucideIcon
  items: NavItem[]
}

// 合并后的分组导航结构
const navGroups: NavGroup[] = [
  {
    id: 'overview',
    label: '仪表盘',
    icon: LayoutDashboard,
    items: [
      { href: '/', label: '仪表盘', icon: LayoutDashboard },
    ],
  },
  {
    id: 'config',
    label: '配置中心',
    icon: Settings,
    items: [
      { href: '/settings', label: '系统设置', icon: Settings },
      { href: '/channels', label: '渠道管理', icon: Plug },
      { href: '/presets', label: '预设管理', icon: Palette },
      { href: '/scope', label: '人设管理', icon: UserCog },
      { href: '/settings/proxy', label: '代理设置', icon: Globe },
    ],
  },
  {
    id: 'ai',
    label: 'AI扩展',
    icon: Cpu,
    items: [
      { href: '/tools', label: '工具配置', icon: Wrench },
      { href: '/mcp', label: 'MCP服务', icon: Bot },
      { href: '/imagegen', label: '绘图预设', icon: Wand2 },
      { href: '/knowledge', label: '知识库', icon: BookOpen },
      { href: '/memory', label: '记忆管理', icon: Brain },
    ],
  },
  {
    id: 'data',
    label: '数据记录',
    icon: Database,
    items: [
      { href: '/stats', label: '使用统计', icon: BarChart3 },
      { href: '/conversations', label: '对话历史', icon: MessageSquare },
      { href: '/history', label: '调用记录', icon: History },
    ],
  },
  {
    id: 'users',
    label: '用户管理',
    icon: Users,
    items: [
      { href: '/users', label: '用户管理', icon: Users },
      { href: '/groups', label: '群组管理', icon: UsersRound },
    ],
  },
]

// 判断分组是否有激活项
function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some(item => pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/')))
}

// 导航分组组件
function NavGroupItem({ 
  group, 
  pathname, 
  onNavClick,
  isOpen,
  onToggle
}: { 
  group: NavGroup
  pathname: string
  onNavClick?: () => void
  isOpen: boolean
  onToggle: () => void
}) {
  const hasActiveItem = isGroupActive(group, pathname)
  const Icon = group.icon
  
  // 单项分组直接渲染链接
  if (group.items.length === 1) {
    const item = group.items[0]
    const isActive = pathname === item.href
    const ItemIcon = item.icon || Icon
    
    return (
      <Link
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-primary text-primary-foreground shadow-md'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
        onClick={onNavClick}
      >
        <div className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
          isActive ? 'bg-primary-foreground/20' : 'bg-muted'
        )}>
          <ItemIcon className="h-4 w-4" />
        </div>
        <span>{item.label}</span>
      </Link>
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger className="w-full group">
        <div className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 w-full',
          hasActiveItem ? 'text-foreground bg-accent/50' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}>
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
            hasActiveItem ? 'bg-primary/10 text-primary' : 'bg-muted group-hover:bg-muted-foreground/10'
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="flex-1 text-left">{group.label}</span>
          <ChevronDown className={cn(
            'h-4 w-4 transition-transform duration-200 text-muted-foreground',
            isOpen && 'rotate-180'
          )} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-6 pl-3 border-l-2 border-border/40 space-y-0.5">
        {group.items.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))
          const ItemIcon = item.icon
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150',
                isActive
                  ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
              onClick={onNavClick}
            >
              {ItemIcon && <ItemIcon className="h-4 w-4" />}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

// 导航内容
function NavContent({ pathname, onNavClick }: { pathname: string, onNavClick?: () => void }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    navGroups.forEach(group => {
      if (isGroupActive(group, pathname)) {
        initial.add(group.id)
      }
    })
    return initial
  })

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <nav className="p-4 space-y-2">
      {navGroups.map((group) => (
        <NavGroupItem
          key={group.id}
          group={group}
          pathname={pathname}
          onNavClick={onNavClick}
          isOpen={openGroups.has(group.id)}
          onToggle={() => toggleGroup(group.id)}
        />
      ))}
    </nav>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useUiStore()

  return (
    <TooltipProvider>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 bg-gradient-to-b from-card to-card/95 border-r border-border/50 h-screen sticky top-0">
        <div className="flex h-16 items-center px-5 border-b border-border/50">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md group-hover:shadow-lg group-hover:scale-105 transition-all duration-300">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg leading-tight">Chaite</span>
              <span className="text-[10px] text-muted-foreground leading-tight">AI Assistant</span>
            </div>
          </Link>
        </div>
        <ScrollArea className="h-[calc(100vh-4rem)]">
          <NavContent pathname={pathname} />
        </ScrollArea>
      </aside>

      {/* Mobile Sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0 bg-gradient-to-b from-card to-card/95">
          <SheetHeader className="h-16 flex flex-row items-center px-5 border-b border-border/50">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md mr-3">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            <SheetTitle className="font-bold text-lg">Chaite</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-4rem)]">
            <NavContent pathname={pathname} onNavClick={() => setSidebarOpen(false)} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Mobile FAB */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="default"
            size="icon"
            className="fixed bottom-4 right-4 z-40 lg:hidden shadow-xl rounded-full h-14 w-14 bg-gradient-to-br from-primary to-primary/80 hover:shadow-2xl hover:scale-105 transition-all duration-300"
            onClick={toggleSidebar}
          >
            <Menu className="h-6 w-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>打开菜单</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
