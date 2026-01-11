# Implementation Plan: MCP Configuration Fix

## Overview

本实现计划修复MCP配置管理的多个问题，包括配置文件自动创建、HTTP/SSE服务器支持、API字段完整性和Bot对象获取优先级。

## Tasks

- [x] 1. 修复McpManager配置文件自动创建
  - [x] 1.1 修改loadServersConfig方法，在文件不存在时自动创建
    - 确保目录存在
    - 创建默认配置文件 `{ "servers": {} }`
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ]* 1.2 编写配置文件创建的属性测试
    - **Property 1: 配置文件自动创建**
    - **Validates: Requirements 1.1, 1.2**

- [x] 2. 修复mcpRoutes API支持所有服务器类型
  - [x] 2.1 修改POST /servers路由支持完整配置
    - 接受config对象包含type, command, args, url, package, env, headers
    - 根据type验证必需字段
    - 使用McpManager.addServer而不是直接操作config
    - _Requirements: 3.1, 3.3_
  - [x] 2.2 修改PUT /servers/:name路由支持完整配置更新
    - 使用McpManager.updateServer
    - _Requirements: 3.2_
  - [x] 2.3 修改DELETE /servers/:name路由使用McpManager
    - 使用McpManager.removeServer
    - _Requirements: 3.3_
  - [x] 2.4 修改POST /import路由支持所有服务器类型
    - 使用McpManager.addServer批量添加
    - _Requirements: 3.4_
  - [ ]* 2.5 编写API配置字段完整性的属性测试
    - **Property 2: API配置字段完整性**
    - **Validates: Requirements 3.1, 3.2, 3.4**

- [x] 3. 确保配置存储一致性
  - [x] 3.1 移除mcpRoutes中对config.get/set('mcpServers')的直接调用
    - 所有操作通过McpManager进行
    - _Requirements: 4.1, 4.2_
  - [ ]* 3.2 编写配置存储一致性的属性测试
    - **Property 3: 配置存储一致性**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 4. 修复ToolContext Bot对象获取优先级
  - [x] 4.1 修改ToolContext.getBot方法
    - 优先返回this.event?.bot
    - 其次返回this.bot
    - 最后fallback到全局Bot
    - _Requirements: 6.2, 6.4_
  - [x] 4.2 修改ToolContext.getAdapter方法
    - 优先从event.bot获取Bot对象进行适配器检测
    - _Requirements: 6.1, 6.3_
  - [ ]* 4.3 编写Bot对象获取优先级的属性测试
    - **Property 4: Bot对象获取优先级**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [x] 5. Checkpoint - 确保所有测试通过
  - 运行所有测试，确保修改没有破坏现有功能
  - 如有问题，询问用户

- [x] 6. 验证HTTP/SSE服务器连接功能
  - [x] 6.1 验证McpClient.connectSSE方法正常工作
    - 确保EventSource连接正确建立
    - 确保sendSSERequest正确发送JSON-RPC请求
    - _Requirements: 2.1, 2.3_
  - [x] 6.2 验证McpClient.connectHTTP方法正常工作
    - 确保URL和headers正确存储
    - 确保httpRequest正确发送JSON-RPC请求
    - _Requirements: 2.2, 2.4_
  - [ ]* 6.3 编写服务器状态返回完整性的属性测试
    - **Property 5: 服务器状态返回完整性**
    - **Validates: Requirements 5.3**

- [x] 7. 支持transport嵌套配置格式
  - [x] 7.1 添加normalizeServerConfig方法
    - 支持 `{ transport: { type: 'http', url: '...' } }` 格式
    - 自动提取transport内的配置
    - _Requirements: 2.2, 2.4_
  - [x] 7.2 修改connectServer使用规范化配置
    - 在连接前规范化配置格式
    - _Requirements: 2.2, 2.4_
  - [x] 7.3 修复HTTP类型初始化
    - HTTP类型也调用initialize获取服务器能力和工具列表
    - HTTP类型不需要心跳（无状态）
    - _Requirements: 2.2, 2.4_

- [x] 8. Final Checkpoint - 确保所有测试通过
  - 运行完整测试套件
  - 如有问题，询问用户

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
