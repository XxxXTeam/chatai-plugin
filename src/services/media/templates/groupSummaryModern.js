/**
 * 深色现代风格群聊总结模板
 * 参考设计：深紫色渐变背景、装饰性标题、卡片式布局
 */

export function generateModernSummaryHtml(options) {
    const {
        title = '今日群聊',
        subtitle = '',
        html = '',
        messageCount = 0,
        participantCount = 0,
        topUsers = [],
        hourlyActivity = [],
        width = 520,
        topics = [], // 话题精华
        keywords = [], // 关键词云
        interactions = [], // 互动关系
        atmosphere = {}, // 群聊氛围
        quotes = [] // 精彩语录
    } = options

    const now = new Date()
    const dateStr = now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

    // 活跃时段图表
    const activityData = hourlyActivity.length === 24 ? hourlyActivity : Array(24).fill(0)
    const maxActivity = Math.max(...activityData, 1)
    const activityBars = activityData
        .map(v => {
            const height = maxActivity > 0 ? Math.max(4, Math.round((v / maxActivity) * 50)) : 4
            const opacity = v === 0 ? '0.3' : '1'
            return `<div class="bar" style="height:${height}px;opacity:${opacity}"></div>`
        })
        .join('')

    // 用户卡片 - 4列8用户
    const userCardsHtml =
        topUsers.length > 0
            ? topUsers
                  .slice(0, 8)
                  .map((u, i) => {
                      const rankBadge = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`
                      const avatarContent = u.avatar
                          ? `<img src="${u.avatar}" class="avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                          : ''
                      const initial = (u.name || '?').charAt(0).toUpperCase()
                      return `
                <div class="user-card">
                    <div class="rank-badge">${rankBadge}</div>
                    <div class="user-avatar">
                        ${avatarContent}
                        <div class="avatar-fallback" style="display:${u.avatar ? 'none' : 'flex'}">${initial}</div>
                    </div>
                    <div class="user-name">${u.name || '用户'}</div>
                    <div class="user-count">${u.count}条</div>
                </div>`
                  })
                  .join('')
            : ''

    // 话题精华卡片
    const topicIcons = ['🎮', '💬', '🎵', '📺', '🍔', '💡', '🎯', '❤️']
    const topicsHtml =
        topics.length > 0
            ? topics
                  .slice(0, 4)
                  .map(
                      (t, i) => `
            <div class="topic-card">
                <div class="topic-icon">${t.icon || topicIcons[i % topicIcons.length]}</div>
                <div class="topic-info">
                    <div class="topic-title">${t.title || '话题'}</div>
                    <div class="topic-desc">${t.desc || ''}</div>
                </div>
                <div class="topic-count">${t.count || 0}条</div>
            </div>`
                  )
                  .join('')
            : ''

    // 关键词云
    const keywordsHtml =
        keywords.length > 0
            ? keywords
                  .slice(0, 12)
                  .map((k, i) => {
                      const sizes = ['keyword-lg', 'keyword-md', 'keyword-sm']
                      const sizeClass = sizes[Math.min(Math.floor(i / 4), 2)]
                      return `<span class="keyword-tag ${sizeClass}">${k.word || k}</span>`
                  })
                  .join('')
            : ''

    // 互动关系
    const interactionsHtml =
        interactions.length > 0
            ? interactions
                  .slice(0, 3)
                  .map(
                      pair => `
            <div class="interaction-pair">
                <div class="interact-user">
                    <div class="interact-avatar">${(pair.from || '?').charAt(0)}</div>
                    <span>${pair.from || '用户A'}</span>
                </div>
                <div class="interact-arrow">
                    <span class="arrow-line"></span>
                    <span class="interact-count">${pair.count || 0}次</span>
                </div>
                <div class="interact-user">
                    <div class="interact-avatar">${(pair.to || '?').charAt(0)}</div>
                    <span>${pair.to || '用户B'}</span>
                </div>
            </div>`
                  )
                  .join('')
            : ''

    // 群聊氛围
    const atmos = atmosphere || {}
    const atmosphereHtml = `
        <div class="atmosphere-grid">
            <div class="atmos-item">
                <div class="atmos-label">积极度</div>
                <div class="atmos-bar"><div class="atmos-fill" style="width:${atmos.positivity || 75}%"></div></div>
                <div class="atmos-value">${atmos.positivity || 75}%</div>
            </div>
            <div class="atmos-item">
                <div class="atmos-label">活跃度</div>
                <div class="atmos-bar"><div class="atmos-fill active" style="width:${atmos.activity || 60}%"></div></div>
                <div class="atmos-value">${atmos.activity || 60}%</div>
            </div>
            <div class="atmos-item">
                <div class="atmos-label">互动性</div>
                <div class="atmos-bar"><div class="atmos-fill interact" style="width:${atmos.interaction || 50}%"></div></div>
                <div class="atmos-value">${atmos.interaction || 50}%</div>
            </div>
        </div>`

    // 精彩语录
    const quotesHtml =
        quotes.length > 0
            ? quotes
                  .slice(0, 3)
                  .map(
                      q => `
            <div class="quote-card">
                <div class="quote-mark">"</div>
                <div class="quote-content">${q.content || ''}</div>
                <div class="quote-author">—— ${q.author || '匿名'}</div>
            </div>`
                  )
                  .join('')
            : ''

    // 计算人均发言
    const avgMessages = messageCount && participantCount ? Math.round(messageCount / participantCount) : 0

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f0f1a 100%);
            min-height: 100vh;
            padding: 16px;
            color: #e4e4e4;
        }
        .container {
            max-width: ${width}px;
            margin: 0 auto;
            background: linear-gradient(180deg, rgba(30,30,50,0.95) 0%, rgba(20,20,35,0.98) 100%);
            border-radius: 20px;
            overflow: hidden;
            border: 1px solid rgba(100,100,150,0.2);
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        
        /* 头部 */
        .header {
            background: linear-gradient(135deg, #4a3f6b 0%, #2d2a4a 100%);
            padding: 24px 20px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .header::before {
            content: '✦ ✦ ✦';
            position: absolute;
            top: 8px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 10px;
            color: rgba(255,255,255,0.3);
            letter-spacing: 8px;
        }
        .header-title {
            font-size: 22px;
            font-weight: 800;
            color: #fff;
            margin: 8px 0;
            text-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .header-subtitle {
            font-size: 12px;
            color: rgba(255,255,255,0.7);
        }
        .header-time {
            position: absolute;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            text-align: right;
        }
        .header-date { font-size: 11px; color: rgba(255,255,255,0.6); }
        .header-clock { font-size: 20px; font-weight: 700; color: #fff; }

        /* 统计卡片 */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            padding: 16px;
            background: rgba(0,0,0,0.2);
        }
        .stat-card {
            background: linear-gradient(135deg, rgba(60,50,90,0.6) 0%, rgba(40,35,70,0.8) 100%);
            border-radius: 12px;
            padding: 12px 8px;
            text-align: center;
            border: 1px solid rgba(100,80,150,0.2);
        }
        .stat-icon { font-size: 18px; margin-bottom: 4px; }
        .stat-value { font-size: 18px; font-weight: 700; color: #fff; }
        .stat-label { font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 2px; }

        /* 话题精华 */
        .topics-section {
            padding: 16px;
        }
        .section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        }
        .section-icon {
            width: 24px;
            height: 24px;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .section-title { font-size: 13px; font-weight: 600; color: #c4b5fd; }

        /* 内容区 */
        .content {
            padding: 0 16px 16px;
        }
        .content h1, .content h2 {
            font-size: 14px;
            font-weight: 600;
            color: #a78bfa;
            margin: 16px 0 10px;
            padding: 10px 14px;
            background: linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.1) 100%);
            border-radius: 10px;
            border-left: 3px solid #8b5cf6;
        }
        .content h3 {
            font-size: 13px;
            font-weight: 600;
            color: #c4b5fd;
            margin: 12px 0 8px;
            padding-left: 12px;
            border-left: 2px solid #6366f1;
        }
        .content p {
            font-size: 12.5px;
            color: #d1d5db;
            line-height: 1.8;
            margin: 10px 0;
        }
        .content ul, .content ol { padding-left: 16px; margin: 10px 0; }
        .content li {
            font-size: 12.5px;
            color: #d1d5db;
            line-height: 1.75;
            margin: 6px 0;
        }
        .content ul { list-style: none; }
        .content ul li::before {
            content: '◆';
            color: #8b5cf6;
            font-size: 8px;
            margin-right: 8px;
        }
        .content strong { color: #a78bfa; font-weight: 600; }
        .content blockquote {
            background: rgba(99,102,241,0.1);
            border-left: 3px solid #6366f1;
            padding: 12px 16px;
            margin: 12px 0;
            border-radius: 0 10px 10px 0;
            color: #c4b5fd;
            font-size: 12px;
        }

        /* 活跃时段图表 */
        .chart-section {
            padding: 16px;
            background: rgba(0,0,0,0.15);
        }
        .chart-container {
            background: rgba(30,30,50,0.5);
            border-radius: 12px;
            padding: 14px;
            border: 1px solid rgba(100,80,150,0.15);
        }
        .chart-bars {
            display: flex;
            align-items: flex-end;
            gap: 2px;
            height: 55px;
        }
        .bar {
            flex: 1;
            background: linear-gradient(180deg, #8b5cf6 0%, #6366f1 100%);
            border-radius: 3px 3px 0 0;
            min-width: 8px;
        }
        .chart-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            font-size: 9px;
            color: rgba(255,255,255,0.4);
        }

        /* 活跃用户 - 4列布局 */
        .users-section {
            padding: 16px;
        }
        .users-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
        }
        .user-card {
            background: linear-gradient(135deg, rgba(50,45,80,0.7) 0%, rgba(35,30,60,0.9) 100%);
            border-radius: 10px;
            padding: 10px 6px;
            text-align: center;
            position: relative;
            border: 1px solid rgba(100,80,150,0.2);
        }
        .rank-badge {
            position: absolute;
            top: -5px;
            right: -3px;
            font-size: 12px;
        }
        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            margin: 0 auto 6px;
            overflow: hidden;
            border: 2px solid rgba(139,92,246,0.5);
        }
        .user-card:first-child .user-avatar { border-color: #ffd700; }
        .avatar-img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-fallback {
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 14px;
            font-weight: 600;
        }
        .user-name {
            font-size: 10px;
            color: #e4e4e4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 3px;
        }
        .user-count {
            font-size: 9px;
            color: #a78bfa;
            background: rgba(139,92,246,0.2);
            padding: 2px 6px;
            border-radius: 6px;
            display: inline-block;
        }

        /* 话题精华 */
        .topics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        .topic-card {
            background: linear-gradient(135deg, rgba(50,45,80,0.6) 0%, rgba(35,30,60,0.8) 100%);
            border-radius: 10px;
            padding: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid rgba(100,80,150,0.15);
        }
        .topic-icon {
            font-size: 20px;
            width: 36px;
            height: 36px;
            background: rgba(99,102,241,0.2);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .topic-info { flex: 1; min-width: 0; }
        .topic-title { font-size: 12px; font-weight: 600; color: #e4e4e4; }
        .topic-desc { font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .topic-count { font-size: 10px; color: #a78bfa; background: rgba(139,92,246,0.2); padding: 3px 8px; border-radius: 6px; }

        /* 关键词云 */
        .keywords-section { padding: 16px; }
        .keywords-cloud {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
        }
        .keyword-tag {
            background: linear-gradient(135deg, rgba(99,102,241,0.3) 0%, rgba(139,92,246,0.2) 100%);
            color: #c4b5fd;
            padding: 6px 12px;
            border-radius: 16px;
            border: 1px solid rgba(139,92,246,0.3);
        }
        .keyword-lg { font-size: 13px; font-weight: 600; }
        .keyword-md { font-size: 11px; }
        .keyword-sm { font-size: 10px; opacity: 0.8; }

        /* 互动关系 */
        .interactions-section { padding: 16px; background: rgba(0,0,0,0.1); }
        .interaction-pair {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 10px 0;
            border-bottom: 1px solid rgba(100,80,150,0.1);
        }
        .interaction-pair:last-child { border-bottom: none; }
        .interact-user {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: #e4e4e4;
        }
        .interact-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 12px;
            font-weight: 600;
        }
        .interact-arrow {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
        }
        .arrow-line {
            width: 40px;
            height: 2px;
            background: linear-gradient(90deg, #6366f1, #8b5cf6);
            position: relative;
        }
        .arrow-line::after {
            content: '→';
            position: absolute;
            right: -8px;
            top: -7px;
            color: #8b5cf6;
            font-size: 12px;
        }
        .interact-count { font-size: 9px; color: rgba(255,255,255,0.5); }

        /* 群聊氛围 */
        .atmosphere-section { padding: 16px; }
        .atmosphere-grid { display: flex; flex-direction: column; gap: 12px; }
        .atmos-item { display: flex; align-items: center; gap: 10px; }
        .atmos-label { font-size: 11px; color: rgba(255,255,255,0.6); width: 50px; }
        .atmos-bar {
            flex: 1;
            height: 8px;
            background: rgba(0,0,0,0.3);
            border-radius: 4px;
            overflow: hidden;
        }
        .atmos-fill {
            height: 100%;
            background: linear-gradient(90deg, #22c55e 0%, #4ade80 100%);
            border-radius: 4px;
            transition: width 0.3s;
        }
        .atmos-fill.active { background: linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%); }
        .atmos-fill.interact { background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%); }
        .atmos-value { font-size: 11px; color: #e4e4e4; width: 40px; text-align: right; }

        /* 精彩语录 */
        .quotes-section { padding: 16px; }
        .quotes-list { display: flex; flex-direction: column; gap: 10px; }
        .quote-card {
            background: linear-gradient(135deg, rgba(50,45,80,0.5) 0%, rgba(35,30,60,0.7) 100%);
            border-radius: 10px;
            padding: 12px 14px;
            position: relative;
            border-left: 3px solid #8b5cf6;
        }
        .quote-mark {
            position: absolute;
            top: 4px;
            left: 8px;
            font-size: 24px;
            color: rgba(139,92,246,0.3);
            font-family: serif;
        }
        .quote-content {
            font-size: 11px;
            color: #d1d5db;
            line-height: 1.6;
            padding-left: 16px;
        }
        .quote-author {
            font-size: 10px;
            color: rgba(255,255,255,0.5);
            text-align: right;
            margin-top: 6px;
        }

        /* 底部 */
        .footer {
            padding: 14px 16px;
            background: rgba(0,0,0,0.3);
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid rgba(100,80,150,0.15);
        }
        .footer-left { font-size: 10px; color: rgba(255,255,255,0.4); }
        .footer-right { font-size: 10px; color: rgba(255,255,255,0.3); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-title">✨ ${title} ✨</div>
            <div class="header-subtitle">${subtitle || '基于群聊消息的智能分析'}</div>
            <div class="header-time">
                <div class="header-date">${dateStr}</div>
                <div class="header-clock">${timeStr}</div>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">💬</div>
                <div class="stat-value">${messageCount || '-'}</div>
                <div class="stat-label">消息数</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-value">${participantCount || '-'}</div>
                <div class="stat-label">参与者</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">⚡</div>
                <div class="stat-value">${avgMessages || '-'}</div>
                <div class="stat-label">人均</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🔥</div>
                <div class="stat-value">${topUsers.length || '-'}</div>
                <div class="stat-label">活跃</div>
            </div>
        </div>

        ${
            topicsHtml
                ? `
        <div class="topics-section">
            <div class="section-header">
                <div class="section-icon">💎</div>
                <div class="section-title">话题精华</div>
            </div>
            <div class="topics-grid">${topicsHtml}</div>
        </div>`
                : ''
        }

        <div class="chart-section">
            <div class="section-header">
                <div class="section-icon">📊</div>
                <div class="section-title">活跃时段</div>
            </div>
            <div class="chart-container">
                <div class="chart-bars">${activityBars}</div>
                <div class="chart-labels">
                    <span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>24时</span>
                </div>
            </div>
        </div>

        ${
            userCardsHtml
                ? `
        <div class="users-section">
            <div class="section-header">
                <div class="section-icon">🏆</div>
                <div class="section-title">活跃榜单 TOP${Math.min(topUsers.length, 8)}</div>
            </div>
            <div class="users-grid">${userCardsHtml}</div>
        </div>`
                : ''
        }

        ${
            keywordsHtml
                ? `
        <div class="keywords-section">
            <div class="section-header">
                <div class="section-icon">🏷️</div>
                <div class="section-title">关键词云</div>
            </div>
            <div class="keywords-cloud">${keywordsHtml}</div>
        </div>`
                : ''
        }

        ${
            interactionsHtml
                ? `
        <div class="interactions-section">
            <div class="section-header">
                <div class="section-icon">🔗</div>
                <div class="section-title">互动关系</div>
            </div>
            ${interactionsHtml}
        </div>`
                : ''
        }

        <div class="atmosphere-section">
            <div class="section-header">
                <div class="section-icon">🎭</div>
                <div class="section-title">群聊氛围</div>
            </div>
            ${atmosphereHtml}
        </div>

        ${
            quotesHtml
                ? `
        <div class="quotes-section">
            <div class="section-header">
                <div class="section-icon">💬</div>
                <div class="section-title">精彩语录</div>
            </div>
            <div class="quotes-list">${quotesHtml}</div>
        </div>`
                : ''
        }

        <div class="content">
            ${html}
        </div>

        <div class="footer">
            <div class="footer-left">✨ AI 智能分析</div>
            <div class="footer-right">${now.toLocaleString('zh-CN')}</div>
        </div>
    </div>
</body>
</html>`
}
