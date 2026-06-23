import { Sparkles, X } from 'lucide-react'

import type { ChannelCatchupResponse } from '@/types/messaging'

interface Props {
  data?: ChannelCatchupResponse
  isLoading: boolean
  isError: boolean
  onConfirm: () => void
  onClose: () => void
  onJumpToMessage: (messageId: number) => void
}

// 채널 캐치업 카드 — 미읽음 구분선 위치에 인라인. 요약(✅/💬)은 AI, "📌 내 차례"는 멘션 규칙(백엔드 계산).
export function ChannelCatchupCard({
  data,
  isLoading,
  isError,
  onConfirm,
  onClose,
  onJumpToMessage,
}: Props) {
  return (
    <div
      data-testid="catchup-card"
      className="mx-4 my-2 overflow-hidden rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-background"
    >
      <div className="flex items-center justify-between border-b border-indigo-100/70 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <span className="text-[13px] font-bold text-indigo-800">놓친 대화 요약</span>
          {data && (
            <span className="text-[11px] text-muted-foreground">· 안 읽은 {data.unreadCount}건</span>
          )}
        </div>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="text-muted-foreground/60 hover:text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2 p-4" data-testid="catchup-skeleton">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      )}

      {isError && (
        <div className="p-4 text-[13px] text-muted-foreground" data-testid="catchup-error">
          요약을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </div>
      )}

      {data && !isLoading && !isError && (
        <div className="flex flex-col gap-3 p-3.5">
          {data.decisions.length > 0 && (
            <section>
              <div className="mb-1.5 text-[11px] font-bold text-green-600">✅ 결정된 것</div>
              <ul className="flex flex-col gap-1.5">
                {data.decisions.map((g, i) => (
                  <li key={`d${i}`} className="text-[13px] leading-relaxed text-foreground">
                    {g.text}
                    {g.sourceMessageIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(g.sourceMessageIds[0])}
                        className="ml-1 text-[11px] text-indigo-500 hover:underline"
                      >
                        · 원문 {g.sourceMessageIds.length}건
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.yourTurn.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="mb-1.5 text-[11px] font-bold text-amber-700">📌 내 차례</div>
              <ul className="flex flex-col gap-1.5">
                {data.yourTurn.map((m) => (
                  <li key={m.messageId} className="text-[13px] leading-relaxed text-foreground">
                    <b>{m.authorName}</b>님이 회신을 기다려요 — “{m.snippet}”
                    <button
                      type="button"
                      onClick={() => onJumpToMessage(m.messageId)}
                      className="ml-1 text-[11px] text-indigo-500 hover:underline"
                    >
                      · 원문 보기
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.discussion.length > 0 && (
            <section>
              <div className="mb-1.5 text-[11px] font-bold text-muted-foreground">💬 오간 이야기</div>
              <ul className="flex flex-col gap-1.5">
                {data.discussion.map((g, i) => (
                  <li key={`t${i}`} className="text-[13px] leading-relaxed text-muted-foreground">
                    {g.text}
                    {g.sourceMessageIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(g.sourceMessageIds[0])}
                        className="ml-1 text-[11px] text-indigo-500 hover:underline"
                      >
                        · 원문 {g.sourceMessageIds.length}건
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.decisions.length === 0 &&
            data.yourTurn.length === 0 &&
            data.discussion.length === 0 && (
              <p className="text-[13px] text-muted-foreground">새로 중요한 내용은 없었어요.</p>
            )}
        </div>
      )}

      {data && !isLoading && !isError && (
        <div className="flex items-center justify-between border-t border-indigo-100/70 bg-background/60 px-3.5 py-2.5">
          <span className="text-[11px] text-muted-foreground">AI 요약 · 근거 {data.unreadCount}건 기준</span>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="catchup-confirm"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700"
          >
            확인했어요 → 최신으로 ↓
          </button>
        </div>
      )}
    </div>
  )
}
