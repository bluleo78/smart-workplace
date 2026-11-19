// 임시보관 딥링크 받기(WP-1786) — 메일 화면 주소에 ?draftId=N 이 있으면 그 임시보관을 메인 창의 쓰기 창으로 열고 주소에서 키를 뗀다.
// 메일 보내기 실패 알림(인박스·홈 알림 위젯)이 이 주소로 보낸다. 쓰기 창(MailComposeDock)이 앱 셸에 있으므로 AppLayout 에 한 번 둔다.
// 메일 화면(/mail, /mail/:accountId)일 때만 받는다 — /mail 은 첫 계정으로 다시 보내는데, 그 이동이 쿼리를 버려도 이 컴포넌트가 먼저 읽은 값으로 연다.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useOpenMailDraft } from '@/hooks/queries/useMailDrafts';
import { useLatest } from '@/hooks/useLatest';
import { takeDraftIdParam } from '@/lib/mailDraftLink';

export function MailDraftDeepLink() {
  const location = useLocation();
  const navigate = useNavigate();
  const openDraft = useOpenMailDraft();
  // openDraft 는 렌더마다 새 함수라 최신 것을 ref 로 읽는다(주소가 바뀔 때만 effect 가 돈다).
  const openRef = useLatest(openDraft);

  useEffect(() => {
    if (location.pathname !== '/mail' && !location.pathname.startsWith('/mail/')) return;
    const taken = takeDraftIdParam(location.search);
    if (!taken) return;
    // 키를 먼저 떼어(replace — 뒤로 가기에 남지 않게) 다시 그려도 두 번 열지 않는다.
    navigate({ pathname: location.pathname, search: taken.search, hash: location.hash }, { replace: true });
    // 쓰던 메일을 다시 여는 길이라 작성 방식 기본값(placement)을 넘기지 않는다(useOpenMailDraft 규칙). 못 받으면 훅이 토스트로 알린다.
    void openRef.current(taken.draftId);
    // openRef 는 useLatest 가 돌려주는 같은 ref 라 의존성에 넣어도 주소가 바뀔 때만 돈다.
  }, [location.pathname, location.search, location.hash, navigate, openRef]);

  return null;
}
