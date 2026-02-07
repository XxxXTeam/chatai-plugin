import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'

export const metadata: Metadata = {
    title: 'ChatAi- AI管理面板',
    description: 'Yunzai-Bot AI插件管理面板'
}

export default function RootLayout({
    children
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="zh-CN" suppressHydrationWarning>
            <head>
                {/* 内联初始加载样式：防止 JS/CSS 未加载时白屏 */}
                <style dangerouslySetInnerHTML={{ __html: `
                    #__next-loading-indicator {
                        display: flex;
                        height: 100vh;
                        align-items: center;
                        justify-content: center;
                        background: #f8fafc;
                    }
                    .dark #__next-loading-indicator {
                        background: #020617;
                    }
                    #__next-loading-indicator .spinner {
                        width: 40px;
                        height: 40px;
                        border: 4px solid #e2e8f0;
                        border-top-color: #0f172a;
                        border-radius: 50%;
                        animation: nl-spin 0.8s linear infinite;
                    }
                    .dark #__next-loading-indicator .spinner {
                        border-color: #334155;
                        border-top-color: #e2e8f0;
                    }
                    @keyframes nl-spin {
                        to { transform: rotate(360deg); }
                    }
                ` }} />
            </head>
            <body className="font-sans antialiased">
                {/* 纯 CSS 加载指示器：React 渲染后自动被覆盖 */}
                <div id="__next-loading-indicator">
                    <div className="spinner" />
                </div>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                    {children}
                    <Toaster richColors position="top-right" />
                </ThemeProvider>
                {/* 隐藏加载指示器：React 渲染后执行 */}
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        var el = document.getElementById('__next-loading-indicator');
                        if (el) el.style.display = 'none';
                    })();
                ` }} />
            </body>
        </html>
    )
}
