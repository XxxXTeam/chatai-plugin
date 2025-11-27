<script setup>
import { ref } from 'vue'
import { NUpload, NModal, NImage, NButton, NSpace, useMessage } from 'naive-ui'
import axios from 'axios'

const props = defineProps({
  onUpload: {
    type: Function,
    default: () => {}
  }
})

const message = useMessage()
const showPreview = ref(false)
const previewImageUrl = ref('')
const fileList = ref([])

async function handleUpload({ file, onFinish, onError }) {
  const formData = new FormData()
  formData.append('image', file.file)

  try {
    const res = await axios.post('/api/upload/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    if (res.data.code === 0) {
      message.success('上传成功')
      file.url = `/api/images/${res.data.data.id}`
      file.name = res.data.data.id
      onFinish()
      props.onUpload(res.data.data)
    } else {
      message.error(res.data.message || '上传失败')
      onError()
    }
  } catch (err) {
    message.error('上传出错')
    onError()
  }
}

function handlePreview(file) {
  const { url } = file
  previewImageUrl.value = url
  showPreview.value = true
}
</script>

<template>
  <div class="image-upload">
    <n-upload
      list-type="image-card"
      :custom-request="handleUpload"
      :on-preview="handlePreview"
      v-model:file-list="fileList"
      accept="image/*"
    >
      点击上传
    </n-upload>

    <n-modal
      v-model:show="showPreview"
      preset="card"
      style="width: 600px"
      title="图片预览"
    >
      <img :src="previewImageUrl" style="width: 100%" />
    </n-modal>
  </div>
</template>
