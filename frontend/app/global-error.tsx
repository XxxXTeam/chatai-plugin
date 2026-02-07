'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error('[Global Error]', error)
    }, [error])

    return (
        <html lang="zh-CN">
            <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
                <div
                    style={{
                        display: 'flex',
                        height: '100vh',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1rem',
                        backgroundColor: '#f8fafc'
                    }}
                >
                    <div style={{ textAlign: 'center', maxWidth: '400px' }}>
                        <div
                            style={{
                                width: '64px',
                                height: '64px',
                                margin: '0 auto 1rem',
                                borderRadius: '50%',
                                backgroundColor: '#fef2f2',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '2rem'
                            }}
                        >
                            ⚠
                        </div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                            应用加载失败
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.5rem' }}>
                            {error.message || '发生了意外错误'}
                        </p>
                        <button
                            onClick={reset}
                            style={{
                                padding: '0.5rem 1.5rem',
                                backgroundColor: '#0f172a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.5rem',
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                marginRight: '0.5rem'
                            }}
                        >
                            重试
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: '0.5rem 1.5rem',
                                backgroundColor: 'white',
                                color: '#0f172a',
                                border: '1px solid #e2e8f0',
                                borderRadius: '0.5rem',
                                cursor: 'pointer',
                                fontSize: '0.875rem'
                            }}
                        >
                            刷新页面
                        </button>
                    </div>
                </div>
            </body>
        </html>
    )
}
