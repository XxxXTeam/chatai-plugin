<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { NCard, NForm, NFormItem, NInput, NButton, NAlert, useMessage } from 'naive-ui'
import axios from 'axios'

const router = useRouter()
const message = useMessage()

const formValue = ref({
  token: ''
})

const loading = ref(false)

async function handleLogin() {
  if (!formValue.value.token) {
    message.error('请输入登录令牌')
    return
  }

  loading.value = true
  try {
    const res = await axios.post('/api/auth/login', formValue.value)
    if (res.data.code === 0) {
      message.success('登录成功')
      localStorage.setItem('token', res.data.data.token)
      router.push('/')
    } else {
      message.error(res.data.message || '登录失败')
    }
  } catch (error) {
    message.error(error.response?.data?.message || '登录请求失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <n-card title="Chaite 管理面板" style="width: 450px">
      <n-alert type="info" title="获取登录令牌" style="margin-bottom: 16px">
        请在服务器控制台日志中查看临时登录令牌
      </n-alert>
      <n-form>
        <n-form-item label="登录令牌">
          <n-input
            v-model:value="formValue.token"
            placeholder="请输入临时令牌"
            @keydown.enter="handleLogin"
            :autofocus="true"
          />
        </n-form-item>
        <n-button type="primary" block :loading="loading" @click="handleLogin">
          登录
        </n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #f0f2f5;
}
</style>
