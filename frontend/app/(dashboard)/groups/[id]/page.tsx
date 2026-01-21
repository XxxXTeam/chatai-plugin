import { GroupEditor } from './editor'

// 静态导出需要预渲染的路径
export function generateStaticParams() {
    return [{ id: 'new' }]
}

export default async function GroupEditPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <GroupEditor id={id} />
}
