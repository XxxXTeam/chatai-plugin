'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { configApi, tokenApi } from '@/lib/api'
import { toast } from 'sonner'
import { 
  Plus, 
  Loader2, 
  Trash2, 
  Copy,
  Link as LinkIcon,
  ExternalLink,
  Key,
  RefreshCw,
  Check,
  Info,
  ShieldCheck,
  ShieldOff
} from 'lucide-react'

interface LoginLink {
  id: string
  label: string
  baseUrl: string
}

export default function LoginLinksPage() {
  const [links, setLinks] = useState<LoginLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  
  // 永久Token相关
  const [permanentToken, setPermanentToken] = useState<string | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [generatingToken, setGeneratingToken] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  
  // 公网地址配置
  const [publicUrl, setPublicUrl] = useState('')
  const [savingPublicUrl, setSavingPublicUrl] = useState(false)

  // 获取配置
  const fetchConfig = async () => {
    try {
      setLoading(true)
      const res = await configApi.get() as { data?: { web?: { loginLinks?: LoginLink[], permanentAuthToken?: string, publicUrl?: string } } }
      if (res?.data?.web?.loginLinks) {
        setLinks(res.data.web.loginLinks)
      }
      if (res?.data?.web?.permanentAuthToken) {
        setPermanentToken(res.data.web.permanentAuthToken)
      }
      if (res?.data?.web?.publicUrl) {
        setPublicUrl(res.data.web.publicUrl)
      }
    } catch (error) {
      console.error('Failed to fetch config:', error)
      toast.error('获取配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  // 添加链接
  const handleAddLink = async () => {
    if (!newLabel.trim() || !newUrl.trim()) {
      toast.error('请填写名称和地址')
      return
    }

    // 验证URL格式
    try {
      new URL(newUrl)
    } catch {
      toast.error('请输入有效的URL地址')
      return
    }

    setSaving(true)
    try {
      // 兼容性 UUID 生成
      const generateId = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          return crypto.randomUUID()
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0
          const v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })
      }
      
      const newLink: LoginLink = {
        id: generateId(),
        label: newLabel.trim(),
        baseUrl: newUrl.trim().replace(/\/$/, '') // 去除末尾斜杠
      }
      const updatedLinks = [...links, newLink]
      await configApi.update({ web: { loginLinks: updatedLinks } })
      setLinks(updatedLinks)
      setNewLabel('')
      setNewUrl('')
      toast.success('添加成功')
    } catch (error) {
      console.error('Failed to add link:', error)
      toast.error('添加失败')
    } finally {
      setSaving(false)
    }
  }

  // 删除链接
  const handleDeleteLink = async (id: string) => {
    try {
      const updatedLinks = links.filter(l => l.id !== id)
      await configApi.update({ web: { loginLinks: updatedLinks } })
      setLinks(updatedLinks)
      toast.success('删除成功')
    } catch (error) {
      console.error('Failed to delete link:', error)
      toast.error('删除失败')
    }
  }

  // 生成登录链接
  const generateLoginUrl = (baseUrl: string) => {
    if (!permanentToken) return null
    return `${baseUrl}/login/token?token=${permanentToken}`
  }

  // 复制链接
  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      toast.error('复制失败')
    }
  }

  // 生成/刷新永久Token
  const handleGenerateToken = async (forceNew = false) => {
    setGeneratingToken(true)
    try {
      const res = await tokenApi.generatePermanent(forceNew) as { data?: { token?: string, isNew?: boolean } }
      if (res?.data?.token) {
        setPermanentToken(res.data.token)
        toast.success(forceNew ? '已重新生成永久Token' : '永久Token已生成')
      } else {
        // 重新获取配置
        await fetchConfig()
        toast.success('永久Token已生成')
      }
    } catch (error) {
      console.error('Failed to generate token:', error)
      toast.error('生成Token失败')
    } finally {
      setGeneratingToken(false)
    }
  }

  // 撤销永久Token
  const handleRevokeToken = async () => {
    setTokenLoading(true)
    try {
      await tokenApi.revokePermanent()
      setPermanentToken(null)
      toast.success('永久Token已撤销')
    } catch (error) {
      console.error('Failed to revoke token:', error)
      toast.error('撤销Token失败')
    } finally {
      setTokenLoading(false)
    }
  }

  // 保存公网地址
  const handleSavePublicUrl = async () => {
    setSavingPublicUrl(true)
    try {
      // 验证 URL 格式（如果不为空）
      if (publicUrl.trim()) {
        try {
          new URL(publicUrl.trim())
        } catch {
          toast.error('请输入有效的URL地址')
          setSavingPublicUrl(false)
          return
        }
      }
      
      await configApi.update({ 
        web: { 
          publicUrl: publicUrl.trim() ? publicUrl.trim().replace(/\/$/, '') : '' 
        } 
      })
      toast.success('公网地址已保存')
    } catch (error) {
      console.error('Failed to save public URL:', error)
      toast.error('保存失败')
    } finally {
      setSavingPublicUrl(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">登录链接</h1>
          <p className="text-muted-foreground">管理面板登录链接和永久Token</p>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">登录链接</h1>
        <p className="text-muted-foreground">管理面板登录链接和永久Token，用于从不同地址访问面板</p>
      </div>

      {/* 永久Token管理 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            永久Token
          </CardTitle>
          <CardDescription>
            永久Token可用于生成不过期的登录链接，请妥善保管
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {permanentToken ? (
            <>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-500" />
                <span className="text-sm text-green-600 dark:text-green-400">永久Token已启用</span>
              </div>
              <div className="flex items-center gap-2">
                <Input 
                  value={permanentToken} 
                  readOnly 
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(permanentToken, 'token')}
                >
                  {copiedId === 'token' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleGenerateToken(true)}
                  disabled={generatingToken}
                >
                  {generatingToken ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  重新生成
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRevokeToken}
                  disabled={tokenLoading}
                >
                  {tokenLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldOff className="h-4 w-4 mr-2" />
                  )}
                  撤销Token
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <ShieldOff className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">永久Token未启用</span>
              </div>
              <Button onClick={() => handleGenerateToken(false)} disabled={generatingToken}>
                {generatingToken ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Key className="h-4 w-4 mr-2" />
                )}
                生成永久Token
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* 公网地址配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="h-5 w-5" />
            公网地址
          </CardTitle>
          <CardDescription>
            手动配置公网访问地址，用于 #ai管理面板 命令显示
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              placeholder="http://your-public-ip:3000"
              className="flex-1"
            />
            <Button onClick={handleSavePublicUrl} disabled={savingPublicUrl}>
              {savingPublicUrl ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                '保存'
              )}
            </Button>
          </div>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              如果自动检测公网 IP 不可靠，可以手动配置公网地址。留空则使用自动检测。
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* 自定义登录链接 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            自定义登录地址
          </CardTitle>
          <CardDescription>
            添加自定义域名或地址，用于生成对应的登录链接
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!permanentToken && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                请先生成永久Token，才能使用自定义登录链接
              </AlertDescription>
            </Alert>
          )}

          {/* 添加新链接 */}
          <div className="flex gap-2">
            <Input
              placeholder="名称，如：公网地址"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="地址，如：https://example.com:3000"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleAddLink} disabled={saving || !newLabel || !newUrl}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* 链接列表 */}
          {links.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>登录链接</TableHead>
                  <TableHead className="w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => {
                  const loginUrl = generateLoginUrl(link.baseUrl)
                  return (
                    <TableRow key={link.id}>
                      <TableCell className="font-medium">{link.label || '(未命名)'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <a 
                          href={link.baseUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="hover:text-primary hover:underline flex items-center gap-1"
                        >
                          {link.baseUrl}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell>
                        {loginUrl ? (
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-muted px-2 py-1 rounded max-w-xs truncate block">
                              {loginUrl}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleCopy(loginUrl, link.id)}
                            >
                              {copiedId === link.id ? (
                                <Check className="h-3 w-3 text-green-500" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">需要永久Token</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteLink(link.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <LinkIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>暂无自定义登录地址</p>
              <p className="text-sm mt-1">添加你的域名或公网IP地址</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
