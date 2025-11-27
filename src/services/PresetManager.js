import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.join(__dirname, '../../data')
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json')

export class PresetManager {
    constructor() {
        this.presets = new Map()
        this.initialized = false
    }

    async init() {
        if (this.initialized) return

        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true })
        }

        await this.loadPresets()
        this.initialized = true
    }

    async loadPresets() {
        try {
            if (fs.existsSync(PRESETS_FILE)) {
                const data = fs.readFileSync(PRESETS_FILE, 'utf-8')
                const presets = JSON.parse(data)
                this.presets.clear()
                presets.forEach(p => this.presets.set(p.id, p))
            }
        } catch (err) {
            console.error('[PresetManager] Failed to load presets:', err)
        }

        // Ensure default preset exists
        if (!this.presets.has('default')) {
            this.presets.set('default', {
                id: 'default',
                name: '默认预设',
                description: '通用助手预设',
                systemPrompt: '你是一个有帮助的AI助手。',
                model: '', // Use system default
                temperature: 0.7
            })
            await this.savePresets()
        }
    }

    async savePresets() {
        try {
            const data = JSON.stringify(Array.from(this.presets.values()), null, 2)
            fs.writeFileSync(PRESETS_FILE, data, 'utf-8')
        } catch (err) {
            console.error('[PresetManager] Failed to save presets:', err)
        }
    }

    getAll() {
        return Array.from(this.presets.values())
    }

    get(id) {
        return this.presets.get(id)
    }

    async create(data) {
        const id = crypto.randomUUID()
        const preset = {
            id,
            name: data.name || '未命名预设',
            description: data.description || '',
            systemPrompt: data.systemPrompt || '',
            model: data.model || '',
            temperature: data.temperature || 0.7,
            ...data
        }
        this.presets.set(id, preset)
        await this.savePresets()
        return preset
    }

    async update(id, data) {
        if (!this.presets.has(id)) {
            throw new Error(`Preset not found: ${id}`)
        }
        const preset = this.presets.get(id)
        const updated = { ...preset, ...data, id } // Ensure ID doesn't change
        this.presets.set(id, updated)
        await this.savePresets()
        return updated
    }

    async delete(id) {
        if (id === 'default') {
            throw new Error('Cannot delete default preset')
        }
        if (this.presets.delete(id)) {
            await this.savePresets()
            return true
        }
        return false
    }
}

export const presetManager = new PresetManager()
