import { describe, expect, it } from 'vitest'

import type { VirtualAttachment } from '@/types/drive'

import { groupAttachments } from './groupAttachments'

// 테스트용 첨부 팩토리 — attachedAt DESC 정렬 입력을 가정.
function att(p: Partial<VirtualAttachment> & { fileId: number | null }): VirtualAttachment {
  return {
    fileId: p.fileId,
    name: p.name ?? `f${p.fileId}.png`,
    mimeType: p.mimeType ?? 'image/png',
    sizeBytes: p.sizeBytes ?? 100,
    hasThumbnail: p.hasThumbnail ?? true,
    sourceType: p.sourceType ?? 'ISSUE',
    sourceLabel: p.sourceLabel ?? 'PROJ-1 제목',
    deepLink: p.deepLink ?? '/projects/PROJ/issues/1',
    downloadUrl: p.downloadUrl ?? `/api/v1/projects/PROJ/issues/1/attachments/${p.fileId}/content`,
    attachedAt: p.attachedAt ?? '2026-07-01T00:00:00Z',
    kind: p.kind,
    mailAttachmentId: p.mailAttachmentId,
  }
}

describe('groupAttachments', () => {
  it('빈 입력은 빈 배열', () => {
    expect(groupAttachments([])).toEqual([])
  })

  it('sourceType+deepLink 가 같으면 한 그룹, 다르면 분리', () => {
    const items = [
      att({ fileId: 1, deepLink: '/projects/PROJ/issues/1' }),
      att({ fileId: 2, deepLink: '/projects/PROJ/issues/1' }),
      att({ fileId: 3, deepLink: '/projects/PROJ/issues/2', sourceLabel: 'PROJ-2' }),
    ]
    const groups = groupAttachments(items)
    expect(groups).toHaveLength(2)
    expect(groups[0].items.map((i) => i.fileId)).toEqual([1, 2])
    expect(groups[1].items.map((i) => i.fileId)).toEqual([3])
  })

  it('같은 deepLink 라도 sourceType 다르면 분리', () => {
    const items = [
      att({ fileId: 1, sourceType: 'ISSUE', deepLink: '/x' }),
      att({ fileId: 2, sourceType: 'MESSAGE', deepLink: '/x' }),
    ]
    expect(groupAttachments(items)).toHaveLength(2)
  })

  it('그룹 순서 = 첫 등장(최신) 순서, 그룹 내 순서 = 입력 순서 보존', () => {
    const items = [
      att({ fileId: 10, deepLink: '/a', sourceLabel: 'A' }), // 최신
      att({ fileId: 9, deepLink: '/b', sourceLabel: 'B' }),
      att({ fileId: 8, deepLink: '/a', sourceLabel: 'A' }), // a 그룹에 병합(뒤에)
    ]
    const groups = groupAttachments(items)
    expect(groups.map((g) => g.deepLink)).toEqual(['/a', '/b'])
    expect(groups[0].items.map((i) => i.fileId)).toEqual([10, 8])
  })

  it('그룹 key 는 sourceType|deepLink, 라벨/타입 전파', () => {
    const [g] = groupAttachments([att({ fileId: 1, sourceType: 'MESSAGE', sourceLabel: '#general', deepLink: '/chat/channels/5' })])
    expect(g.key).toBe('MESSAGE|/chat/channels/5')
    expect(g.sourceType).toBe('MESSAGE')
    expect(g.sourceLabel).toBe('#general')
    expect(g.deepLink).toBe('/chat/channels/5')
  })

  // WP-1392: 노트(WIKI)·메일(MAIL) 출처도 같은 규칙 — 메일은 fileId 가 없어도 메일(deepLink)별로 묶이고, 이슈 본문 이미지는 이슈 묶음에 든다.
  it('노트·메일·본문 이미지가 섞여도 출처 위치별로 묶인다', () => {
    const items = [
      att({ fileId: 1, sourceType: 'ISSUE', deepLink: '/projects/WP/issues/1' }),
      att({ fileId: null, sourceType: 'MAIL', sourceLabel: '견적 — 김담당', deepLink: '/mail/1?messageId=9', mailAttachmentId: 1 }),
      att({ fileId: 2, sourceType: 'ISSUE', deepLink: '/projects/WP/issues/1', kind: 'BODY_IMAGE' }),
      att({ fileId: 3, sourceType: 'WIKI', sourceLabel: '운영 / 배포', deepLink: '/wiki/spaces/3/pages/7' }),
      att({ fileId: null, sourceType: 'MAIL', sourceLabel: '견적 — 김담당', deepLink: '/mail/1?messageId=9', mailAttachmentId: 2 }),
    ]
    const groups = groupAttachments(items)
    expect(groups.map((g) => g.key)).toEqual(['ISSUE|/projects/WP/issues/1', 'MAIL|/mail/1?messageId=9', 'WIKI|/wiki/spaces/3/pages/7'])
    expect(groups[0].items.map((i) => [i.fileId, i.kind])).toEqual([[1, undefined], [2, 'BODY_IMAGE']])
    expect(groups[1].items.map((i) => i.mailAttachmentId)).toEqual([1, 2])
  })
})
