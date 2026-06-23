import { z } from 'zod'
import { type RunAgentDeps } from './run-agent.js'
import { runText } from './run-messaging-ai.js'

interface BaseConfig {
  assistantAgentId: number
  model: string
  maxTurns: number
  timeoutMs: number
}

// 캐치업 요약 입력: 안 읽은 채널 메시지(근거 인용을 위해 id 동반)
export const messagingCatchupInput = z.object({
  messages: z
    .array(z.object({ id: z.number(), authorName: z.string(), body: z.string() }))
    .min(1),
})
export type MessagingCatchupInput = z.infer<typeof messagingCatchupInput> & BaseConfig

export interface CatchupGroup {
  text: string
  sourceMessageIds: number[]
}
export interface CatchupResult {
  decisions: CatchupGroup[]
  discussion: CatchupGroup[]
}

const CATCHUP_PROMPT =
  '당신은 팀 채팅 보조다. 아래 "안 읽은 메시지"(각 줄 머리의 [id]는 메시지 번호)를 읽고, ' +
  '내가 놓친 것을 두 묶음으로 한국어 요약하라. ' +
  'decisions = 확정된 결정/합의(예: 일정·방향·승인). discussion = 결론 없이 오간 이야기/진행 중 논의. ' +
  '각 항목은 한 문장으로 간결히. 각 항목의 sourceMessageIds 에는 근거가 된 메시지 [id]만 넣어라(지어내지 말 것). ' +
  '결정이 없으면 decisions 는 빈 배열. 인사·잡담만 있으면 discussion 도 빈 배열. ' +
  '출력은 JSON 하나만: {"decisions":[{"text":"...","sourceMessageIds":[..]}],"discussion":[{"text":"...","sourceMessageIds":[..]}]}'

// greedy 파싱(중첩 배열) + zod 검증. 실패 시 빈 결과로 안전 폴백.
export function parseCatchupJson(text: string): CatchupResult {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    console.warn('[parseCatchupJson] JSON 객체 없음:', text.slice(0, 120))
    return { decisions: [], discussion: [] }
  }
  const group = z.object({ text: z.string(), sourceMessageIds: z.array(z.number()) })
  const schema = z.object({ decisions: z.array(group), discussion: z.array(group) })
  try {
    const parsed = schema.safeParse(JSON.parse(stripped.slice(start, end + 1)))
    if (!parsed.success) {
      console.warn('[parseCatchupJson] zod 실패:', parsed.error.message)
      return { decisions: [], discussion: [] }
    }
    return parsed.data
  } catch (e) {
    console.warn('[parseCatchupJson] JSON.parse 실패:', (e as Error).message)
    return { decisions: [], discussion: [] }
  }
}

// 안 읽은 메시지 → 구조화 요약 1회 호출.
export async function runMessagingCatchup(
  input: MessagingCatchupInput,
  deps: RunAgentDeps,
): Promise<CatchupResult> {
  const messageList = input.messages
    .map((m) => `- [${m.id}] ${m.authorName}: ${m.body}`)
    .join('\n')
  const userMessage = `안 읽은 메시지:\n${messageList}`
  return parseCatchupJson(
    await runText(CATCHUP_PROMPT, userMessage, input, deps, 'messaging-catchup'),
  )
}
