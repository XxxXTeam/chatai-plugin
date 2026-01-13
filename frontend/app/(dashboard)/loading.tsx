'use client'

import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLoading() {
    return (
        <div className="space-y-4 sm:space-y-6 animate-fade-in">
            {/* PageHeader skeleton */}
            <div className="flex items-center gap-3 sm:gap-4 pb-4 sm:pb-6">
                <Skeleton className="h-10 w-10 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl flex-shrink-0" />
                <div className="space-y-2 flex-1">
                    <Skeleton className="h-6 sm:h-8 w-32 sm:w-48" />
                    <Skeleton className="h-3 sm:h-4 w-24 sm:w-32" />
                </div>
            </div>

            {/* Stats Grid skeleton */}
            <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="rounded-xl border border-border/40 p-3 sm:p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 sm:h-4 w-16 sm:w-20" />
                            <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl" />
                        </div>
                        <Skeleton className="h-6 sm:h-8 w-12 sm:w-16" />
                        <Skeleton className="h-2 sm:h-3 w-20 sm:w-24" />
                    </div>
                ))}
            </div>

            {/* Quick access skeleton */}
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="rounded-xl border border-border/40 overflow-hidden">
                        <div className="p-3 sm:p-4 border-b border-border/40 bg-muted/20">
                            <Skeleton className="h-4 w-20" />
                        </div>
                        <div className="p-3 sm:p-4 grid grid-cols-3 sm:grid-cols-2 gap-2 sm:gap-3">
                            {[...Array(3)].map((_, j) => (
                                <div key={j} className="flex flex-col items-center gap-2 py-2">
                                    <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg" />
                                    <Skeleton className="h-2 sm:h-3 w-10 sm:w-12" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Status cards skeleton */}
            <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="rounded-xl border border-border/40 overflow-hidden">
                        <div className="p-3 sm:p-4 border-b border-border/40 flex items-center justify-between">
                            <div className="space-y-2">
                                <Skeleton className="h-4 sm:h-5 w-24 sm:w-32" />
                                <Skeleton className="h-3 w-32 sm:w-40" />
                            </div>
                            <Skeleton className="h-7 sm:h-8 w-16 sm:w-20 rounded-lg" />
                        </div>
                        <div className="p-3 sm:p-4 space-y-3">
                            {[...Array(4)].map((_, j) => (
                                <div key={j} className="flex items-center justify-between p-2">
                                    <div className="flex items-center gap-2 sm:gap-3">
                                        <Skeleton className="h-2 w-2 rounded-full" />
                                        <Skeleton className="h-3 sm:h-4 w-24 sm:w-32" />
                                    </div>
                                    <Skeleton className="h-5 w-12 rounded" />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
