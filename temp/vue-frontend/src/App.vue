<script setup>
import { h, ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NGlobalStyle, NLayout, NLayoutSider, NLayoutHeader, NLayoutContent, NMenu, NMessageProvider, NDialogProvider, NButton, NSpace, darkTheme } from 'naive-ui'
import { DashboardOutlined, MessageOutlined, BuildOutlined, SettingsOutlined, AppsOutlined, PersonOutlined, LogOutOutlined, DarkModeOutlined, LightModeOutlined, ExtensionOutlined, TuneOutlined, PsychologyOutlined, HistoryOutlined, BugReportOutlined, PeopleOutlined, GroupOutlined, VolumeUpOutlined, HearingOutlined, TouchAppOutlined, CodeOutlined } from '@vicons/material'
import { NIcon } from 'naive-ui'

const route = useRoute()
const router = useRouter()
const theme = ref(null)

function renderIcon(icon) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions = computed(() => [
  {
    label: () => h(RouterLink, { to: '/' }, { default: () => '仪表盘' }),
    key: 'dashboard',
    icon: renderIcon(DashboardOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/channels' }, { default: () => '渠道管理' }),
    key: 'channels',
    icon: renderIcon(AppsOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/presets' }, { default: () => '预设管理' }),
    key: 'presets',
    icon: renderIcon(PersonOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/scope' }, { default: () => '独立人格' }),
    key: 'scope',
    icon: renderIcon(GroupOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/tools' }, { default: () => '工具管理' }),
    key: 'tools',
    icon: renderIcon(ExtensionOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/history' }, { default: () => '对话历史' }),
    key: 'history',
    icon: renderIcon(HistoryOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/memory' }, { default: () => '记忆库' }),
    key: 'memory',
    icon: renderIcon(PsychologyOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/users' }, { default: () => '用户管理' }),
    key: 'users',
    icon: renderIcon(PeopleOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/settings' }, { default: () => '系统设置' }),
    key: 'settings',
    icon: renderIcon(SettingsOutlined)
  }
])

const activeKey = ref('dashboard')
const collapsed = ref(window.innerWidth < 768)

// 监听窗口大小变化
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    collapsed.value = window.innerWidth < 768
  })
}

onMounted(() => {
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme === 'dark') {
        theme.value = darkTheme
    }
})

function toggleTheme() {
    if (theme.value) {
        theme.value = null
        localStorage.setItem('theme', 'light')
    } else {
        theme.value = darkTheme
        localStorage.setItem('theme', 'dark')
    }
}

function handleLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push('/login')
}

// 检查 URL 中是否有 auth_token（从 /login/token 重定向过来）
onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search)
  const authToken = urlParams.get('auth_token')
  
  if (authToken) {
    // 保存 token
    localStorage.setItem('token', authToken)
    
    // 清除 URL 中的 token
    window.history.replaceState({}, document.title, window.location.pathname)
  }
  
  // 加载主题
  const savedTheme = localStorage.getItem('theme')
  if (savedTheme === 'dark') {
    theme.value = darkTheme
  }
})
</script>

<template>
  <n-config-provider :theme="theme">
    <n-global-style />
    <n-message-provider>
      <n-dialog-provider>
        <div v-if="route.name === 'login'">
          <router-view />
        </div>
        <n-layout v-else style="height: 100vh">
          <n-layout-header style="height: 64px; padding: 0 24px; display: flex; justify-content: space-between; align-items: center;" bordered>
            <div class="text-xl font-bold">Chaite Dashboard</div>
            <n-space align="center">
              <n-button quaternary circle @click="toggleTheme">
                <template #icon>
                  <n-icon>
                    <DarkModeOutlined v-if="!theme" />
                    <LightModeOutlined v-else />
                  </n-icon>
                </template>
              </n-button>
              <n-button quaternary circle @click="handleLogout">
                <template #icon>
                  <n-icon><LogOutOutlined /></n-icon>
                </template>
              </n-button>
            </n-space>
          </n-layout-header>
          <n-layout has-sider position="absolute" style="top: 64px; bottom: 0">
            <n-layout-sider
              bordered
              collapse-mode="width"
              :collapsed="collapsed"
              :collapsed-width="64"
              :width="200"
              :native-scrollbar="false"
              show-trigger
              @collapse="collapsed = true"
              @expand="collapsed = false"
            >
              <n-menu
                v-model:value="activeKey"
                :collapsed="collapsed"
                :collapsed-width="64"
                :collapsed-icon-size="20"
                :options="menuOptions"
              />
            </n-layout-sider>
            <n-layout-content content-style="padding: 16px;" class="main-content">
              <router-view />
            </n-layout-content>
          </n-layout>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
/* 暗色主题适配 */
.n-config-provider--dark {
  --text-color: #e0e0e0;
  --bg-color: #18181c;
}

.n-config-provider--dark .login-container {
  background-color: #18181c !important;
}

.n-config-provider--dark .n-layout-header {
  background-color: #1f1f23 !important;
}

.n-config-provider--dark .n-layout-sider {
  background-color: #1f1f23 !important;
}

.n-config-provider--dark .n-card {
  background-color: #27272a !important;
}

/* 模板库卡片暗色适配 */
.n-config-provider--dark .n-card p {
  color: #a0a0a0 !important;
}

.n-config-provider--dark .n-card p:last-child {
  color: #707070 !important;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .n-layout-header {
    padding: 0 12px !important;
  }
  
  .main-content {
    padding: 12px !important;
  }
  
  .n-card {
    margin-bottom: 12px;
  }
}

/* 滚动条美化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #666;
}

/* 过渡动画 */
.n-card {
  transition: box-shadow 0.2s ease;
}

.n-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}
</style>
