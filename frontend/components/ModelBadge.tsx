'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
    OpenAI,
    Claude,
    Gemini,
    DeepSeek,
    Qwen,
    Mistral,
    Meta,
    Grok,
    Zhipu,
    Moonshot,
    Minimax,
    Cohere,
    Baichuan,
    Yi,
    Doubao,
    Hunyuan,
    Spark,
    Wenxin,
    Perplexity,
    Ai21,
    Stepfun,
    Together,
    Groq,
    OpenRouter,
    Fireworks,
    Ollama,
    HuggingFace,
    Aws,
    Azure,
    Aya,
    Bilibili,
    CodeGeeX,
    Dbrx,
    Dalle,
    ElevenLabs,
    FishAudio,
    Flux,
    Google,
    Inflection,
    Kolors,
    LLaVA,
    Novita,
    OpenChat,
    Phind,
    Rwkv,
    SenseNova,
    Sora,
    Stability,
    Suno,
    Vllm,
    Voyage,
    XiaomiMiMo,
    Xuanyuan
} from '@lobehub/icons'

interface ModelBadgeProps {
    model: string
    className?: string
    showIcon?: boolean
    copyable?: boolean
    size?: 'sm' | 'md' | 'lg'
}

// 获取模型品牌颜色
function getModelColor(model: string): string {
    const lower = model.toLowerCase()

    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3'))
        return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    if (lower.includes('claude')) return 'bg-orange-500/10 text-orange-600 border-orange-500/20'
    if (lower.includes('gemini')) return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    if (lower.includes('deepseek')) return 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20'
    if (lower.includes('qwen')) return 'bg-purple-500/10 text-purple-600 border-purple-500/20'
    if (lower.includes('glm')) return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20'
    if (lower.includes('mistral')) return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    if (lower.includes('llama')) return 'bg-sky-500/10 text-sky-600 border-sky-500/20'
    if (lower.includes('grok')) return 'bg-neutral-500/10 text-neutral-600 border-neutral-500/20'
    if (lower.includes('kolors') || lower.includes('可图')) return 'bg-pink-500/10 text-pink-600 border-pink-500/20'
    if (lower.includes('llava')) return 'bg-rose-500/10 text-rose-600 border-rose-500/20'
    if (lower.includes('groq')) return 'bg-neutral-500/10 text-neutral-600 border-neutral-500/20'
    if (lower.includes('doubao') || lower.includes('豆包')) return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    if (lower.includes('hunyuan') || lower.includes('混元')) return 'bg-blue-600/10 text-blue-700 border-blue-600/20'
    if (lower.includes('spark') || lower.includes('讯飞')) return 'bg-red-500/10 text-red-600 border-red-500/20'
    if (lower.includes('ernie') || lower.includes('文心')) return 'bg-blue-400/10 text-blue-500 border-blue-400/20'
    if (lower.includes('perplexity')) return 'bg-teal-500/10 text-teal-600 border-teal-500/20'
    if (lower.includes('step-')) return 'bg-violet-500/10 text-violet-600 border-violet-500/20'
    if (lower.includes('xiaomi') || lower.includes('mimo'))
        return 'bg-orange-400/10 text-orange-500 border-orange-400/20'
    if (lower.includes('xuanyuan') || lower.includes('轩辕'))
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'

    return 'bg-muted text-muted-foreground border-border'
}

// 渲染模型图标
function renderModelIcon(model: string, size: number) {
    const lower = model.toLowerCase()

    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('davinci')) {
        return <OpenAI size={size} />
    }
    if (lower.includes('claude')) {
        return <Claude size={size} />
    }
    if (lower.includes('gemini') || lower.includes('gemma')) {
        return <Gemini size={size} />
    }
    if (lower.includes('deepseek')) {
        return <DeepSeek size={size} />
    }
    if (lower.includes('qwen') || lower.includes('qwq')) {
        return <Qwen size={size} />
    }
    if (lower.includes('glm') || lower.includes('chatglm') || lower.includes('zhipu')) {
        return <Zhipu size={size} />
    }
    if (lower.includes('mistral') || lower.includes('mixtral')) {
        return <Mistral size={size} />
    }
    if (lower.includes('llama')) {
        return <Meta size={size} />
    }
    if (lower.includes('grok')) {
        return <Grok size={size} />
    }
    if (lower.includes('moonshot') || lower.includes('kimi')) {
        return <Moonshot size={size} />
    }
    if (lower.includes('minimax') || lower.includes('abab')) {
        return <Minimax size={size} />
    }
    if (lower.includes('cohere') || lower.includes('command')) {
        return <Cohere size={size} />
    }
    if (lower.includes('baichuan')) {
        return <Baichuan size={size} />
    }
    if (lower.includes('yi-') || lower.includes('yi/')) {
        return <Yi size={size} />
    }
    if (lower.includes('doubao') || lower.includes('豆包') || lower.includes('skylark')) {
        return <Doubao size={size} />
    }
    if (lower.includes('hunyuan') || lower.includes('混元')) {
        return <Hunyuan size={size} />
    }
    if (lower.includes('spark') || lower.includes('讯飞') || lower.includes('星火')) {
        return <Spark size={size} />
    }
    if (lower.includes('ernie') || lower.includes('文心') || lower.includes('wenxin')) {
        return <Wenxin size={size} />
    }
    if (lower.includes('perplexity') || lower.includes('pplx')) {
        return <Perplexity size={size} />
    }
    if (lower.includes('jamba') || lower.includes('j2-') || lower.includes('ai21')) {
        return <Ai21 size={size} />
    }
    if (lower.includes('step-') || lower.includes('stepfun')) {
        return <Stepfun size={size} />
    }
    if (lower.includes('together')) {
        return <Together size={size} />
    }
    if (lower.includes('groq')) {
        return <Groq size={size} />
    }
    if (lower.includes('openrouter')) {
        return <OpenRouter size={size} />
    }
    if (lower.includes('fireworks')) {
        return <Fireworks size={size} />
    }
    if (lower.includes('ollama')) {
        return <Ollama size={size} />
    }
    if (lower.includes('huggingface') || lower.includes('hf/')) {
        return <HuggingFace size={size} />
    }
    // 额外模型
    if (lower.includes('aya')) {
        return <Aya size={size} />
    }
    if (lower.includes('bilibili') || lower.includes('index')) {
        return <Bilibili size={size} />
    }
    if (lower.includes('codegeex')) {
        return <CodeGeeX size={size} />
    }
    if (lower.includes('dbrx')) {
        return <Dbrx size={size} />
    }
    if (lower.includes('dall') || lower.includes('dalle')) {
        return <Dalle size={size} />
    }
    if (lower.includes('elevenlabs')) {
        return <ElevenLabs size={size} />
    }
    if (lower.includes('fish') || lower.includes('bert-vits')) {
        return <FishAudio size={size} />
    }
    if (lower.includes('flux')) {
        return <Flux size={size} />
    }
    if (lower.includes('palm')) {
        return <Google size={size} />
    }
    if (lower.includes('inflection') || lower.includes('pi-')) {
        return <Inflection size={size} />
    }
    if (lower.includes('kolors') || lower.includes('可图')) {
        return <Kolors size={size} />
    }
    if (lower.includes('llava')) {
        return <LLaVA size={size} />
    }
    if (lower.includes('nova') || lower.includes('aws') || lower.includes('bedrock')) {
        return <Aws size={size} />
    }
    if (lower.includes('openchat')) {
        return <OpenChat size={size} />
    }
    if (lower.includes('phind')) {
        return <Phind size={size} />
    }
    if (lower.includes('rwkv')) {
        return <Rwkv size={size} />
    }
    if (lower.includes('sensenova') || lower.includes('商汤')) {
        return <SenseNova size={size} />
    }
    if (lower.includes('sora')) {
        return <Sora size={size} />
    }
    if (lower.includes('voyage')) {
        return <Voyage size={size} />
    }
    if (lower.includes('skywork') || lower.includes('天工')) {
        return <Novita size={size} />
    }
    if (lower.includes('stability') || lower.includes('stable')) {
        return <Stability size={size} />
    }
    if (lower.includes('suno')) {
        return <Suno size={size} />
    }
    if (lower.includes('azure')) {
        return <Azure size={size} />
    }
    if (lower.includes('vllm')) {
        return <Vllm size={size} />
    }
    if (lower.includes('xiaomi') || lower.includes('mimo')) {
        return <XiaomiMiMo size={size} />
    }
    if (lower.includes('xuanyuan') || lower.includes('轩辕')) {
        return <Xuanyuan size={size} />
    }

    return null
}

export function ModelBadge({ model, className, showIcon = true, copyable = true, size = 'sm' }: ModelBadgeProps) {
    const [copied, setCopied] = useState(false)

    const colorClass = getModelColor(model)

    const sizeClasses = {
        sm: 'text-xs px-2 py-0.5 gap-1',
        md: 'text-sm px-2.5 py-1 gap-1.5',
        lg: 'text-base px-3 py-1.5 gap-2'
    }

    const iconSizes = {
        sm: 12,
        md: 14,
        lg: 16
    }

    const handleCopy = async () => {
        if (!copyable) return

        try {
            await navigator.clipboard.writeText(model)
            setCopied(true)
            toast.success(`已复制: ${model}`)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error('复制失败')
        }
    }

    return (
        <span
            onClick={handleCopy}
            className={cn(
                'inline-flex items-center rounded-md border font-mono transition-all',
                colorClass,
                sizeClasses[size],
                copyable && 'cursor-pointer hover:opacity-80 active:scale-95',
                className
            )}
            title={copyable ? `点击复制: ${model}` : model}
        >
            {showIcon && renderModelIcon(model, iconSizes[size])}
            <span className="truncate max-w-[200px]">{model}</span>
            {copyable && (
                <span className="ml-1 opacity-50">
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </span>
            )}
        </span>
    )
}

// 模型列表组件 - 用于显示多个模型
interface ModelListProps {
    models: string[]
    className?: string
    maxDisplay?: number
    size?: 'sm' | 'md' | 'lg'
}

export function ModelList({ models, className, maxDisplay = 5, size = 'sm' }: ModelListProps) {
    const displayModels = models.slice(0, maxDisplay)
    const remaining = models.length - maxDisplay

    return (
        <div className={cn('flex flex-wrap gap-1', className)}>
            {displayModels.map((model, index) => (
                <ModelBadge key={index} model={model} size={size} />
            ))}
            {remaining > 0 && <span className="text-xs text-muted-foreground self-center">+{remaining} 更多</span>}
        </div>
    )
}
