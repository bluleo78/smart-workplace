// 다른 사람이 먼저 저장했음을 알리는 토스트(WP-2095) — 팀 이슈 상세만 쓴다(개인 작업 패널은 쓰지 않는다).
// 왜: 내가 보고 있는 제목·본문이 남(사람·AI)의 저장으로 조용히 바뀌면 모르고 지나친다. 내 저장이 아닌 version 상승에서
// 제목·본문이 달라졌으면 필드마다 알리고, 「바뀌기 전 보기」로 이전 값을 읽기 전용으로 볼 수 있게 한다.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ISSUE_EDIT_FIELD_LABEL, type IssueEditField, issueEditFieldObject } from '@/components/issue/issueEditField';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { SavedFields } from './useVersionedPatch';

/** 알림 판정에 쓰는 상세의 일부 — projectKey·number 는 같은 이슈인지 가리는 데 쓴다(번호만으로는 WP-12 와 OTHER-12 를 못 가른다). */
interface NoticeSource {
  projectKey?: string;
  number?: number;
  version?: number;
  title?: string;
  body?: string | null;
}

type NoticeField = IssueEditField;

/**
 * data — 지금 보는 상세. ownVersions — 내 저장이 만든 version → 그 저장이 쓴 필드와 값(훅의 savedVersions). isEditing — 그 필드를 내가 편집 중이면 참
 * (편집 중에는 편집기가 충돌·그사이 바뀜 안내를 띄우므로 토스트를 겹치지 않는다). 돌려주는 노드(읽기 전용 대화상자)를 화면에 그린다.
 */
export function useExternalEditNotice(
  data: NoticeSource | undefined,
  ownVersions: () => ReadonlyMap<number, SavedFields>,
  isEditing?: (field: NoticeField) => boolean,
): ReactNode {
  const prev = useRef<NoticeSource | undefined>(undefined);
  const [viewing, setViewing] = useState<{ field: NoticeField; value: string } | null>(null);

  const version = data?.version;
  const title = data?.title;
  const body = data?.body;
  const number = data?.number;
  const projectKey = data?.projectKey;

  useEffect(() => {
    if (version === undefined) return;
    const before = prev.current;
    // 내 저장 직후 캐시는 새 version 만 올라가고 값은 옛 값이다 — 그대로 기준으로 삼으면 다음 version(남의 상태 변경 등)의 refetch 가 가져온
    // 내 값을 「남이 바꿈」으로 오인한다. 내가 저장한 필드는 저장한 값을 기준으로 기록한다.
    const mine = ownVersions().get(version);
    prev.current = {
      projectKey,
      number,
      version,
      title: mine?.title ?? title,
      body: mine?.body ?? body,
    };
    // 첫 로드·다른 이슈로 바뀐 경우는 알리지 않는다.
    if (!before || before.version === undefined || before.number !== number || before.projectKey !== projectKey) return;
    if (version <= before.version) return;
    // 내 저장 version 이어도 일찍 끝내지 않는다 — 그 사이 남이 바꾼 다른 필드가 내 저장 응답에 묻혀 알림이 사라진다. 내가 저장한 필드만 뺀다.
    const changes: [NoticeField, string][] = [];
    if (before.title !== title) changes.push(['title', before.title ?? '']);
    if ((before.body ?? '') !== (body ?? '')) changes.push(['body', before.body ?? '']);
    for (const [field, old] of changes) {
      if ((mine && field in mine) || isEditing?.(field)) continue;
      toast(`다른 사람이 ${issueEditFieldObject(field)} 바꿨습니다`, {
        action: { label: '바뀌기 전 보기', onClick: () => setViewing({ field, value: old }) },
      });
    }
    // ownVersions·isEditing 은 deps 에서 뺀다 — 매 렌더 새로 만들어지는 함수라 넣으면 효과가 매 렌더 돌고, 판정 시점에 최신 값을 읽으면 충분하다(ref·함수 호출).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, number, projectKey, title, body]);

  return (
    <Dialog open={viewing !== null} onOpenChange={(o) => { if (!o) setViewing(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{viewing ? `바뀌기 전 ${ISSUE_EDIT_FIELD_LABEL[viewing.field]}` : ''}</DialogTitle>
          <DialogDescription className="sr-only">다른 사람이 바꾸기 전의 값을 읽기 전용으로 보여 줍니다.</DialogDescription>
        </DialogHeader>
        <pre data-testid="issue-edit-before-value" className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">{viewing?.value}</pre>
      </DialogContent>
    </Dialog>
  );
}
