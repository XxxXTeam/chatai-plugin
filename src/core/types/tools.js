/**
 * @typedef {import('./models').ArgumentValue} ArgumentValue
 * @typedef {import('./common').ChaiteContext} ChaiteContext
 */

// AbstractShareable needs to be imported or mocked if it's from cloud.ts
// For now, I'll assume it's available or I'll create a simple base class if needed.
// Checking imports: import { AbstractShareable } from './cloud'
// I need to port cloud.ts as well or stub it.

/**
 * @typedef {Object} Function
 * @property {string} name
 * @property {string} description
 * @property {Parameter} parameters
 */

/**
 * @typedef {Object} Parameter
 * @property {'object'} type
 * @property {Record<string, Property>} properties
 * @property {string[]} required
 */

/**
 * @typedef {Object} Property
 * @property {'string' | 'number' | 'boolean' | 'array' | 'object'} type
 * @property {string | null} description
 */

/**
 * @typedef {Object} Tool
 * @property {string} name
 * @property {'function'} type
 * @property {Function} function
 * @property {(args: Record<string, ArgumentValue | Record<string, ArgumentValue>>, chaiteContext?: ChaiteContext) => Promise<string>} run
 */

// Placeholder for AbstractShareable until cloud.js is ported
class AbstractShareable {
    constructor(params) {
        Object.assign(this, params)
    }
}

export class ToolDTO extends AbstractShareable {
    constructor(params) {
        super(params)
        this.modelType = 'executable'
        this.permission = params.permission || 'private'
        this.status = params.status || 'enabled'
    }

    /**
     * @param {boolean} [_verbose]
     * @returns {string}
     */
    toFormatedString(_verbose) {
        let base = `ID: ${this.id}\n工具名称：${this.name}`

        if (this.description) {
            base += `\n工具描述：${this.description}`
        }

        if (this.permission) {
            base += `\n权限：${this.permission}`
        }

        if (this.createdAt) {
            base += `\n创建时间：${this.createdAt}`
        }

        if (this.updatedAt) {
            base += `\n最后更新时间：${this.updatedAt}`
        }

        if (this.uploader?.username) {
            base += `\n上传者：@${this.uploader.username}`
        }

        return base.trimEnd()
    }

    /**
     * @param {string} str
     * @returns {ToolDTO}
     */
    fromString(str) {
        return new ToolDTO(JSON.parse(str))
    }
}

/**
 * @typedef {Object} ToolsGroup
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} toolIds
 * @property {boolean} [isDefault]
 */

export class ToolsGroupDTO extends AbstractShareable {
    constructor(params) {
        super(params)
        this.modelType = 'settings'
    }

    /**
     * @param {boolean} [_verbose]
     * @returns {string}
     */
    toFormatedString(_verbose) {
        let base = `工具组名称：${this.name}`

        if (this.description) {
            base += `\n工具组描述：${this.description}`
        }

        if (this.createdAt) {
            base += `\n创建时间：${this.createdAt}`
        }

        if (this.updatedAt) {
            base += `\n最后更新时间：${this.updatedAt}`
        }

        if (this.uploader?.username) {
            base += `\n上传者：@${this.uploader.username}`
        }

        return base.trimEnd()
    }
}

export class CustomTool {
    constructor() {
        if (!this.name) {
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
     * @param {Record<string, ArgumentValue | Record<string, ArgumentValue>>} _args
     * @param {ChaiteContext} [_context]
     * @returns {Promise<string>}
     */
    async run(_args, _context) {
        throw new Error('Not implemented')
    }
}
