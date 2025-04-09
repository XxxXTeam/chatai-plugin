import path from 'path'
import { dataDir } from '../../../../utils/common.js'
import { SQLiteChannelStorage } from './channel_storage.js'
import { LowDBChannelStorage } from '../lowdb/channel_storage.js'
import { SQLiteChatPresetStorage } from './chat_preset_storage.js'
import { LowDBChatPresetsStorage } from '../lowdb/chat_preset_storage.js'
import { SQLiteToolsStorage } from './tools_storage.js'
import { LowDBToolsStorage } from '../lowdb/tools_storage.js'
import { SQLiteProcessorsStorage } from './processors_storage.js'
import { LowDBProcessorsStorage } from '../lowdb/processors_storage.js'
import { SQLiteUserStateStorage } from './user_state_storage.js'
import { LowDBUserStateStorage } from '../lowdb/user_state_storage.js'
import fs from 'fs'

export async function checkMigrate () {
  logger.debug('检查是否需要从 LowDB 迁移数据到 SQLite...')

  try {
    // 导入所需的模块
    const { default: ChatGPTStorage } = await import('../lowdb/storage.js')
    await ChatGPTStorage.init()
    const { ChatGPTHistoryStorage } = await import('../lowdb/storage.js')
    await ChatGPTHistoryStorage.init()

    const dbPath = path.join(dataDir, 'data.db')

    // 定义要检查的存储对
    const storagePairs = [
      {
        name: '渠道',
        lowdbStorageClass: LowDBChannelStorage,
        sqliteStorageClass: SQLiteChannelStorage,
        collection: 'channel'
      },
      {
        name: '预设',
        lowdbStorageClass: LowDBChatPresetsStorage,
        sqliteStorageClass: SQLiteChatPresetStorage,
        collection: 'chat_presets'
      },
      {
        name: '工具',
        lowdbStorageClass: LowDBToolsStorage,
        sqliteStorageClass: SQLiteToolsStorage,
        collection: 'tools'
      },
      {
        name: '处理器',
        lowdbStorageClass: LowDBProcessorsStorage,
        sqliteStorageClass: SQLiteProcessorsStorage,
        collection: 'processors'
      },
      {
        name: '用户状态',
        lowdbStorageClass: LowDBUserStateStorage,
        sqliteStorageClass: SQLiteUserStateStorage,
        collection: 'userState',
        isSpecial: true
      }
    ]

    // 检查是否有任何数据需要迁移
    const needMigrate = await Promise.all(storagePairs.map(async pair => {
      if (pair.isSpecial) {
        // 用户状态特殊处理
        const collection = ChatGPTStorage.collection(pair.collection)
        const items = await collection.findAll()
        return items.length > 0
      } else {
        // 标准集合处理
        const collection = ChatGPTStorage.collection(pair.collection)
        const items = await collection.findAll()
        return items.length > 0
      }
    })).then(results => results.some(result => result))

    if (!needMigrate) {
      logger.debug('LowDB 存储为空，无需迁移')
      return
    }

    // 检查 SQLite 中是否已有数据
    const testStorage = new SQLiteChannelStorage(dbPath)
    await testStorage.initialize()
    const channels = await testStorage.listItems()

    if (channels.length > 0) {
      logger.debug('SQLite 存储已有数据，跳过迁移')
      await testStorage.close()
      return
    }
    await testStorage.close()

    logger.info('开始从 LowDB 迁移数据到 SQLite...')

    // 迁移每种数据
    for (const pair of storagePairs) {
      const collection = ChatGPTStorage.collection(pair.collection)
      const items = await collection.findAll()

      if (items.length > 0) {
        logger.info(`迁移${pair.name}数据...`)
        // eslint-disable-next-line new-cap
        const sqliteStorage = new pair.sqliteStorageClass(dbPath)
        await sqliteStorage.initialize()

        for (const item of items) {
          await sqliteStorage.setItem(item.id, item)
        }

        logger.info(`迁移了 ${items.length} 个${pair.name}`)
        await sqliteStorage.close()
      }
    }

    // 迁移完成后，备份并清空 LowDB 数据
    const backupDir = path.join(dataDir, 'backup')
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    // 备份并清空��数据
    if (fs.existsSync(ChatGPTStorage.filePath)) {
      fs.copyFileSync(
        ChatGPTStorage.filePath,
        path.join(backupDir, `storage-backup-${timestamp}.json`)
      )
      // 清空数据但保留文件结构
      for (const pair of storagePairs) {
        if (!pair.collection) continue
        await ChatGPTStorage.collection(pair.collection).deleteAll()
      }
    }

    // 备份并清空历史数据
    if (fs.existsSync(ChatGPTHistoryStorage.filePath)) {
      fs.copyFileSync(
        ChatGPTHistoryStorage.filePath,
        path.join(backupDir, `history-backup-${timestamp}.json`)
      )
      // 清空历史数据
      for (const collectionName of ChatGPTHistoryStorage.listCollections()) {
        await ChatGPTHistoryStorage.collection(collectionName).deleteAll()
      }
    }

    logger.debug(`迁移完成，原数据已备份至 ${backupDir} 目录`)
  } catch (error) {
    logger.error('数据迁移过程中发生错误:', error)
  }
}
