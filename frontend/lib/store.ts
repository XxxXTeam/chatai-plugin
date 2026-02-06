import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
    token: string | null
    isAuthenticated: boolean
    setToken: (token: string | null) => void
    logout: () => void
}

export const useAuthStore = create<AuthState>()(
    persist(
        set => ({
            token: null,
            isAuthenticated: false,
            setToken: token => set({ token, isAuthenticated: !!token }),
            logout: () => {
                localStorage.removeItem('chatai_token')
                document.cookie = 'auth_token=; path=/chatai; expires=Thu, 01 Jan 1970 00:00:00 GMT'
                set({ token: null, isAuthenticated: false })
            }
        }),
        {
            name: 'chatai-auth'
        }
    )
)

interface ConfigState {
    config: Record<string, unknown> | null
    loading: boolean
    lastFetched: number | null
    setConfig: (config: Record<string, unknown>) => void
    setLoading: (loading: boolean) => void
    isStale: (maxAge?: number) => boolean
}

export const useConfigStore = create<ConfigState>()((set, get) => ({
    config: null,
    loading: false,
    lastFetched: null,
    setConfig: config => set({ config, lastFetched: Date.now() }),
    setLoading: loading => set({ loading }),
    isStale: (maxAge = 60000) => {
        const { lastFetched } = get()
        if (!lastFetched) return true
        return Date.now() - lastFetched > maxAge
    }
}))

interface UiState {
    sidebarOpen: boolean
    sidebarCollapsed: boolean
    theme: 'light' | 'dark' | 'system'
    setSidebarOpen: (open: boolean) => void
    toggleSidebar: () => void
    setSidebarCollapsed: (collapsed: boolean) => void
    setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useUiStore = create<UiState>()(
    persist(
        set => ({
            sidebarOpen: false, // 默认关闭，防止移动端刷新时弹出
            sidebarCollapsed: false,
            theme: 'system',
            setSidebarOpen: open => set({ sidebarOpen: open }),
            toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
            setSidebarCollapsed: collapsed => set({ sidebarCollapsed: collapsed }),
            setTheme: theme => set({ theme })
        }),
        {
            name: 'chatai-ui',
            partialize: state => ({
                sidebarCollapsed: state.sidebarCollapsed,
                theme: state.theme
            })
        }
    )
)

// 通知状态管理
interface NotificationState {
    notifications: Array<{
        id: string
        type: 'success' | 'error' | 'warning' | 'info'
        title: string
        message?: string
        duration?: number
    }>
    addNotification: (notification: Omit<NotificationState['notifications'][0], 'id'>) => void
    removeNotification: (id: string) => void
    clearNotifications: () => void
}

export const useNotificationStore = create<NotificationState>()(set => ({
    notifications: [],
    addNotification: notification => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        set(state => ({
            notifications: [...state.notifications, { ...notification, id }]
        }))
        if (notification.duration !== 0) {
            setTimeout(() => {
                set(state => ({
                    notifications: state.notifications.filter(n => n.id !== id)
                }))
            }, notification.duration || 5000)
        }
    },
    removeNotification: id =>
        set(state => ({
            notifications: state.notifications.filter(n => n.id !== id)
        })),
    clearNotifications: () => set({ notifications: [] })
}))

// 页面标签状态管理
const MAX_TABS = 10

export interface TabItem {
    path: string
    label: string
    icon?: string // lucide icon name
    closable: boolean
}

interface TabState {
    tabs: TabItem[]
    activeTab: string
    addTab: (tab: TabItem) => void
    removeTab: (path: string) => void
    setActiveTab: (path: string) => void
    clearOtherTabs: (path: string) => void
    clearTabs: () => void
}

const HOME_TAB: TabItem = { path: '/', label: '仪表盘', icon: 'LayoutDashboard', closable: false }

export const useTabStore = create<TabState>()(
    persist(
        (set, get) => ({
            tabs: [HOME_TAB],
            activeTab: '/',
            addTab: (tab: TabItem) => {
                const { tabs } = get()
                // Already exists, just activate
                if (tabs.some(t => t.path === tab.path)) {
                    set({ activeTab: tab.path })
                    return
                }
                const newTabs = [...tabs, tab]
                // Enforce max tabs - remove oldest closable tab
                if (newTabs.length > MAX_TABS) {
                    const activeTab = get().activeTab
                    const removeIdx = newTabs.findIndex(t => t.closable && t.path !== activeTab && t.path !== tab.path)
                    if (removeIdx !== -1) {
                        newTabs.splice(removeIdx, 1)
                    }
                }
                set({ tabs: newTabs, activeTab: tab.path })
            },
            removeTab: (path: string) => {
                const { tabs, activeTab } = get()
                const tab = tabs.find(t => t.path === path)
                if (!tab || !tab.closable) return
                const newTabs = tabs.filter(t => t.path !== path)
                // If removing active tab, switch to adjacent tab
                if (activeTab === path) {
                    const idx = tabs.findIndex(t => t.path === path)
                    const nextTab = tabs[idx + 1] || tabs[idx - 1] || newTabs[0]
                    set({ tabs: newTabs, activeTab: nextTab?.path || '/' })
                } else {
                    set({ tabs: newTabs })
                }
            },
            setActiveTab: (path: string) => set({ activeTab: path }),
            clearOtherTabs: (path: string) => {
                const { tabs } = get()
                const kept = tabs.filter(t => !t.closable || t.path === path)
                set({ tabs: kept, activeTab: path })
            },
            clearTabs: () => set({ tabs: [HOME_TAB], activeTab: '/' })
        }),
        {
            name: 'chatai-tabs',
            // Only persist the tabs list, NOT activeTab
            // activeTab is always derived from current URL to avoid hydration mismatch
            partialize: state => ({
                tabs: state.tabs
            })
        }
    )
)
