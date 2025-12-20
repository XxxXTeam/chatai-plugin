/**
 * 示例工具模板
 * 将此文件放入 data/tools/ 目录，重启后自动加载
 */

export default {
  name: 'example_hello',
  
  function: {
    name: 'example_hello',
    description: '示例工具，向指定用户打招呼',
    parameters: {
      type: 'object',
      properties: {
        name: { 
          type: 'string', 
          description: '要打招呼的人名' 
        },
        greeting: { 
          type: 'string', 
          description: '问候语，如"你好"、"早上好"' 
        }
      },
      required: ['name']
    }
  },

  async run(args, context) {
    const { name, greeting = '你好' } = args
    
    // 获取当前事件和机器人
    const e = context.getEvent()
    const bot = context.getBot()
    
    // 可以获取发送者信息
    const senderId = e?.sender?.user_id || e?.user_id
    const senderName = e?.sender?.nickname || '用户'
    
    // 返回结果给 AI
    return {
      success: true,
      message: `${greeting}，${name}！`,
      sender: senderName,
      sender_id: senderId
    }
  }
}
