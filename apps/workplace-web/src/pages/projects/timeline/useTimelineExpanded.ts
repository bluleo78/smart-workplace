// 타임라인 에픽 그룹 펼침 상태 — 프로젝트별 localStorage 지속(#649). 데스크톱 간트와 모바일 아젠다(WP-251)가
// 같은 키·같은 그룹 키(epicGroupKey)를 써서 한 기기 안에서 펼친 에픽이 양쪽에 똑같이 보인다.
// "펼친 것만 저장" 모델 — 빈 목록이면 모든 그룹이 접힘이 기본이다(사용자 요청).
import { useMemo, useState } from 'react';

export function useTimelineExpanded(projectKey: string) {
  const storageKey = `timeline-expanded:${projectKey}`;
  // 저장소 접근은 사생활 보호 모드 등에서 throw 할 수 있어 읽기·쓰기 모두 감싼다 — 실패하면 이번 화면에서만 유지.
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const toggle = (groupKey: string, open: boolean) => {
    setExpandedKeys((prev) => {
      const next = open ? [...new Set([...prev, groupKey])] : prev.filter((k) => k !== groupKey);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // 저장 실패는 무시 — 화면 상태는 위 setState 로 이미 반영된다.
      }
      return next;
    });
  };
  const expandedSet = useMemo(() => new Set(expandedKeys), [expandedKeys]);
  /** 그룹 키가 펼쳐져 있는지 — null(에픽 없음)은 항상 false. */
  const isOpen = (groupKey: string | null) => groupKey != null && expandedSet.has(groupKey);
  return { expandedKeys, isOpen, toggle };
}
