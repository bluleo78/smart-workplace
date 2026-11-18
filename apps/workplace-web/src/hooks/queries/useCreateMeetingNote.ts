// 일정 회의록 노트 만들기 흐름(WP-1702) — 노트 만들기 → 틀(본문) 심기 → 일정에 잇기 → 결과 토스트.
// 기존 일정(일정 창이 바로)과 새 일정(CalendarPage 가 저장 뒤)이 같은 순서·같은 문구를 쓰도록 한 훅에 모은다.
// 회의록 위치 기억도 여기서 한다 — 노트가 실제로 만들어진 뒤에만 기억해야 해서(창에서 정해 두기만 한 새 일정은 기억하지 않는다).
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { wikiApi } from '../../api/wiki'
import { wikiSpacePagePath } from '../../lib/appUrl'
import { type MeetingNoteDraft, saveMeetingNoteLocation } from '../../lib/meetingNote'
import type { WikiPageDetail } from '../../types/wiki'
import { useAuth } from '../useAuth'
import { wikiKeys } from './wikiKeys'

export function useCreateMeetingNote() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { user, activeTenant } = useAuth()

  /**
   * 노트를 만들고 틀을 심는다 — 만들기 실패는 그대로 던진다(부르는 쪽이 창 안·토스트로 알린다).
   * 만들어지면 그 자리를 다음 회의록 위치로 기억한다(잇기 결과와 무관 — 노트는 그 자리에 생겼다).
   * 심기만 실패하면 노트는 이미 있으므로 경고만 하고 빈 노트로 계속한다 — 실패로 돌리면 다시 누를 때 노트가 하나 더 생긴다.
   */
  async function create(draft: MeetingNoteDraft): Promise<WikiPageDetail> {
    const page = (await wikiApi.createPage(draft.spaceId, draft.parentId, draft.title)).data
    saveMeetingNoteLocation({ userId: user?.id ?? 0, tenantId: activeTenant?.tenantId ?? null }, { spaceId: draft.spaceId, parentId: draft.parentId })
    // 노트 트리(사이드바·위치 고르기 창)가 새 노트를 보게
    void qc.invalidateQueries({ queryKey: wikiKeys.tree(draft.spaceId) })
    try {
      await wikiApi.seedPageBody(page.id, draft.markdown, page.version)
    } catch {
      toast.warning('회의록 틀을 넣지 못했습니다')
    }
    return page
  }

  /**
   * 만든 노트를 일정에 잇고 결과를 토스트로 알린다 — 둘 다 「열기」로 노트로 갈 수 있다.
   * 잇기만 실패해도 노트는 지우지 않는다(사람이 직접 잇거나 쓸 수 있게).
   */
  async function linkAndNotify(spaceId: number, pageId: number, link: () => Promise<unknown>): Promise<void> {
    const open = { label: '열기', onClick: () => navigate(wikiSpacePagePath(spaceId, pageId)) }
    try {
      await link()
      toast.success('회의록 만듦', { action: open })
    } catch {
      toast.error('노트는 만들었지만 연결하지 못함', { action: open })
    }
  }

  return { create, linkAndNotify }
}
