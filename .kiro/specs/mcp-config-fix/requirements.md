# Requirements Document

## Introduction

本文档定义了修复MCP（Model Context Protocol）配置管理功能的需求。当前系统存在以下问题：
1. MCP配置文件（`data/mcp-servers.json`）在首次使用时不会自动创建
2. 无法正确加载和连接已运行的HTTP接口的MCP服务器（SSE/HTTP类型）
3. 前端API与后端路由的配置字段不一致

## Glossary

- **MCP_Manager**: 负责管理所有MCP服务器连接和工具调用的核心管理器
- **MCP_Client**: 负责与单个MCP服务器通信的客户端实现
- **MCP_Routes**: 处理MCP相关HTTP API请求的路由模块
- **Config_File**: 存储MCP服务器配置的JSON文件（`data/mcp-servers.json`）
- **SSE_Server**: 使用Server-Sent Events协议的MCP服务器
- **HTTP_Server**: 使用HTTP协议的MCP服务器
- **Stdio_Server**: 使用标准输入输出的本地MCP服务器

## Requirements

### Requirement 1: 配置文件自动创建

**User Story:** As a user, I want the MCP configuration file to be automatically created when it doesn't exist, so that I can start using MCP features without manual file creation.

#### Acceptance Criteria

1. WHEN the MCP_Manager initializes and the Config_File does not exist, THE MCP_Manager SHALL create the Config_File with an empty servers object
2. WHEN the Config_File is created, THE MCP_Manager SHALL ensure the parent directory exists
3. WHEN the Config_File creation fails, THE MCP_Manager SHALL log the error and continue with an empty configuration

### Requirement 2: HTTP/SSE服务器连接支持

**User Story:** As a user, I want to connect to MCP servers running on HTTP/SSE endpoints, so that I can use remote MCP services.

#### Acceptance Criteria

1. WHEN a user adds an SSE type server with a valid URL, THE MCP_Manager SHALL establish an EventSource connection to the URL
2. WHEN a user adds an HTTP type server with a valid URL, THE MCP_Manager SHALL store the URL and headers for subsequent requests
3. WHEN connecting to an SSE server, THE MCP_Client SHALL send a POST request with JSON-RPC format for tool calls
4. WHEN connecting to an HTTP server, THE MCP_Client SHALL send POST requests with JSON-RPC format for all operations
5. IF the SSE/HTTP connection fails, THEN THE MCP_Manager SHALL record the error status and allow retry

### Requirement 3: 后端API配置字段完整性

**User Story:** As a developer, I want the backend API to support all MCP server configuration fields, so that the frontend can properly configure different types of MCP servers.

#### Acceptance Criteria

1. WHEN creating a new MCP server via API, THE MCP_Routes SHALL accept type, command, args, url, package, env, and headers fields
2. WHEN updating an MCP server via API, THE MCP_Routes SHALL update all provided configuration fields
3. THE MCP_Routes SHALL use the same Config_File as MCP_Manager for storing server configurations
4. WHEN importing MCP configuration, THE MCP_Routes SHALL support all server types (stdio, npm, sse, http)

### Requirement 4: 配置存储统一

**User Story:** As a system administrator, I want a single source of truth for MCP server configurations, so that there are no conflicts between different parts of the system.

#### Acceptance Criteria

1. THE MCP_Manager SHALL read server configurations from Config_File
2. THE MCP_Routes SHALL read and write server configurations to Config_File
3. WHEN the Config_File is modified, THE MCP_Manager SHALL be able to reload the configuration without restart
4. THE Config_File SHALL support all server types with their respective configuration fields

### Requirement 5: 连接状态管理

**User Story:** As a user, I want to see the connection status of each MCP server, so that I can troubleshoot connection issues.

#### Acceptance Criteria

1. WHEN an MCP server connects successfully, THE MCP_Manager SHALL record the connected status and timestamp
2. WHEN an MCP server connection fails, THE MCP_Manager SHALL record the error status and error message
3. WHEN a user requests server status, THE MCP_Manager SHALL return current status, type, and connection details
4. WHEN reconnecting a server, THE MCP_Manager SHALL disconnect the existing connection first if any

### Requirement 6: 工具上下文Bot对象获取修复

**User Story:** As a developer, I want the tool context to correctly obtain the Bot object from the event, so that adapter detection works correctly in all scenarios.

#### Acceptance Criteria

1. WHEN the Tool_Context getAdapter method is called, THE Tool_Context SHALL prioritize obtaining the Bot object from event.bot
2. WHEN the Tool_Context getBot method is called with an event containing a bot property, THE Tool_Context SHALL return event.bot
3. WHEN detectAdapter is called, THE detectAdapter function SHALL receive the correct Bot object associated with the current event
4. IF the event does not contain a bot property, THEN THE Tool_Context SHALL fall back to the global Bot object
