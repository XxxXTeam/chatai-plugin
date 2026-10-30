import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_IDS = 10000
const MAX_ID_LENGTH = 256

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOrder(value) {
    return (
        Array.isArray(value) &&
        value.length <= MAX_IDS &&
        value.every(id => typeof id === 'string' && id.trim().length > 0 && id.length <= MAX_ID_LENGTH)
    )
}

function isWriteBody(body) {
    return (
        isRecord(body) &&
        isOrder(body.order) &&
        (body.revision === null || typeof body.revision === 'string') &&
        Object.keys(body).every(key => key === 'order' || key === 'revision')
    )
}

function reconcile(order, channelIds) {
    const remaining = new Set(channelIds)
    const result = []
    for (const id of order) {
        if (remaining.delete(id)) result.push(id)
    }
    return result.concat([...remaining])
}

function readState(filePath) {
    let content
    try {
        content = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
        if (error.code === 'ENOENT') return { order: null, revision: null }
        throw error
    }
    const stored = JSON.parse(content)
    if (!isRecord(stored) || !isOrder(stored.order) || typeof stored.revision !== 'string') {
        throw new Error('Invalid channel display order file')
    }
    return { order: stored.order, revision: stored.revision }
}

/** Write in the same directory so rename is atomic; never leave a partial target. */
function writeState(filePath, state) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    let created = false
    let failure
    try {
        const descriptor = fs.openSync(temporaryPath, 'wx', 0o600)
        created = true
        try {
            fs.writeFileSync(descriptor, JSON.stringify(state) + '\n', 'utf8')
        } finally {
            fs.closeSync(descriptor)
        }
        fs.renameSync(temporaryPath, filePath)
    } catch (error) {
        failure = error
    } finally {
        if (created) {
            try {
                fs.unlinkSync(temporaryPath)
            } catch (error) {
                if (error.code !== 'ENOENT') failure ||= error
            }
        }
    }
    if (failure) throw failure
}

/**
 * Only stores presentation IDs. Getters isolate configuration/channel initialization
 * from persistence; no channel update or priority/configuration save API is used.
 * @param {object} options
 * @param {() => string} options.getFilePath Backend-owned absolute storage path.
 * @param {() => Promise<string[]> | string[]} options.getChannelIds Current channel IDs.
 * @returns {import('express').Router}
 */
export function createChannelDisplayOrderRoutes({ getFilePath, getChannelIds }) {
    const router = express.Router()

    router.use((req, res, next) => {
        // The upstream ETag middleware respects explicit cache policy on res.json.
        res.set('Cache-Control', 'no-store')
        next()
    })

    function storagePath() {
        const filePath = getFilePath()
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
            throw new Error('Channel display order data directory is not initialized or absolute')
        }
        return filePath
    }

    async function currentIds() {
        const ids = await getChannelIds()
        if (!isOrder(ids)) throw new Error('Invalid current channel IDs')
        return ids
    }

    router.get('/', async (req, res) => {
        try {
            const ids = await currentIds()
            const stored = readState(storagePath())
            const data = {
                order: stored.order === null ? null : reconcile(stored.order, ids),
                revision: stored.revision
            }
            res.json({ code: 0, data, message: 'ok' })
        } catch (error) {
            res.status(500).json({ code: 5001, data: null, message: error.message })
        }
    })

    router.put('/', async (req, res) => {
        if (!isWriteBody(req.body)) {
            return res.status(400).json({ code: 1001, data: null, message: 'Invalid order or revision' })
        }
        try {
            // Finish all asynchronous work before reading the revision. The following
            // read/CAS/write/rename has no await window: one winner per Node process.
            const ids = await currentIds()
            const filePath = storagePath()
            const stored = readState(filePath)
            if (req.body.revision !== stored.revision) {
                return res.status(409).json({ code: 2003, data: null, message: 'Display order revision conflict' })
            }
            const data = { order: reconcile(req.body.order, ids), revision: randomUUID() }
            writeState(filePath, data)
            res.json({ code: 0, data, message: 'ok' })
        } catch (error) {
            res.status(500).json({ code: 5001, data: null, message: error.message })
        }
    })

    return router
}
