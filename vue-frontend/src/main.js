import { createApp } from 'vue'
import { createPinia } from 'pinia'
import axios from 'axios'
import { createDiscreteApi } from 'naive-ui'
import App from './App.vue'
import router from './router'
import './style.css'

const { message } = createDiscreteApi(['message'])

// Configure Axios defaults
axios.defaults.baseURL = '' // Relative path for same-origin

// Request interceptor
axios.interceptors.request.use(config => {
    const token = localStorage.getItem('token')
    if (token) {
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
}, error => {
    return Promise.reject(error)
})

// Response interceptor
axios.interceptors.response.use(response => {
    return response
}, error => {
    if (error.response) {
        if (error.response.status === 401) {
            // Clear token and redirect to login on 401
            localStorage.removeItem('token')
            localStorage.removeItem('user')
            router.push('/login')
            message.error('登录已过期，请重新登录')
        } else if (error.response.status >= 500) {
            message.error('服务器错误: ' + (error.response.data?.message || error.message))
        }
    } else {
        message.error('网络连接失败: ' + error.message)
    }
    return Promise.reject(error)
})

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
