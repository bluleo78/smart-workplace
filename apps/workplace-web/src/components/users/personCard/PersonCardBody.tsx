// 사람 카드 내용(WP-1767) — 머리(아바타·이름·직책·아이디) · 정보 줄 · 단추 한 줄 · 연락처 링크.
// 팝오버(데스크톱)와 아래 시트(모바일)가 같은 내용을 쓴다. 프로필 요청이 실패해도 PersonRef 만으로 이름과 kind 별 단추를 그린다.
import { Bot } from 'lucide-react'
import { type MouseEvent, type ReactNode, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import { UserAvatar } from '@/components/users/UserAvatar'

import { PersonActionButtons } from './PersonActionButtons'
import { contactPath } from './personCardActions'
import { type PersonRef, usePersonCard } from './usePersonCard'
import { usePersonMailAccounts } from './usePersonMailAccounts'

export function PersonCardBody({
  person,
  onClose,
}: {
  person: PersonRef
  /** 단추·링크를 누르면 카드를 닫는다. */
  onClose: () => void
}) {
  const { profile, kind, groups, slotsUsed, profileLoading } = usePersonCard(person)

  // 해석된 kind(person.kind ?? 프로필 kind). 프로필 응답 전에는 undefined 라 AI 도 사람도 아니다.
  const isAgent = kind === 'AGENT'
  const isHuman = kind === 'HUMAN'
  // 비활성이 나(self)보다 앞선다 — 정지된 계정에는 어떤 단추도 주지 않는다.
  const inactive = profile?.active === false || person.active === false
  const username = person.username ?? profile?.username
  const email = profile?.email ?? null
  // 메일 계정을 프로필 응답과 병렬로 미리 받는다 — 단추 줄은 프로필이 온 뒤에야 마운트되어 그 안에서만 받으면 요청이 직렬이 된다.
  // 단추 줄과 같은 훅(같은 조건·같은 쿼리 키)이라 React Query 가 요청을 합친다.
  usePersonMailAccounts(kind, person.id)
  const subtitle = [profile?.title, profile?.department].filter(Boolean).join(' · ')

  // 비활성 여부를 모르는 동안(호출부가 active 를 안 줬고 프로필 응답 전)은 단추를 미룬다 — 단추가 떴다 사라지지 않게. 실패하면 단추로 떨어진다.
  // kind 도 마찬가지 — 호출부가 안 줬으면 프로필이 올 때까지 미룬다. 프로필이 실패해 kind 를 끝내 모르면 단추 없이(아래 최종 분기의 null) 둔다 — 연락처 링크도 사람(HUMAN)으로 확정될 때만.
  const actionsPending = (person.active === undefined || kind === undefined) && profileLoading
  // 단추를 미룬 동안 열림 포커스는 카드 틀에 머문다 — 단추가 나타나면 포커스가 카드 밖(틀)에 있을 때만 첫 단추로 옮긴다(사용자가 이미 카드 안으로 옮겼으면 건드리지 않는다).
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (actionsPending) return
    const el = cardRef.current
    if (!el || el.contains(document.activeElement)) return
    el.querySelector<HTMLElement>('button, a[href]')?.focus()
  }, [actionsPending])

  // 단추 줄 본체는 PersonActionButtons — 카드는 불러오는 중 뼈대만 맡는다. kind 를 끝내 모르면 그 컴포넌트가 단추 없이 둔다.
  const actions: ReactNode = actionsPending ? (
    <div data-testid="person-card-actions-pending" className="h-8 animate-pulse rounded-md bg-muted/40" aria-hidden />
  ) : (
    <PersonActionButtons
      personId={person.id}
      kind={kind}
      username={username}
      email={email}
      active={!inactive}
      emailLoading={profileLoading}
      onDone={onClose}
    />
  )

  return (
    // 카드 안 클릭은 위로 올리지 않는다 — 포털 안 클릭도 React 조상(코멘트 행·고르기 버튼)으로 올라간다.
    // 키 입력은 여기서 막지 않는다 — 막으면 바깥 PopoverContent/SheetContent 의 FocusScope(Tab 순환)가 키를 못 받는다. 키 전파는 그 틀이 막는다.
    <div ref={cardRef} data-testid="person-card" className="flex flex-col gap-3 p-4" onClick={(e: MouseEvent) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        <UserAvatar user={{ id: person.id, username: username ?? '', name: person.name }} size="lg" agent={isAgent} inactive={inactive} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{person.name}</span>
            {isAgent && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded bg-ai-accent-subtle px-1 text-xs text-ai-accent">
                <Bot className="h-3 w-3" aria-hidden />
                AI
              </span>
            )}
          </div>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          {username && <p className="truncate text-xs text-muted-foreground">{username}</p>}
        </div>
      </div>

      {isAgent && profile?.description && <p className="text-xs break-words text-muted-foreground">{profile.description}</p>}
      {isAgent && slotsUsed !== undefined && <p className="text-xs text-muted-foreground">지금 작업 {slotsUsed}개</p>}
      {/* 그룹·연락처 링크는 사람 전용 — kind 를 모르는 동안(노트처럼 kind 없이 연 카드의 프로필 응답 전·실패)에는 AI 일 수도 있어 숨긴다. */}
      {isHuman && groups && groups.length > 0 && <p className="text-xs break-words text-muted-foreground">{groups.join(', ')}</p>}

      {actions}

      {isHuman && (
        <Link
          to={contactPath(person.id)}
          onClick={onClose}
          className="text-xs text-primary underline underline-offset-2"
        >
          연락처에서 보기
        </Link>
      )}
    </div>
  )
}
