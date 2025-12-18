import { KnowledgeEditor } from './editor'

// 静态导出：只预渲染 'new' 页面，其他 ID 通过查询参数传递
export function generateStaticParams() {
  return [{ id: 'new' }]
}

// 服务端页面组件，包裹客户端编辑器
export default async function KnowledgeEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <KnowledgeEditor id={id} />
}
