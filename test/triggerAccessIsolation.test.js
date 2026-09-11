import test from 'node:test'
import assert from 'node:assert/strict'

import { migrateTriggerAccessLists } from '../config/config.js'
import { checkTriggerAccess } from '../src/utils/platformAdapter.js'

test('旧版顶层名单迁移为互相独立的私聊和群聊名单', () => {
    const loadedConfig = {
        trigger: {
            private: { enabled: true },
            group: { enabled: true },
            blacklistUsers: ['10001'],
            whitelistUsers: ['10002'],
            blacklistGroups: ['20001'],
            whitelistGroups: ['20002']
        }
    }

    migrateTriggerAccessLists(loadedConfig)

    assert.deepEqual(loadedConfig.trigger.private.blacklistUsers, ['10001'])
    assert.deepEqual(loadedConfig.trigger.private.whitelistUsers, ['10002'])
    assert.deepEqual(loadedConfig.trigger.group.blacklistUsers, ['10001'])
    assert.deepEqual(loadedConfig.trigger.group.whitelistUsers, ['10002'])
    assert.deepEqual(loadedConfig.trigger.group.blacklistGroups, ['20001'])
    assert.deepEqual(loadedConfig.trigger.group.whitelistGroups, ['20002'])
    assert.notStrictEqual(loadedConfig.trigger.private.blacklistUsers, loadedConfig.trigger.group.blacklistUsers)
    assert.notStrictEqual(loadedConfig.trigger.private.whitelistUsers, loadedConfig.trigger.group.whitelistUsers)
    assert.equal(Object.hasOwn(loadedConfig.trigger, 'blacklistUsers'), false)
    assert.equal(Object.hasOwn(loadedConfig.trigger, 'whitelistUsers'), false)
    assert.equal(Object.hasOwn(loadedConfig.trigger, 'blacklistGroups'), false)
    assert.equal(Object.hasOwn(loadedConfig.trigger, 'whitelistGroups'), false)
})

test('迁移不会覆盖已经存在的新结构名单', () => {
    const loadedConfig = {
        trigger: {
            private: { whitelistUsers: ['private-user'] },
            group: { blacklistUsers: ['group-user'] },
            blacklistUsers: ['legacy-blacklist'],
            whitelistUsers: ['legacy-whitelist']
        }
    }

    migrateTriggerAccessLists(loadedConfig)

    assert.deepEqual(loadedConfig.trigger.private.whitelistUsers, ['private-user'])
    assert.deepEqual(loadedConfig.trigger.private.blacklistUsers, ['legacy-blacklist'])
    assert.deepEqual(loadedConfig.trigger.group.whitelistUsers, ['legacy-whitelist'])
    assert.deepEqual(loadedConfig.trigger.group.blacklistUsers, ['group-user'])
})

test('私聊和群聊权限只读取各自名单', () => {
    const triggerConfig = {
        private: {
            blacklistUsers: ['private-blocked'],
            whitelistUsers: ['private-allowed']
        },
        group: {
            blacklistUsers: ['group-blocked'],
            whitelistUsers: ['group-allowed'],
            blacklistGroups: ['blocked-group'],
            whitelistGroups: ['allowed-group']
        }
    }

    assert.equal(checkTriggerAccess('private-allowed', null, triggerConfig), true)
    assert.equal(checkTriggerAccess('private-blocked', null, triggerConfig), false)
    assert.equal(checkTriggerAccess('group-allowed', null, triggerConfig), false)

    assert.equal(checkTriggerAccess('group-allowed', 'allowed-group', triggerConfig), true)
    assert.equal(checkTriggerAccess('group-blocked', 'allowed-group', triggerConfig), false)
    assert.equal(checkTriggerAccess('private-allowed', 'allowed-group', triggerConfig), false)
    assert.equal(checkTriggerAccess('group-allowed', 'blocked-group', triggerConfig), false)
})
