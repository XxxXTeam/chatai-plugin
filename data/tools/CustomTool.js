/**
 * 自定义工具基类
 * 用于 data/tools/ 目录下的 JS 工具继承
 */
export class CustomTool {
    constructor() {
        if (!this.name && this.function?.name) {
            this.name = this.function.name
        }
    }

    type = 'function'
    
    function = {
        name: '',
        description: '',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
        },
    }

    /**
     * 执行工具
     * @param {Object} args - 参数
     * @param {Object} context - 上下文 { getEvent(), getBot(), event, bot }
     * @returns {Promise<string|Object>}
     */
    async run(args, context) {
        throw new Error('Not implemented')
    }
}

export default CustomTool
