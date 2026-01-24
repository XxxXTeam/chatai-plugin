'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { GroupFormState, GroupConfig, IndependentChannel } from '@/lib/types'
import { apiToForm, formToApi, getDefaultForm } from '@/lib/group-utils'

interface UseGroupFormOptions {
    groupId?: string
    mode?: 'admin' | 'global'
    onSaveSuccess?: () => void
}

interface UseGroupFormReturn {
    form: GroupFormState
    setForm: (updates: Partial<GroupFormState>) => void
    loading: boolean
    saving: boolean
    error: string | null
    loadData: () => Promise<void>
    saveData: () => Promise<boolean>
    resetForm: () => void
    isModified: boolean
    // 预设和渠道数据
    presets: { id: string; name: string; description?: string }[]
    channels: { id: string; name: string; provider?: string }[]
    knowledgeBases: { id: string; name: string }[]
    // 表情包统计
    emojiStats: { total: number; images: { name: string; url: string }[] } | null
}

/**
 * 群组表单状态管理 Hook
 * 提供统一的表单状态、数据加载、保存、验证功能
 */
export function useGroupForm(options: UseGroupFormOptions = {}): UseGroupFormReturn {
    const { groupId, mode = 'global', onSaveSuccess } = options

    const [form, setFormState] = useState<GroupFormState>(getDefaultForm())
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // 辅助数据
    const [presets, setPresets] = useState<{ id: string; name: string; description?: string }[]>([])
    const [channels, setChannels] = useState<{ id: string; name: string; provider?: string }[]>([])
    const [knowledgeBases, setKnowledgeBases] = useState<{ id: string; name: string }[]>([])
    const [emojiStats, setEmojiStats] = useState<{ total: number; images: { name: string; url: string }[] } | null>(null)

    // 用于检测修改
    const initialFormRef = useRef<string>('')
    const [isModified, setIsModified] = useState(false)

    // 更新表单
    const setForm = useCallback((updates: Partial<GroupFormState>) => {
        setFormState(prev => {
            const newForm = { ...prev, ...updates }
            // 检测是否有修改
            setIsModified(JSON.stringify(newForm) !== initialFormRef.current)
            return newForm
        })
    }, [])

    // 加载数据
    const loadData = useCallback(async () => {
        if (!groupId) return

        setLoading(true)
        setError(null)

        try {
            const apiBase = mode === 'admin' ? '/api/group-admin' : `/api/scope/group/${groupId}`
            const response = await fetch(mode === 'admin' ? `${apiBase}/config` : apiBase, {
                credentials: 'include'
            })

            if (!response.ok) {
                throw new Error(`加载失败: ${response.status}`)
            }

            const data: GroupConfig = await response.json()

            // 转换为表单状态
            const formState = apiToForm(data)
            setFormState(formState)
            initialFormRef.current = JSON.stringify(formState)
            setIsModified(false)

            // 设置辅助数据
            if (data.presets) setPresets(data.presets)
            if (data.channels) setChannels(data.channels)
            if (data.knowledgeBases) setKnowledgeBases(data.knowledgeBases)
            if (data.emojiStats) setEmojiStats(data.emojiStats)
        } catch (err) {
            const message = err instanceof Error ? err.message : '加载配置失败'
            setError(message)
            toast.error(message)
        } finally {
            setLoading(false)
        }
    }, [groupId, mode])

    // 保存数据
    const saveData = useCallback(async (): Promise<boolean> => {
        if (!groupId) return false

        setSaving(true)
        setError(null)

        try {
            // 转换为 API 格式
            const apiData = formToApi(form)

            const apiBase = mode === 'admin' ? '/api/group-admin' : `/api/scope/group/${groupId}`
            const response = await fetch(mode === 'admin' ? `${apiBase}/config` : apiBase, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(apiData)
            })

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}))
                throw new Error(errData.message || `保存失败: ${response.status}`)
            }

            // 更新初始状态
            initialFormRef.current = JSON.stringify(form)
            setIsModified(false)

            toast.success('保存成功')
            onSaveSuccess?.()
            return true
        } catch (err) {
            const message = err instanceof Error ? err.message : '保存配置失败'
            setError(message)
            toast.error(message)
            return false
        } finally {
            setSaving(false)
        }
    }, [groupId, form, mode, onSaveSuccess])

    // 重置表单
    const resetForm = useCallback(() => {
        if (initialFormRef.current) {
            try {
                const initialForm = JSON.parse(initialFormRef.current)
                setFormState(initialForm)
                setIsModified(false)
            } catch {
                setFormState(getDefaultForm())
            }
        } else {
            setFormState(getDefaultForm())
        }
    }, [])

    // 初始加载
    useEffect(() => {
        if (groupId) {
            loadData()
        }
    }, [groupId, loadData])

    return {
        form,
        setForm,
        loading,
        saving,
        error,
        loadData,
        saveData,
        resetForm,
        isModified,
        presets,
        channels,
        knowledgeBases,
        emojiStats
    }
}

/**
 * 独立渠道管理 Hook
 */
export function useChannelManager(
    channels: IndependentChannel[],
    setChannels: (channels: IndependentChannel[]) => void
) {
    const [testingChannel, setTestingChannel] = useState<string | null>(null)

    // 添加渠道
    const addChannel = useCallback((channel: IndependentChannel) => {
        setChannels([...channels, channel])
    }, [channels, setChannels])

    // 更新渠道
    const updateChannel = useCallback((index: number, updates: Partial<IndependentChannel>) => {
        const newChannels = [...channels]
        newChannels[index] = { ...newChannels[index], ...updates }
        setChannels(newChannels)
    }, [channels, setChannels])

    // 删除渠道
    const deleteChannel = useCallback((index: number) => {
        const newChannels = channels.filter((_, i) => i !== index)
        setChannels(newChannels)
    }, [channels, setChannels])

    // 获取模型列表
    const fetchModels = useCallback(async (channel: Partial<IndependentChannel>): Promise<string[]> => {
        if (!channel.baseUrl || !channel.apiKey) {
            return []
        }

        try {
            const response = await fetch('/api/channels/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    baseUrl: channel.baseUrl,
                    apiKey: channel.apiKey,
                    adapterType: channel.adapterType || 'openai',
                    modelsPath: channel.modelsPath
                })
            })

            if (!response.ok) {
                throw new Error('获取模型列表失败')
            }

            const data = await response.json()
            return data.models || []
        } catch (err) {
            toast.error('获取模型列表失败')
            return []
        }
    }, [])

    // 测试渠道
    const testChannel = useCallback(async (channel: IndependentChannel): Promise<boolean> => {
        if (!channel.baseUrl || !channel.apiKey) {
            toast.error('请填写 BaseUrl 和 ApiKey')
            return false
        }

        setTestingChannel(channel.id)

        try {
            const response = await fetch('/api/channels/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    baseUrl: channel.baseUrl,
                    apiKey: channel.apiKey,
                    adapterType: channel.adapterType || 'openai'
                })
            })

            const data = await response.json()

            if (data.success) {
                toast.success('连接测试成功')
                return true
            } else {
                toast.error(data.message || '连接测试失败')
                return false
            }
        } catch (err) {
            toast.error('连接测试失败')
            return false
        } finally {
            setTestingChannel(null)
        }
    }, [])

    // 移动渠道顺序
    const moveChannel = useCallback((fromIndex: number, toIndex: number) => {
        const newChannels = [...channels]
        const [removed] = newChannels.splice(fromIndex, 1)
        newChannels.splice(toIndex, 0, removed)
        // 更新优先级
        newChannels.forEach((ch, i) => {
            ch.priority = i
        })
        setChannels(newChannels)
    }, [channels, setChannels])

    return {
        channels,
        addChannel,
        updateChannel,
        deleteChannel,
        fetchModels,
        testChannel,
        moveChannel,
        testingChannel
    }
}

export default useGroupForm
