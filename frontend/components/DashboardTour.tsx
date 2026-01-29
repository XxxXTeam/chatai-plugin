'use client'

import { OnboardingTour, TourStep, useTour } from './OnboardingTour'
import { Button } from '@/components/ui/button'
import { HelpCircle } from 'lucide-react'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip'

const DASHBOARD_TOUR_ID = 'dashboard-main'

// Define tour steps for the dashboard
const DASHBOARD_TOUR_STEPS: TourStep[] = [
    {
        target: '[data-tour="sidebar"]',
        title: '👋 欢迎使用 ChatAI',
        description: '让我们一步步完成初始配置，只需几分钟即可开始使用 AI 聊天功能。',
        placement: 'right',
        spotlightPadding: 4
    },
    {
        target: '[data-tour="config"]',
        title: '第 1 步：配置渠道',
        description: '首先需要配置 AI 服务渠道。\n\n点击展开「配置中心」，然后进入「渠道管理」添加 API 渠道（如 OpenAI、DeepSeek 等）。\n\n这是使用插件的基础，没有渠道无法调用 AI。',
        placement: 'right',
        spotlightPadding: 6
    },
    {
        target: '[data-tour="config"]',
        title: '第 2 步：设置默认模型',
        description: '配置好渠道后，进入「基础设置」：\n\n1. 点击「获取模型」按钮拉取可用模型\n2. 选择一个默认模型（如 gpt-4o）\n3. 设置触发前缀（默认 #ai）',
        placement: 'right',
        spotlightPadding: 6
    },
    {
        target: '[data-tour="config"]',
        title: '第 3 步：选择预设人格',
        description: '进入「预设管理」选择或创建 AI 人格：\n\n• 可以使用内置预设快速开始\n• 也可以自定义 AI 的性格和回复风格\n• 预设决定了 AI 的表现方式',
        placement: 'right',
        spotlightPadding: 6
    },
    {
        target: '[data-tour="ai"]',
        title: '第 4 步：配置工具（可选）',
        description: '展开「AI扩展」进入「工具配置」：\n\n• 启用需要的工具（如联网搜索、天气查询等）\n• 禁用不需要的工具以提升响应速度\n• 工具让 AI 能执行更多任务',
        placement: 'right',
        spotlightPadding: 6
    },
    {
        target: '[data-tour="users"]',
        title: '第 5 步：群组设置（可选）',
        description: '展开「用户管理」进入「群组管理」：\n\n• 为特定群组设置独立配置\n• 可以为不同群设置不同的 AI 人格\n• 管理群组功能开关和权限',
        placement: 'right',
        spotlightPadding: 6
    },
    {
        target: '[data-tour="header-user"]',
        title: '🎉 配置完成！',
        description: '恭喜！基础配置已完成。\n\n现在可以在 QQ 中 @机器人 或发送触发前缀开始聊天了。\n\n点击 ? 图标可随时重新查看此引导。',
        placement: 'bottom',
        spotlightPadding: 8
    }
]

interface DashboardTourProps {
    forceShow?: boolean
}

export function DashboardTour({ forceShow = false }: DashboardTourProps) {
    return (
        <OnboardingTour
            tourId={DASHBOARD_TOUR_ID}
            steps={DASHBOARD_TOUR_STEPS}
            forceShow={forceShow}
            onComplete={() => {
                console.log('Dashboard tour completed')
            }}
        />
    )
}

// Button to restart the tour
export function RestartTourButton() {
    const { resetTour, isCompleted } = useTour(DASHBOARD_TOUR_ID)

    if (!isCompleted) return null

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={resetTour}
                        className="h-8 w-8"
                    >
                        <HelpCircle className="h-4 w-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>重新开始引导</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export { DASHBOARD_TOUR_ID, DASHBOARD_TOUR_STEPS }
export default DashboardTour
