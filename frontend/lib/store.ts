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
    (set) => ({
      token: null,
      isAuthenticated: false,
      setToken: (token) => set({ token, isAuthenticated: !!token }),
      logout: () => {
        localStorage.removeItem('chatai_token')
        set({ token: null, isAuthenticated: false })
      },
    }),
    {
      name: 'chatai-auth',
    }
  )
)

interface ConfigState {
  config: Record<string, unknown> | null
  loading: boolean
  setConfig: (config: Record<string, unknown>) => void
  setLoading: (loading: boolean) => void
}

export const useConfigStore = create<ConfigState>()((set) => ({
  config: null,
  loading: false,
  setConfig: (config) => set({ config }),
  setLoading: (loading) => set({ loading }),
}))

interface UiState {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
