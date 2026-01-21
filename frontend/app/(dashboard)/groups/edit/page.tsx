'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { GroupEditor } from '../[id]/editor'
import { Loader2 } from 'lucide-react'

function GroupEditContent() {
    const searchParams = useSearchParams()
    const id = searchParams.get('id') || 'new'
    
    return <GroupEditor id={id} />
}

export default function GroupEditPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <GroupEditContent />
        </Suspense>
    )
}
