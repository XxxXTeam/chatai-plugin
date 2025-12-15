/**
 * 基础工具
 * 包含时间获取、工具列表等基础功能
 */

export const basicTools = [
    {
        name: 'get_current_time',
        description: '获取当前时间和日期信息',
        inputSchema: {
            type: 'object',
            properties: {
                format: { 
                    type: 'string', 
                    description: '时间格式：full(完整)、date(仅日期)、time(仅时间)、timestamp(时间戳)',
                    enum: ['full', 'date', 'time', 'timestamp']
                },
                timezone: {
                    type: 'string',
                    description: '时区，默认 Asia/Shanghai'
                }
            }
        },
        handler: async (args) => {
            const now = new Date()
            const tz = args.timezone || 'Asia/Shanghai'
            const format = args.format || 'full'
            
            const options = { timeZone: tz }
            const dateStr = now.toLocaleDateString('zh-CN', { ...options, year: 'numeric', month: '2-digit', day: '2-digit' })
            const timeStr = now.toLocaleTimeString('zh-CN', { ...options, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
            const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
            
            let result
            switch (format) {
                case 'date':
                    result = dateStr
                    break
                case 'time':
                    result = timeStr
                    break
                case 'timestamp':
                    result = now.getTime().toString()
                    break
                default:
                    result = `${dateStr} ${timeStr} 星期${weekday}`
            }
            
            return {
                text: `当前时间: ${result}`,
                datetime: now.toISOString(),
                timestamp: now.getTime(),
                formatted: result,
                timezone: tz,
                weekday: `星期${weekday}`
            }
        }
    }
]
