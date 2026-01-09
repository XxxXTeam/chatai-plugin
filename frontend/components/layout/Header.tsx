'use client'

import { Menu, LogOut, User, Search, Command } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUiStore, useAuthStore } from '@/lib/store'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/theme-toggle'

interface HeaderProps {
  title?: string
  onSearchClick?: () => void
}

export function Header({ title = 'ChatAi 管理面板', onSearchClick }: HeaderProps) {
  const { toggleSidebar } = useUiStore()
  const { logout } = useAuthStore()
  const router = useRouter()

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <header className="glass-panel flex h-16 items-center gap-4 px-4 md:px-6 transition-all duration-300">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={toggleSidebar}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1">
        <h1 className="text-lg font-semibold md:text-xl tracking-tight text-foreground/80">{title}</h1>
      </div>

      {/* 搜索按钮 */}
      {onSearchClick && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSearchClick}
          className="hidden sm:flex items-center gap-2 h-9 px-3 text-muted-foreground hover:text-foreground bg-background/50 border-border/50"
        >
          <Search className="h-4 w-4" />
          <span className="text-sm">搜索功能...</span>
          <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border/50 bg-muted/50 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>
        </Button>
      )}
      
      {/* 移动端搜索图标 */}
      {onSearchClick && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSearchClick}
          className="sm:hidden"
        >
          <Search className="h-5 w-5" />
        </Button>
      )}

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full overflow-hidden border border-primary/20 hover:border-primary/50 transition-colors w-9 h-9">
            <div className="w-full h-full bg-gradient-to-tr from-primary/20 to-secondary/20 flex items-center justify-center">
              <User className="h-4 w-4 text-primary" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass-card border-border/50">
          <DropdownMenuItem disabled className="font-medium">
            <User className="mr-2 h-4 w-4" />
            管理员
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border/50" />
          <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
            <LogOut className="mr-2 h-4 w-4" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
