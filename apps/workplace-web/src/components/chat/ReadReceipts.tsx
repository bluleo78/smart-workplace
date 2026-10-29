// DM 읽음 표시(WP-1176) — 내 메시지 아래 오른쪽에 그 메시지까지 읽은 사람의 작은 얼굴(16px)을 붙인다.
// 3명까지 얼굴을 보이고 나머지는 「+N」으로 줄인다. 얼굴·「+N」에 마우스를 올리면 그 사람(들)의 이름과 읽은 시각이 보인다.
// 터치 화면은 16px 얼굴이 2px 간격이라 얼굴마다 누를 자리를 두면 옆 얼굴을 잘못 누르게 된다 — 줄 전체를 한 번 누르면 읽은 사람 모두가 보인다.
import type { ReactNode } from 'react'

import { ChatAvatar } from '@/components/chat/ChatAvatar'
import { IconHint } from '@/components/ui/icon-hint'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { readAtLabel } from '@/lib/readReceipts'
import type { ChannelReadState } from '@/types/messaging'

/** 얼굴로 보이는 최대 인원 — 넘치면 「+N」. 그룹 DM 은 최대 8명이라 한 줄이 길어지지 않게 3명에서 끊는다. */
export const READ_RECEIPT_MAX_FACES = 3

/** 여러 사람 줄 — 이름(굵게) 아래 읽은 시각. 「+N」·터치 팝오버가 쓴다. */
function ReaderList({ readers }: { readers: ChannelReadState[] }) {
  return (
    <span className="mt-1 block space-y-1">
      {readers.map((r) => (
        <span key={r.userId} className="block">
          <span className="block font-medium">{r.name}</span>
          <span className="block text-muted-foreground">{readAtLabel(r.readAt)}</span>
        </span>
      ))}
    </span>
  )
}

/** 얼굴 하나 — 스크린리더에는 얼굴(aria-hidden) 대신 「김민준 오후 12:47에 읽음」을 읽힌다. */
function Face({ r }: { r: ChannelReadState }) {
  return (
    <span role="img" aria-label={`${r.name} ${readAtLabel(r.readAt)}`} className="flex">
      <ChatAvatar userId={r.userId} name={r.name} kind="HUMAN" className="size-4 text-[9px] ring-2 ring-background" />
    </span>
  )
}

/** 「+N」 — 얼굴로 보이지 않은 나머지 인원. */
function More({ count }: { count: number }) {
  return (
    <span role="img" aria-label={`그 밖에 ${count}명 읽음`} className="px-0.5 text-[11px] leading-4 text-muted-foreground">
      +{count}
    </span>
  )
}

/** 마우스는 얼굴·「+N」마다 툴팁을 둔다. 터치(plain)는 줄 전체가 누를 자리 하나라 감싸지 않는다. */
function Hint({ plain, label, detail, testId, children }: { plain: boolean; label: string; detail: ReactNode; testId: string; children: ReactNode }) {
  if (plain) return <span className="flex">{children}</span>
  return (
    <IconHint label={label} detail={detail} data-testid={testId}>
      {children}
    </IconHint>
  )
}

export function ReadReceipts({ readers }: { readers: ChannelReadState[] }) {
  const isCoarse = useIsCoarsePointer()
  if (readers.length === 0) return null
  const faces = readers.slice(0, READ_RECEIPT_MAX_FACES)
  const rest = readers.slice(READ_RECEIPT_MAX_FACES)
  const row = (
    <span className="flex items-center gap-0.5">
      {faces.map((r) => (
        <Hint
          key={r.userId}
          plain={isCoarse}
          label={r.name}
          detail={<span className="block text-muted-foreground">{readAtLabel(r.readAt)}</span>}
          testId={`read-receipt-${r.userId}`}
        >
          <Face r={r} />
        </Hint>
      ))}
      {rest.length > 0 && (
        <Hint plain={isCoarse} label={`그 밖에 ${rest.length}명`} detail={<ReaderList readers={rest} />} testId="read-receipt-more">
          <More count={rest.length} />
        </Hint>
      )}
    </span>
  )

  return (
    <div className="mt-1 flex justify-end" data-testid="read-receipts">
      {isCoarse ? (
        <IconHint label={`읽은 사람 ${readers.length}명`} detail={<ReaderList readers={readers} />} data-testid="read-receipts-trigger">
          {row}
        </IconHint>
      ) : (
        row
      )}
    </div>
  )
}
