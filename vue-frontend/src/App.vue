<script setup>
import { h, ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NGlobalStyle, NLayout, NLayoutSider, NLayoutHeader, NLayoutContent, NMenu, NMessageProvider, NDialogProvider, NButton, NSpace, darkTheme } from 'naive-ui'
import { DashboardOutlined, MessageOutlined, BuildOutlined, SettingsOutlined, AppsOutlined, PersonOutlined, LogOutOutlined, DarkModeOutlined, LightModeOutlined, ExtensionOutlined, TuneOutlined, PsychologyOutlined, HistoryOutlined, BugReportOutlined, PeopleOutlined } from '@vicons/material'
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
    label: () => h(RouterLink, { to: '/model-config' }, { default: () => '模型配置' }),
    key: 'model-config',
    icon: renderIcon(TuneOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/presets' }, { default: () => '预设管理' }),
    key: 'presets',
    icon: renderIcon(PersonOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/tools' }, { default: () => '工具管理' }),
    key: 'tools',
    icon: renderIcon(ExtensionOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/tool-logs' }, { default: () => '工具日志' }),
    key: 'tool-logs',
    icon: renderIcon(BugReportOutlined)
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
              :collapsed-width="64"
              :width="240"
              :native-scrollbar="false"
            >
              <n-menu
                v-model:value="activeKey"
                :collapsed-width="64"
                :collapsed-icon-size="22"
                :options="menuOptions"
              />
            </n-layout-sider>
            <n-layout-content content-style="padding: 24px;">
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
</style>
