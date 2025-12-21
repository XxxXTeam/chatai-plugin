import * as React from "react"
import { cn } from "@/lib/utils"
import { LucideIcon, Inbox } from "lucide-react"
import { Button } from "./button"

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: {
    label: string
    onClick?: () => void
    href?: string
  }
}

function EmptyState({
  icon: Icon = Inbox,
  title = "暂无数据",
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center animate-fade-in",
        className
      )}
      {...props}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full" />
        <div className="relative p-4 rounded-full bg-muted/50">
          <Icon className="w-12 h-12 text-muted-foreground/50" strokeWidth={1.5} />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-foreground/80 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <Button
          variant="outline"
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
