// 「드라이브에서 열기」 도착 강조(WP-1732) — 주소의 ?highlight=<파일 id> 를 읽어 그 파일 행을 잠시 강조하고 화면 안으로 스크롤한다.
// 뷰어(?preview)를 열지 않는다: 「드라이브에서 열기」는 파일이 드라이브 어디에 있는지 보려는 것이라 폴더 목록에서 그 행을 가리킨다.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { DRIVE_HIGHLIGHT_PARAM } from '@/components/viewer/driveOpen'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { parseId } from '@/lib/historyParam'
import { scrollIntoViewCentered } from '@/lib/scrollIntoViewCentered'

/**
 * 강조 전체 시간 — 3초 머문 뒤 1초 동안 흐려진다. 아래 행 클래스의 애니메이션 길이(4s)와 같아야 한다:
 * 애니메이션이 끝나는 때 이 타이머가 data-highlighted 를 떼어 강조가 끝난다.
 */
export const DRIVE_ROW_HIGHLIGHT_MS = 4000

/**
 * 파일 행에 늘 다는 강조 클래스 — data-highlighted="true" 인 동안만 켜진다(속성이 단일 원천이라 행마다 조건부 클래스를 달지 않는다).
 * 보통은 index.css 의 drive-row-arrival 키프레임(배경을 75% 동안 머물다 원래 색으로 흐림)을 돌리고,
 * 움직임 줄이기 설정이면 애니메이션 없이 고정 배경만 칠했다가 속성이 빠질 때 바로 지운다.
 */
export const DRIVE_ROW_HIGHLIGHT_CLASS =
  'data-[highlighted=true]:motion-safe:animate-[drive-row-arrival_4s_ease-out] data-[highlighted=true]:motion-reduce:bg-primary/15'

/** 강조 중인 파일과 그 강조를 켠 위치(`공간:폴더`) — 같은 id 로 다시 와도 효과가 돌도록 매번 새 객체로 둔다. */
type Flash = { id: number; scope: string }

/**
 * 폴더 목록의 도착 강조. 강조할 파일 id(없으면 null)를 돌려준다 — 행은 그 id 일 때 data-highlighted="true" 를 단다.
 * - 목록이 최신일 때(ready + 진행 중인 재조회 없음) 그 주소 항목(location.key)에서 한 번만 판정한다.
 *   캐시된 목록은 조회가 끝난 것으로 보이지만 낡았을 수 있어(방금 옮긴 파일이 빠져 있음) 뒤이은 재조회가 끝날 때까지 기다린다.
 *   화면에 그려진 행(files — 거르기 뒤)에 있으면 강조, 없으면(옮김·삭제·거르기로 숨음·잘못된 값) 강조하지 않는다.
 * - 판정한 뒤 주소에서 highlight 만 replace 로 지운다(useHistoryParam 콜드 닫기 — folderId·다른 파라미터·state 보존) —
 *   새로고침·뒤로 가기에서 다시 강조하지 않게. 메뉴가 push 로 오므로 기본 닫기(-1)면 출발 화면으로 돌아가 버려 unmarkedClose='replace'.
 * - 폴더·공간(scope)이 바뀌면 강조가 꺼진다 — 몇 초 안에 돌아오거나 전환 중 이전 폴더 목록(placeholder)이 보일 때 그 행이 다시 강조되지 않게.
 * @param ready 판정해도 되는가 — 풀페이지이고(임베드 채널 드로워는 주소 규칙이 달라 늘 거짓) 지금 폴더 조회가 끝났다(placeholder 아님).
 * @param query 지금 폴더 목록 조회 — isFetching 은 highlight 가 기다리는 동안에만 읽는다(평소 방문은 조회 상태 변화를 구독하지 않게).
 * @param files 지금 폴더에서 실제로 그리는 파일 행(placeholder 아님, 이름 거르기 뒤).
 * @param scope 지금 보는 위치(`공간:폴더`).
 */
export function useDriveRowHighlight({
  ready,
  query,
  files,
  scope,
}: {
  ready: boolean
  query: { readonly isFetching: boolean }
  files: readonly { id: number }[]
  scope: string
}): number | null {
  const location = useLocation()
  const { value: raw, close } = useHistoryParam(DRIVE_HIGHLIGHT_PARAM, { unmarkedClose: 'replace' })
  // 판정을 끝낸 주소 항목 — 같은 항목에서 다시 판정하지 않는다(재조회·다시 그리기).
  const [handledKey, setHandledKey] = useState<string | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)

  // 렌더 중 상태 조정 — 목록이 최신이 된 첫 렌더에서 바로 강조를 켠다(효과에서 켜면 한 번 더 그린다).
  // isFetching 은 && 뒤에 둬 highlight 가 있을 때만 읽는다(TanStack Query 는 읽은 속성만 구독).
  if (raw != null && ready && handledKey !== location.key && !query.isFetching) {
    setHandledKey(location.key)
    const id = parseId(raw)
    if (id != null && files.some((f) => f.id === id)) setFlash({ id, scope })
  }
  // 강조를 켠 뒤 폴더·공간을 옮겼으면 강조를 버린다 — 강조가 있을 때만 도는 조정이라 평소 폴더 이동에는 렌더가 늘지 않는다.
  // 버리지 않고 비교만 하면 몇 초 안에 그 폴더로 돌아왔을 때 다시 그려진 행에서 애니메이션이 처음부터 다시 돈다.
  if (flash != null && flash.scope !== scope) setFlash(null)

  // 판정을 끝낸 항목의 highlight 를 주소에서 지운다 — 잘못된 값·목록에 없는 id 도 원문이 남아 있으면 지운다.
  const pendingClose = raw != null && handledKey === location.key
  useEffect(() => {
    if (pendingClose) close()
  }, [pendingClose, close])

  // 강조가 켜지면 행을 화면 가운데로(움직임 줄이기 설정이면 바로) 옮기고, 애니메이션이 끝날 때 강조를 끈다.
  useEffect(() => {
    if (!flash) return
    const row = document.querySelector(`[data-testid="drive-row-file-${flash.id}"]`)
    if (row) scrollIntoViewCentered(row)
    const t = setTimeout(() => setFlash(null), DRIVE_ROW_HIGHLIGHT_MS)
    return () => clearTimeout(t)
  }, [flash])

  return flash?.scope === scope ? flash.id : null
}
