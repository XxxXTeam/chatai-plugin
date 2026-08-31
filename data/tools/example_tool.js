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
    
    // 业务动作统一通过标准平台接口；本示例只读取当前事件资料
    const e = context.getEvent()
    const api = context.getApi()
    const message = context.message
    
    // 可以获取发送者信息
    const senderId = e?.sender?.user_id || e?.user_id
    const senderName = e?.sender?.nickname || '用户'
    
    // api 与 message 可用于标准发送，例如：await api.reply(message.text('处理完成'))
    void api
    void message

    // 返回结果给 AI
    return {
      success: true,
      message: `${greeting}，${name}！`,
      sender: senderName,
      sender_id: senderId
    }
  }
}
