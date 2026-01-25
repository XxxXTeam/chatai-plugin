/**
 * 记忆类型定义
 * 定义结构化记忆的分类和子类型
 */

// 记忆主分类
export const MemoryCategory = {
    PROFILE: 'profile', // 基本信息：姓名、年龄、职业、位置
    PREFERENCE: 'preference', // 偏好习惯：喜好、讨厌、习惯
    EVENT: 'event', // 重要事件：生日、纪念日、计划
    RELATION: 'relation', // 人际关系：朋友、家人、同事
    TOPIC: 'topic', // 话题兴趣：讨论过的主题
    CUSTOM: 'custom' // 自定义扩展
}

// 基本信息子类型
export const ProfileSubType = {
    NAME: 'name', // 姓名/昵称
    AGE: 'age', // 年龄
    GENDER: 'gender', // 性别
    LOCATION: 'location', // 所在地
    OCCUPATION: 'occupation', // 职业
    EDUCATION: 'education', // 学历/学校
    CONTACT: 'contact' // 联系方式
}

// 偏好习惯子类型
export const PreferenceSubType = {
    LIKE: 'like', // 喜欢
    DISLIKE: 'dislike', // 讨厌
    HOBBY: 'hobby', // 爱好
    HABIT: 'habit', // 习惯
    FOOD: 'food', // 食物偏好
    STYLE: 'style' // 风格偏好
}

// 重要事件子类型
export const EventSubType = {
    BIRTHDAY: 'birthday', // 生日
    ANNIVERSARY: 'anniversary', // 纪念日
    PLAN: 'plan', // 计划/安排
    MILESTONE: 'milestone', // 里程碑
    SCHEDULE: 'schedule' // 日程
}

// 人际关系子类型
export const RelationSubType = {
    FAMILY: 'family', // 家人
    FRIEND: 'friend', // 朋友
    COLLEAGUE: 'colleague', // 同事
    PARTNER: 'partner', // 伴侣
    PET: 'pet' // 宠物
}

// 话题兴趣子类型
export const TopicSubType = {
    INTEREST: 'interest', // 感兴趣的话题
    DISCUSSED: 'discussed', // 讨论过的话题
    KNOWLEDGE: 'knowledge' // 知识领域
}

// 分类中文名称映射
export const CategoryLabels = {
    [MemoryCategory.PROFILE]: '基本信息',
    [MemoryCategory.PREFERENCE]: '偏好习惯',
    [MemoryCategory.EVENT]: '重要事件',
    [MemoryCategory.RELATION]: '人际关系',
    [MemoryCategory.TOPIC]: '话题兴趣',
    [MemoryCategory.CUSTOM]: '其他'
}

// 子类型中文名称映射
export const SubTypeLabels = {
    // Profile
    [ProfileSubType.NAME]: '姓名',
    [ProfileSubType.AGE]: '年龄',
    [ProfileSubType.GENDER]: '性别',
    [ProfileSubType.LOCATION]: '所在地',
    [ProfileSubType.OCCUPATION]: '职业',
    [ProfileSubType.EDUCATION]: '学历',
    [ProfileSubType.CONTACT]: '联系方式',
    // Preference
    [PreferenceSubType.LIKE]: '喜欢',
    [PreferenceSubType.DISLIKE]: '讨厌',
    [PreferenceSubType.HOBBY]: '爱好',
    [PreferenceSubType.HABIT]: '习惯',
    [PreferenceSubType.FOOD]: '食物偏好',
    [PreferenceSubType.STYLE]: '风格偏好',
    // Event
    [EventSubType.BIRTHDAY]: '生日',
    [EventSubType.ANNIVERSARY]: '纪念日',
    [EventSubType.PLAN]: '计划',
    [EventSubType.MILESTONE]: '里程碑',
    [EventSubType.SCHEDULE]: '日程',
    // Relation
    [RelationSubType.FAMILY]: '家人',
    [RelationSubType.FRIEND]: '朋友',
    [RelationSubType.COLLEAGUE]: '同事',
    [RelationSubType.PARTNER]: '伴侣',
    [RelationSubType.PET]: '宠物',
    // Topic
    [TopicSubType.INTEREST]: '兴趣',
    [TopicSubType.DISCUSSED]: '讨论过',
    [TopicSubType.KNOWLEDGE]: '知识领域'
}

// 记忆来源
export const MemorySource = {
    AUTO: 'auto', // 自动提取
    MANUAL: 'manual', // 手动添加
    IMPORT: 'import', // 导入
    SUMMARY: 'summary', // 总结生成
    MIGRATION: 'migration' // 迁移
}

// 分类图标映射（用于前端）
export const CategoryIcons = {
    [MemoryCategory.PROFILE]: 'User',
    [MemoryCategory.PREFERENCE]: 'Heart',
    [MemoryCategory.EVENT]: 'Calendar',
    [MemoryCategory.RELATION]: 'Users',
    [MemoryCategory.TOPIC]: 'MessageSquare',
    [MemoryCategory.CUSTOM]: 'Tag'
}

// 验证分类是否有效
export function isValidCategory(category) {
    return Object.values(MemoryCategory).includes(category)
}

// 获取分类的所有子类型
export function getSubTypes(category) {
    switch (category) {
        case MemoryCategory.PROFILE:
            return Object.values(ProfileSubType)
        case MemoryCategory.PREFERENCE:
            return Object.values(PreferenceSubType)
        case MemoryCategory.EVENT:
            return Object.values(EventSubType)
        case MemoryCategory.RELATION:
            return Object.values(RelationSubType)
        case MemoryCategory.TOPIC:
            return Object.values(TopicSubType)
        default:
            return []
    }
}

// 获取分类标签
export function getCategoryLabel(category) {
    return CategoryLabels[category] || category
}

// 获取子类型标签
export function getSubTypeLabel(subType) {
    return SubTypeLabels[subType] || subType
}

// 默认导出所有类型
export default {
    MemoryCategory,
    ProfileSubType,
    PreferenceSubType,
    EventSubType,
    RelationSubType,
    TopicSubType,
    CategoryLabels,
    SubTypeLabels,
    MemorySource,
    CategoryIcons,
    isValidCategory,
    getSubTypes,
    getCategoryLabel,
    getSubTypeLabel
}
