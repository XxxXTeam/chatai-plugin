<script setup>
import { ref, onMounted, computed } from 'vue'
import { NCard, NTabs, NTabPane, NDataTable, NButton, NSpace, NModal, NForm, NFormItem, NInput, NSelect, NEmpty, NTag, NPopconfirm, useMessage } from 'naive-ui'
import axios from 'axios'

const message = useMessage()

// 数据
const userScopes = ref([])
const groupScopes = ref([])
const groupUserScopes = ref([])
const loading = ref(false)

// 模态框
const showUserModal = ref(false)
const showGroupModal = ref(false)
const showGroupUserModal = ref(false)
const editMode = ref(false)

// 表单数据
const userForm = ref({
    userId: '',
    systemPrompt: '',
    presetId: ''
})

const groupForm = ref({
    groupId: '',
    systemPrompt: '',
    presetId: ''
})

const groupUserForm = ref({
    groupId: '',
    userId: '',
    systemPrompt: '',
    presetId: ''
})

// 预设选项
const presetOptions = ref([])

// API 请求头
const getHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`
})

// 加载数据
async function loadData() {
    loading.value = true
    try {
        const [usersRes, groupsRes, groupUsersRes, presetsRes] = await Promise.all([
            axios.get('/api/scope/users', { headers: getHeaders() }),
            axios.get('/api/scope/groups', { headers: getHeaders() }),
            axios.get('/api/scope/group-users', { headers: getHeaders() }),
            axios.get('/api/preset/list', { headers: getHeaders() })
        ])
        
        userScopes.value = usersRes.data?.data || []
        groupScopes.value = groupsRes.data?.data || []
        groupUserScopes.value = groupUsersRes.data?.data || []
        
        presetOptions.value = (presetsRes.data?.data || []).map(p => ({
            label: p.name || p.id,
            value: p.id
        }))
    } catch (err) {
        message.error('加载数据失败: ' + err.message)
    } finally {
        loading.value = false
    }
}

// 用户作用域表格列
const userColumns = [
    { title: '用户ID', key: 'userId', width: 150 },
    { 
        title: '自定义Prompt', 
        key: 'systemPrompt',
        ellipsis: { tooltip: true },
        render: (row) => row.systemPrompt ? row.systemPrompt.substring(0, 50) + (row.systemPrompt.length > 50 ? '...' : '') : '-'
    },
    { title: '预设', key: 'presetId', width: 120 },
    { 
        title: '更新时间', 
        key: 'updatedAt',
        width: 180,
        render: (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'
    },
    {
        title: '操作',
        key: 'actions',
        width: 150,
        render: (row) => {
            return h(NSpace, null, {
                default: () => [
                    h(NButton, { size: 'small', onClick: () => editUser(row) }, { default: () => '编辑' }),
                    h(NPopconfirm, { onPositiveClick: () => deleteUser(row.userId) }, {
                        trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
                        default: () => '确认删除此用户的人格设定？'
                    })
                ]
            })
        }
    }
]

// 群组作用域表格列
const groupColumns = [
    { title: '群组ID', key: 'groupId', width: 150 },
    { 
        title: '自定义Prompt', 
        key: 'systemPrompt',
        ellipsis: { tooltip: true },
        render: (row) => row.systemPrompt ? row.systemPrompt.substring(0, 50) + (row.systemPrompt.length > 50 ? '...' : '') : '-'
    },
    { title: '预设', key: 'presetId', width: 120 },
    { 
        title: '更新时间', 
        key: 'updatedAt',
        width: 180,
        render: (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'
    },
    {
        title: '操作',
        key: 'actions',
        width: 150,
        render: (row) => {
            return h(NSpace, null, {
                default: () => [
                    h(NButton, { size: 'small', onClick: () => editGroup(row) }, { default: () => '编辑' }),
                    h(NPopconfirm, { onPositiveClick: () => deleteGroup(row.groupId) }, {
                        trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
                        default: () => '确认删除此群组的人格设定？'
                    })
                ]
            })
        }
    }
]

// 群用户作用域表格列
const groupUserColumns = [
    { title: '群组ID', key: 'groupId', width: 150 },
    { title: '用户ID', key: 'userId', width: 150 },
    { 
        title: '自定义Prompt', 
        key: 'systemPrompt',
        ellipsis: { tooltip: true },
        render: (row) => row.systemPrompt ? row.systemPrompt.substring(0, 50) + (row.systemPrompt.length > 50 ? '...' : '') : '-'
    },
    { title: '预设', key: 'presetId', width: 120 },
    {
        title: '操作',
        key: 'actions',
        width: 150,
        render: (row) => {
            return h(NSpace, null, {
                default: () => [
                    h(NButton, { size: 'small', onClick: () => editGroupUser(row) }, { default: () => '编辑' }),
                    h(NPopconfirm, { onPositiveClick: () => deleteGroupUser(row.groupId, row.userId) }, {
                        trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
                        default: () => '确认删除此群内用户的人格设定？'
                    })
                ]
            })
        }
    }
]

// 用户操作
function openUserModal() {
    editMode.value = false
    userForm.value = { userId: '', systemPrompt: '', presetId: '' }
    showUserModal.value = true
}

function editUser(row) {
    editMode.value = true
    userForm.value = { ...row }
    showUserModal.value = true
}

async function saveUser() {
    if (!userForm.value.userId) {
        message.warning('请输入用户ID')
        return
    }
    try {
        await axios.put(`/api/scope/user/${userForm.value.userId}`, {
            systemPrompt: userForm.value.systemPrompt,
            presetId: userForm.value.presetId
        }, { headers: getHeaders() })
        message.success('保存成功')
        showUserModal.value = false
        loadData()
    } catch (err) {
        message.error('保存失败: ' + err.message)
    }
}

async function deleteUser(userId) {
    try {
        await axios.delete(`/api/scope/user/${userId}`, { headers: getHeaders() })
        message.success('删除成功')
        loadData()
    } catch (err) {
        message.error('删除失败: ' + err.message)
    }
}

// 群组操作
function openGroupModal() {
    editMode.value = false
    groupForm.value = { groupId: '', systemPrompt: '', presetId: '' }
    showGroupModal.value = true
}

function editGroup(row) {
    editMode.value = true
    groupForm.value = { ...row }
    showGroupModal.value = true
}

async function saveGroup() {
    if (!groupForm.value.groupId) {
        message.warning('请输入群组ID')
        return
    }
    try {
        await axios.put(`/api/scope/group/${groupForm.value.groupId}`, {
            systemPrompt: groupForm.value.systemPrompt,
            presetId: groupForm.value.presetId
        }, { headers: getHeaders() })
        message.success('保存成功')
        showGroupModal.value = false
        loadData()
    } catch (err) {
        message.error('保存失败: ' + err.message)
    }
}

async function deleteGroup(groupId) {
    try {
        await axios.delete(`/api/scope/group/${groupId}`, { headers: getHeaders() })
        message.success('删除成功')
        loadData()
    } catch (err) {
        message.error('删除失败: ' + err.message)
    }
}

// 群用户操作
function openGroupUserModal() {
    editMode.value = false
    groupUserForm.value = { groupId: '', userId: '', systemPrompt: '', presetId: '' }
    showGroupUserModal.value = true
}

function editGroupUser(row) {
    editMode.value = true
    groupUserForm.value = { ...row }
    showGroupUserModal.value = true
}

async function saveGroupUser() {
    if (!groupUserForm.value.groupId || !groupUserForm.value.userId) {
        message.warning('请输入群组ID和用户ID')
        return
    }
    try {
        await axios.put(`/api/scope/group/${groupUserForm.value.groupId}/user/${groupUserForm.value.userId}`, {
            systemPrompt: groupUserForm.value.systemPrompt,
            presetId: groupUserForm.value.presetId
        }, { headers: getHeaders() })
        message.success('保存成功')
        showGroupUserModal.value = false
        loadData()
    } catch (err) {
        message.error('保存失败: ' + err.message)
    }
}

async function deleteGroupUser(groupId, userId) {
    try {
        await axios.delete(`/api/scope/group/${groupId}/user/${userId}`, { headers: getHeaders() })
        message.success('删除成功')
        loadData()
    } catch (err) {
        message.error('删除失败: ' + err.message)
    }
}

import { h } from 'vue'

onMounted(() => {
    loadData()
})
</script>

<template>
    <div>
        <n-card title="独立人格管理">
            <template #header-extra>
                <n-tag type="info">优先级: 群内用户 > 群组 > 用户全局 > 默认预设</n-tag>
            </template>
            
            <n-tabs type="line" animated>
                <!-- 用户作用域 -->
                <n-tab-pane name="user" tab="用户人格">
                    <n-space vertical>
                        <n-space>
                            <n-button type="primary" @click="openUserModal">添加用户人格</n-button>
                            <n-button @click="loadData">刷新</n-button>
                        </n-space>
                        <n-data-table
                            :columns="userColumns"
                            :data="userScopes"
                            :loading="loading"
                            :bordered="false"
                        />
                        <n-empty v-if="userScopes.length === 0 && !loading" description="暂无用户人格设定" />
                    </n-space>
                </n-tab-pane>
                
                <!-- 群组作用域 -->
                <n-tab-pane name="group" tab="群组人格">
                    <n-space vertical>
                        <n-space>
                            <n-button type="primary" @click="openGroupModal">添加群组人格</n-button>
                            <n-button @click="loadData">刷新</n-button>
                        </n-space>
                        <n-data-table
                            :columns="groupColumns"
                            :data="groupScopes"
                            :loading="loading"
                            :bordered="false"
                        />
                        <n-empty v-if="groupScopes.length === 0 && !loading" description="暂无群组人格设定" />
                    </n-space>
                </n-tab-pane>
                
                <!-- 群用户作用域 -->
                <n-tab-pane name="groupUser" tab="群内用户人格">
                    <n-space vertical>
                        <n-space>
                            <n-button type="primary" @click="openGroupUserModal">添加群内用户人格</n-button>
                            <n-button @click="loadData">刷新</n-button>
                        </n-space>
                        <n-data-table
                            :columns="groupUserColumns"
                            :data="groupUserScopes"
                            :loading="loading"
                            :bordered="false"
                        />
                        <n-empty v-if="groupUserScopes.length === 0 && !loading" description="暂无群内用户人格设定" />
                    </n-space>
                </n-tab-pane>
            </n-tabs>
        </n-card>
        
        <!-- 用户人格模态框 -->
        <n-modal v-model:show="showUserModal" preset="card" :title="editMode ? '编辑用户人格' : '添加用户人格'" style="width: 600px;">
            <n-form :model="userForm" label-placement="left" label-width="100px">
                <n-form-item label="用户ID" required>
                    <n-input v-model:value="userForm.userId" placeholder="QQ号" :disabled="editMode" />
                </n-form-item>
                <n-form-item label="自定义Prompt">
                    <n-input v-model:value="userForm.systemPrompt" type="textarea" :rows="6" placeholder="为该用户设置专属的系统提示词..." />
                </n-form-item>
                <n-form-item label="使用预设">
                    <n-select v-model:value="userForm.presetId" :options="presetOptions" placeholder="选择预设（可选）" clearable />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="showUserModal = false">取消</n-button>
                    <n-button type="primary" @click="saveUser">保存</n-button>
                </n-space>
            </template>
        </n-modal>
        
        <!-- 群组人格模态框 -->
        <n-modal v-model:show="showGroupModal" preset="card" :title="editMode ? '编辑群组人格' : '添加群组人格'" style="width: 600px;">
            <n-form :model="groupForm" label-placement="left" label-width="100px">
                <n-form-item label="群组ID" required>
                    <n-input v-model:value="groupForm.groupId" placeholder="群号" :disabled="editMode" />
                </n-form-item>
                <n-form-item label="自定义Prompt">
                    <n-input v-model:value="groupForm.systemPrompt" type="textarea" :rows="6" placeholder="为该群组设置专属的系统提示词..." />
                </n-form-item>
                <n-form-item label="使用预设">
                    <n-select v-model:value="groupForm.presetId" :options="presetOptions" placeholder="选择预设（可选）" clearable />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="showGroupModal = false">取消</n-button>
                    <n-button type="primary" @click="saveGroup">保存</n-button>
                </n-space>
            </template>
        </n-modal>
        
        <!-- 群内用户人格模态框 -->
        <n-modal v-model:show="showGroupUserModal" preset="card" :title="editMode ? '编辑群内用户人格' : '添加群内用户人格'" style="width: 600px;">
            <n-form :model="groupUserForm" label-placement="left" label-width="100px">
                <n-form-item label="群组ID" required>
                    <n-input v-model:value="groupUserForm.groupId" placeholder="群号" :disabled="editMode" />
                </n-form-item>
                <n-form-item label="用户ID" required>
                    <n-input v-model:value="groupUserForm.userId" placeholder="QQ号" :disabled="editMode" />
                </n-form-item>
                <n-form-item label="自定义Prompt">
                    <n-input v-model:value="groupUserForm.systemPrompt" type="textarea" :rows="6" placeholder="为该群内的特定用户设置专属的系统提示词..." />
                </n-form-item>
                <n-form-item label="使用预设">
                    <n-select v-model:value="groupUserForm.presetId" :options="presetOptions" placeholder="选择预设（可选）" clearable />
                </n-form-item>
            </n-form>
            <template #footer>
                <n-space justify="end">
                    <n-button @click="showGroupUserModal = false">取消</n-button>
                    <n-button type="primary" @click="saveGroupUser">保存</n-button>
                </n-space>
            </template>
        </n-modal>
    </div>
</template>
