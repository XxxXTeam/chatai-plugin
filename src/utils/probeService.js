import config from '../../config/config.js'

const defaultServer = () => config.get('features.probe.serverUrl') || process.env.PROBE_SERVER || 'http://127.0.0.1:8080'

async function request(path, options = {}) {
    const url = `${defaultServer()}${path}`
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    })
    if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
    }
    const text = await res.text()
    try {
        return text ? JSON.parse(text) : {}
    } catch {
        return {}
    }
}

export const probeService = {
    async createTask() {
        return request('/api/probe/tasks', { method: 'POST' })
    },
    async getTask(taskId) {
        return request(`/api/probe/tasks/${taskId}`, { method: 'GET' })
    },
    async stopTask(taskId) {
        return request(`/api/probe/tasks/${taskId}/stop`, { method: 'POST' })
    },
    async queryIPLocations(ips = []) {
        return request('/api/probe/geo', {
            method: 'POST',
            body: JSON.stringify({ ips })
        }).then(res => res.results || [])
    },
    subscribeTask(taskId, onHit = () => {}, onStop = () => {}, interval = 4000) {
        let stopped = false
        let lastCount = 0

        const tick = async () => {
            if (stopped) return
            try {
                const status = await probeService.getTask(taskId)
                const hits = status.ips || []
                for (let i = lastCount; i < hits.length; i++) {
                    onHit(hits[i])
                }
                lastCount = hits.length
                if (status.active === false) {
                    stopped = true
                    onStop(hits)
                    return
                }
            } catch (err) {
                // swallow errors; retry next round
            }
            setTimeout(tick, interval)
        }
        tick()

        return () => { stopped = true }
    },
    maskIP(ip) {
        if (!ip) return ''
        if (ip.includes(':')) {
            // IPv6
            const parts = ip.split(':')
            return parts.slice(0, 2).join(':') + '::' + parts.slice(-1)
        }
        const parts = ip.split('.')
        if (parts.length !== 4) return ip
        return `${parts[0]}.${parts[1]}.***.${parts[3]}`
    },
    async reportStats(_event) {
        // lightweight placeholder for future metrics
        return { count: 0 }
    }
}

export default probeService
