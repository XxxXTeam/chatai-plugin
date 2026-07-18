/**
 * 温度解析模块
 * 统一所有聊天入口（ChatService / ChatAgent / 渠道测试 / 批量测试）的温度优先级，
 * 支持「禁用温度传递」与「渠道/模型级温度覆盖」。
 *
 * 配置结构（位于渠道 overrides 节点）：
 *   overrides:
 *     disableTemperature: false     # true → 该渠道不传 temperature（覆盖一切）
 *     temperature: 0.6              # 强制传该值
 *     modelTemperatures:            # 单模型覆盖（优先于渠道级）
 *       kimi-k2.7-code-highspeed:
 *         disableTemperature: true  # 该模型不传 temperature
 *         temperature: 0.6          # 该模型强制传该值
 *
 * 解析优先级（从高到低）：
 *   1. overrides.modelTemperatures[actualModel]  模型级覆盖
 *   2. overrides.disableTemperature / temperature 渠道级覆盖
 *   3. requestOptions.temperature                调用方覆盖（game / bym / 总结等）
 *   4. channel.advanced.llm.temperature          渠道默认
 *   5. preset.modelParams.temperature            预设
 *   6. 0.7                                       全局默认
 *
 * 其他 LLM 参数（topP / maxTokens）同样遵循「渠道 > 预设」，
 * 由 ChatService / ChatAgent 在构建 requestOptions 时直接使用 ?? 实现。
 *
 * 禁用语义：当某层 disableTemperature=true 时，立即停止解析并返回 undefined，
 * 适配器层会在发送请求体前删除 undefined 字段，从而实现「不传温度」。
 *
 * @module TemperatureResolver
 */

/**
 * 取首个有限数值
 * @param {...*} values - 候选值
 * @returns {number|undefined} 有限数值或 undefined
 */
function finiteNumber(...values) {
    for (const value of values) {
        if (value === undefined || value === null) continue
        const numericValue = Number(value)
        if (Number.isFinite(numericValue)) return numericValue
    }
    return undefined
}

/**
 * 解析某层温度覆盖的判定结果
 * @param {Object} layer - 该层覆盖配置
 * @returns {{disabled: boolean, temperature: number|undefined}}
 */
function resolveOverrideLayer(layer) {
    if (!layer || typeof layer !== 'object') {
        return { disabled: false, temperature: undefined }
    }
    return {
        disabled: layer.disableTemperature === true,
        temperature: finiteNumber(layer.temperature)
    }
}

/**
 * 统一解析最终请求温度
 * @param {Object} params - 解析参数
 * @param {string} [params.actualModel=''] - 映射后的实际模型名
 * @param {Object} [params.requestOptions={}] - 调用方传入的请求选项
 * @param {Object} [params.preset=null] - 当前预设对象
 * @param {Object} [params.channel=null] - 当前渠道对象
 * @returns {{temperature: number|undefined, source: string}} 解析结果；
 *   temperature 为 undefined 表示不传温度，source 为来源标签（用于日志）
 */
export function resolveTemperature({ actualModel = '', requestOptions = {}, preset = null, channel = null } = {}) {
    const overrides = channel?.overrides || {}

    // 1. 模型级覆盖（最高优先级）
    const modelTemperatures = overrides.modelTemperatures
    if (modelTemperatures && typeof modelTemperatures === 'object') {
        const modelLayer = resolveOverrideLayer(modelTemperatures[actualModel])
        if (modelLayer.disabled) return { temperature: undefined, source: '模型禁用' }
        if (modelLayer.temperature !== undefined) return { temperature: modelLayer.temperature, source: '模型覆盖' }
    }

    // 2. 渠道级覆盖（禁用 / 固定值）
    const channelLayer = resolveOverrideLayer(overrides)
    if (channelLayer.disabled) return { temperature: undefined, source: '渠道禁用' }
    if (channelLayer.temperature !== undefined) return { temperature: channelLayer.temperature, source: '渠道覆盖' }

    // 3. 调用方覆盖（game / bym / 总结等场景）
    const callerTemperature = finiteNumber(requestOptions.temperature)
    if (callerTemperature !== undefined) return { temperature: callerTemperature, source: '调用方' }

    // 4. 渠道默认
    const channelDefaultTemperature = finiteNumber(channel?.advanced?.llm?.temperature)
    if (channelDefaultTemperature !== undefined) return { temperature: channelDefaultTemperature, source: '渠道' }

    // 5. 预设
    const presetTemperature = finiteNumber(preset?.modelParams?.temperature)
    if (presetTemperature !== undefined) return { temperature: presetTemperature, source: '预设' }

    // 6. 全局默认
    return { temperature: 0.7, source: '默认' }
}

/**
 * 从 LLM client 实例解析温度（便捷方法）
 * 供绕过 ChatService 的辅助调用（记忆、总结、Agent dispatch 等）使用，
 * 使其尊重渠道 disableTemperature / overrides.temperature 配置。
 * @param {Object} client - LlmService.getChatClient() 返回的客户端实例
 * @param {number} [defaultTemperature] - 调用方期望的默认温度（作为 requestOptions.temperature 参与优先级）
 * @returns {number|undefined} 最终温度；undefined 表示不传
 */
export function resolveClientTemperature(client, defaultTemperature) {
    const channelInfo = client?._channelInfo || {}
    const { temperature } = resolveTemperature({
        actualModel: channelInfo.model || '',
        requestOptions: { temperature: defaultTemperature },
        channel: {
            overrides: channelInfo.overrides,
            advanced: { llm: channelInfo.llm }
        }
    })
    return temperature
}
