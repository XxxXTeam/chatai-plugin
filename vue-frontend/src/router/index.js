import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Login from '../views/Login.vue'

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/login',
            name: 'login',
            component: Login,
            meta: { public: true }
        },
        {
            path: '/',
            name: 'dashboard',
            component: Dashboard
        },
        {
            path: '/channels',
            name: 'channels',
            component: () => import('../views/Channels.vue')
        },
        {
            path: '/model-config',
            name: 'model-config',
            component: () => import('../views/ModelConfig.vue')
        },
        {
            path: '/presets',
            name: 'presets',
            component: () => import('../views/Presets.vue')
        },
        {
            path: '/settings',
            name: 'settings',
            component: () => import('../views/Settings.vue')
        },
        {
            path: '/mcp-servers',
            name: 'mcp-servers',
            component: () => import('../views/McpServers.vue')
        },
        {
            path: '/context',
            name: 'context',
            component: () => import('../views/ContextView.vue')
        },
        {
            path: '/memory',
            name: 'memory',
            component: () => import('../views/MemoryView.vue')
        }
    ]
})

router.beforeEach((to, from, next) => {
    const token = localStorage.getItem('token')

    if (to.meta.public) {
        if (token && to.name === 'login') {
            next('/')
        } else {
            next()
        }
        return
    }

    if (!token) {
        next('/login')
        return
    }

    next()
})

export default router
