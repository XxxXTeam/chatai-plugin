/**
 * 路由模块索引
 * 统一导出所有路由创建函数
 */

import { createConversationRoutes, createContextRoutes } from './conversationRoutes.js'
import { createPresetRoutes, createPresetsConfigRoutes } from './presetRoutes.js'
import channelRoutes from './channelRoutes.js'
import statsRoutes from './statsRoutes.js'
import testPanelRoutes from './testPanelRoutes.js'
import systemRoutes from './systemRoutes.js'
import configRoutes from './configRoutes.js'
import scopeRoutes from './scopeRoutes.js'
import toolsRoutes from './toolsRoutes.js'
import proxyRoutes from './proxyRoutes.js'
import mcpRoutes from './mcpRoutes.js'
import knowledgeRoutes from './knowledgeRoutes.js'
import imageRoutes from './imageRoutes.js'
import logsRoutes from './logsRoutes.js'
import memoryRoutes from './memoryRoutes.js'
import groupAdminRoutes, { generateGroupAdminLoginCode } from './groupAdminRoutes.js'
import { ChaiteResponse, ApiResponse, getDatabase, ErrorCodes } from './shared.js'

export { 
    createConversationRoutes,
    createContextRoutes,
    channelRoutes,
    statsRoutes,
    testPanelRoutes,
    systemRoutes,
    configRoutes,
    scopeRoutes,
    toolsRoutes,
    proxyRoutes,
    mcpRoutes,
    knowledgeRoutes,
    imageRoutes,
    logsRoutes,
    memoryRoutes,
    groupAdminRoutes,
    generateGroupAdminLoginCode,
    createPresetRoutes,
    createPresetsConfigRoutes,
    ChaiteResponse,
    ApiResponse,
    getDatabase,
    ErrorCodes
}
