<script setup>
import { h, ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NConfigProvider, NGlobalStyle, NLayout, NLayoutSider, NLayoutHeader, NLayoutContent, NMenu, NMessageProvider, NDialogProvider, NButton, NSpace, darkTheme } from 'naive-ui'
import { DashboardOutlined, MessageOutlined, BuildOutlined, SettingsOutlined, AppsOutlined, PersonOutlined, LogOutOutlined, DarkModeOutlined, LightModeOutlined } from '@vicons/material'
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
    icon: renderIcon(BuildOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/presets' }, { default: () => '预设管理' }),
    key: 'presets',
    icon: renderIcon(AppsOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/mcp-servers' }, { default: () => 'MCP 服务器' }),
    key: 'mcp-servers',
    icon: renderIcon(AppsOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/settings' }, { default: () => '系统设置' }),
    key: 'settings',
    icon: renderIcon(SettingsOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/context' }, { default: () => '上下文' }),
    key: 'context',
    icon: renderIcon(PersonOutlined)
  },
  {
    label: () => h(RouterLink, { to: '/memory' }, { default: () => '记忆库' }),
    key: 'memory',
    icon: renderIcon(AppsOutlined)
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
