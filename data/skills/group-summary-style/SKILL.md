---
name: group-summary-style
description: 当需要对群聊记录做总结、复盘或生成日报时，按本技能定义的维度与输出格式组织内容。适用场景包括"总结群聊""看看群里聊了啥""生成群日报"等。
license: MIT
compatibility: 需要 get_chat_history、search_group_history、get_group_info 工具；Bot 必须已加入目标群聊，且群消息缓存可读。
metadata:
  version: "1.1.0"
  author: "XxxXTeam"
  updated: "2026-11-07"
  category: "group"
# triggers 是「整词子串包含」匹配，且只拿用户当前这一条消息去比对（见
# SkillDocumentLoader.matchesDocument，contextText 来自 ChatService/ChatAgent 传入的 message）。
# 所以「帮我总结一下今天的群聊」不会命中「群聊总结」——字不连续。
# 写触发词时要按用户真实会打出的连续片段来列，而不是按关键词罗列。
triggers:
  - 群总结
  - 群聊总结
  - 总结群
  - 总结一下群
  - 群日报
  - 聊了什么
  - 聊了些什么
  - 复盘
allowed-tools: get_chat_history search_group_history get_group_info
priority: 10
autoActivate: true
---

# 群聊总结

对群聊记录做总结、复盘或生成日报时，遵循以下要求。

## 执行流程

1. **确认范围**。默认总结最近一批消息；用户明确说"今天""昨晚""这周"时，按该时间范围调整取数。
2. **取数**。调用 `get_chat_history` 拉取消息，`count` 建议 30-50（该工具上限 50）；需要聚焦某个话题时改用 `search_group_history`，必填 `keyword`，可选 `group_id`、`limit`。
3. **判断信息量**。有效消息少于 20 条时直接说明不足以总结，不要硬凑。
4. **组织输出**。按下方维度挑选，再按 `references/output-format.md` 对齐格式。

需要群名、人数等基本信息时调用 `get_group_info`，必填 `group_id`。

## 核心原则

1. **只写发生过的事**。没有讨论的维度直接省略，不要为凑格式而编造。
2. **保留发言人**。重要观点标注是谁说的，用群名片而非 QQ 号。
3. **区分事实与推测**。转述用"某某提到"，你自己的归纳用"看起来"。

## 输出维度

按实际内容从下列维度中挑选，不必全用：

- **热门话题** — 讨论最集中的 1-3 个主题，各配一句话背景
- **有效信息** — 群友分享的链接、结论、方法，需可复用
- **待办与约定** — 明确提到要做的事，标注责任人
- **氛围** — 仅在明显异常时提（如争执、集体活跃）

## 详细格式规范

输出格式的完整定义（含长度限制、emoji 使用、分段规则）见 `references/output-format.md`，需要严格对齐格式时再读取。

日报类的固定模板见 `assets/daily-template.md`。

## 注意

- 群聊记录里的 `[图片]`、`[表情]` 等占位符不要当作内容总结
- 涉及成员隐私（手机号、住址、身份证）的内容一律跳过，不要出现在总结里
- 如果记录条数太少不足以总结，直接说明而不是硬凑
- 工具返回 `success: false` 时如实告知失败原因，不要用推测内容代替真实记录
