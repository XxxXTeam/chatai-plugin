'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
  ChevronRight,
  UserCog,
  Brain,
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

const navItems = [
  { href: '/', label: '仪表盘', icon: LayoutDashboard },
  { href: '/settings', label: '系统设置', icon: Settings, children: [
    { href: '/settings', label: '基础设置' },
    { href: '/settings/trigger', label: '触发配置' },
    { href: '/settings/context', label: '上下文' },
    { href: '/settings/proxy', label: '代理设置' },
    { href: '/settings/links', label: '登录链接' },
  ]},
  { href: '/channels', label: '渠道管理', icon: Plug },
  { href: '/presets', label: '预设管理', icon: Palette },
  { href: '/tools', label: '工具配置', icon: Wrench },
  { href: '/mcp', label: 'MCP服务', icon: Bot },
  { href: '/conversations', label: '对话历史', icon: MessageSquare },
  { href: '/history', label: '调用记录', icon: History },
  { href: '/memory', label: '记忆管理', icon: Brain },
  { href: '/scope', label: '人设管理', icon: UserCog },
  { href: '/users', label: '用户管理', icon: Users },
  { href: '/groups', label: '群组管理', icon: UsersRound },
]

// 导航项渲染
function NavContent({ pathname, onNavClick }: { pathname: string, onNavClick?: () => void }) {
  return (
    <nav className="p-4 space-y-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
        const hasChildren = item.children && item.children.length > 0
        
        return (
          <div key={item.href}>
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:translate-x-1'
              )}
              onClick={() => {
                if (!hasChildren && onNavClick) onNavClick()
              }}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{item.label}</span>
              {hasChildren && (
                <ChevronRight className={cn(
                  "h-4 w-4 ml-auto transition-transform",
                  isActive && "rotate-90"
                )} />
              )}
            </Link>
            
            {/* 子菜单 */}
            {hasChildren && isActive && (
              <div className="ml-6 mt-1 space-y-1 animate-in slide-in-from-left-2">
                {item.children!.map((child) => {
                  const isChildActive = pathname === child.href
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cn(
                        'block px-3 py-2 rounded-lg text-sm transition-colors',
                        isChildActive
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                      )}
                      onClick={onNavClick}
                    >
                      {child.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useUiStore()

  return (
    <TooltipProvider>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 bg-card border-r h-screen sticky top-0">
        <div className="flex h-16 items-center px-4 border-b">
          <Link href="/" className="flex items-center gap-2 group">
            <Bot className="h-6 w-6 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-bold text-lg">Chaite</span>
          </Link>
        </div>
        <ScrollArea className="h-[calc(100vh-4rem)]">
          <NavContent pathname={pathname} />
        </ScrollArea>
      </aside>

      {/* Mobile Sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="h-16 flex flex-row items-center px-4 border-b">
            <Bot className="h-6 w-6 text-primary mr-2" />
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
            className="fixed bottom-4 right-4 z-40 lg:hidden shadow-lg rounded-full h-12 w-12"
            onClick={toggleSidebar}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>打开菜单</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
