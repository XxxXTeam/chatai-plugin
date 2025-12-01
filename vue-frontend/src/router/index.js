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
            path: '/tools',
            name: 'tools',
            component: () => import('../views/ToolsManager.vue')
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
        },
        {
            path: '/history',
            name: 'history',
            component: () => import('../views/ChatHistory.vue')
        },
        {
            path: '/tool-logs',
            name: 'tool-logs',
            component: () => import('../views/ToolLogs.vue')
        },
        {
            path: '/users',
            name: 'users',
            component: () => import('../views/Users.vue')
        },
        {
            path: '/scope',
            name: 'scope',
            component: () => import('../views/ScopeManager.vue')
        },
        {
            path: '/features',
            name: 'features',
            component: () => import('../views/FeaturesConfig.vue')
        },
        {
            path: '/listener',
            name: 'listener',
            component: () => import('../views/ListenerConfig.vue')
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
