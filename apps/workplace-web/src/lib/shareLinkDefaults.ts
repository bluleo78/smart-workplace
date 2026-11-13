// 공유 링크 만료일 기본값 — 웹 전용 편의(WP-1538 P4). 서버는 만료 없음도 허용하므로 기본값은 화면에서만 미리 채운다.
// 대상 종류(파일·폴더)마다 다른 폼 정책(기본 만료일·안내 문구)도 여기 모아 공유 모달이 종류를 여러 번 가르지 않게 한다.
import { addDays } from 'date-fns'

import type { ShareTargetRef } from '@/api/drive'
import { formatDateKey } from '@/lib/formatters'

type ShareKind = ShareTargetRef['kind']
type ShareAudience = 'EXTERNAL' | 'INTERNAL'

/** 폴더 외부 링크의 기본 만료일 — 로컬 날짜 기준 오늘+30일(YYYY-MM-DD). */
export function defaultFolderExpiry(today: Date): string {
  return formatDateKey(addDays(today, 30))
}

/**
 * 가시성·대상 종류가 바뀔 때의 만료일 입력값.
 * 사용자가 만지지 않은 폴더 입력만 기본값을 따라간다(외부 → 30일 뒤, 사내 → 비움). 파일이거나 사용자가 만졌으면 그대로 둔다.
 */
export function nextExpiry({
  kind,
  audience,
  touched,
  current,
  today,
}: {
  kind: ShareKind
  audience: ShareAudience
  touched: boolean
  current: string
  today: Date
}): string {
  if (kind !== 'folder' || touched) return current
  return audience === 'EXTERNAL' ? defaultFolderExpiry(today) : ''
}

/** 폼을 처음 펼쳤을 때(가시성 기본 외부, 만지지 않음)의 만료일 입력값 — 폴더는 30일 뒤, 파일은 비움. */
export function initialExpiry(kind: ShareKind, today: Date): string {
  return nextExpiry({ kind, audience: 'EXTERNAL', touched: false, current: '', today })
}

/** 공유 폼 안내 문구 — 없는 칸은 null(그리지 않는다). */
export interface ShareFormGuide {
  /** 외부 폴더 링크 경고(노란 상자) — 하위·나중에 넣는 파일까지 열린다는 것을 알린다. */
  warning: string | null
  /** 사내 폴더 링크 열람 방식 안내. */
  notice: string | null
  /** 만료일 칸 아래 기본값 안내 — 사용자가 날짜 칸을 만지기 전까지만 보인다(호출부가 판단). */
  expiryHint: string | null
}

const NO_GUIDE: ShareFormGuide = { warning: null, notice: null, expiryHint: null }

/** 대상 종류·가시성별 폼 안내(WP-1538) — 파일은 안내가 없고, 폴더는 외부면 경고+만료일 안내, 사내면 열람 안내. */
export function shareFormGuide(kind: ShareKind, audience: ShareAudience): ShareFormGuide {
  if (kind !== 'folder') return NO_GUIDE
  return audience === 'EXTERNAL'
    ? {
        warning: '링크를 가진 누구나 이 폴더와 하위 폴더를 볼 수 있습니다. 나중에 넣는 파일도 함께 보입니다.',
        notice: null,
        expiryHint: '외부 폴더 링크는 30일 뒤로 미리 채웁니다.',
      }
    : {
        warning: null,
        notice: '같은 워크스페이스 직원이 로그인해서 엽니다. 하위 폴더와 나중에 넣은 파일도 보입니다.',
        expiryHint: null,
      }
}
