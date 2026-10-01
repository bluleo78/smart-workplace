// 이슈 채팅 드로워 열림 상태를 URL(`?chat=1`)에 두는 훅(H2).
// 왜: 모바일에서 드로워는 화면 전체를 덮는 "한 단계 깊은 화면"이라, 시스템 뒤로가기(안드로이드 back·iOS 스와이프)가
// 이슈 상세를 떠나지 않고 드로워만 닫아야 한다. 열 때 히스토리 항목을 하나 쌓고, 닫을 때 그 항목을 되돌린다.
// 데스크톱도 같은 규칙을 쓴다 — 새로고침·링크 공유 시 드로워가 열린 채 복원되고, 뒤로가기도 드로워부터 닫는다.
// 경로(pathname)는 그대로라 #885 출발 화면 기록(useIssueOriginTracker)은 두 항목 모두 "이슈 상세"로 보고 함께 건너뛴다.
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const PARAM = 'chat';
// 이 탭에서 "열기"로 직접 쌓은 항목인지 표식 — 딥링크(`?chat=1` 로 진입)는 되돌릴 이전 항목이 없으므로 교체로 닫는다.
const PUSHED_MARK = 'issueChatPushed';

type RouterState = Record<string, unknown> | null;

export function useIssueChatDrawerParam(): { open: boolean; openChat: () => void; closeChat: () => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const open = new URLSearchParams(location.search).get(PARAM) === '1';
  // 같은 항목에서 닫기가 두 번 불리면(‹ 연타·ESC+onOpenChange) navigate(-1) 이 두 번 나가 출발 화면까지 빠진다 — 한 번만.
  // 가드는 "지금 이 항목에서 이미 닫기를 보냈다"만 뜻한다 — 항목이 바뀌면(닫힘 되돌림·앞으로가기로 다시 열림) 푼다.
  // 풀지 않으면 앞으로가기로 같은 항목(같은 key)에 돌아왔을 때 닫기가 영영 무시된다(C1).
  // 두 번 연달아 불린 닫기는 popstate 로 key 가 바뀌기 전에 모두 도착하므로 중복 방지는 그대로 유지된다.
  const closedKey = useRef<string | null>(null);
  useEffect(() => {
    closedKey.current = null;
  }, [location.key]);

  const openChat = useCallback(() => {
    if (open) return;
    const params = new URLSearchParams(location.search);
    params.set(PARAM, '1');
    const prev = location.state && typeof location.state === 'object' ? (location.state as RouterState) : null;
    navigate({ search: `?${params}`, hash: location.hash }, { state: { ...prev, [PUSHED_MARK]: true } });
  }, [open, location.search, location.hash, location.state, navigate]);

  const closeChat = useCallback(() => {
    if (!open || closedKey.current === location.key) return;
    closedKey.current = location.key;
    if ((location.state as RouterState)?.[PUSHED_MARK]) {
      navigate(-1);
      return;
    }
    // 딥링크로 열린 경우 — chat 만 지우고 다른 쿼리(필터 등)는 보존해 같은 항목을 교체한다.
    const params = new URLSearchParams(location.search);
    params.delete(PARAM);
    const search = params.toString();
    navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [open, location.key, location.search, location.hash, location.state, navigate]);

  return { open, openChat, closeChat };
}
