// 버전 화면 컨텍스트 builder(WP-888) — 버전 상세에서 AI 가 「이 버전」이 무엇인지 알게 이름·상태·기간·진행을 싣는다.
// refs 의 fixVersion 은 이슈 목록 조회 도구의 인자 이름과 같아, AI 가 그대로 이 버전의 이슈를 찾는다.
import { daysLeftLabel } from '@/lib/versions';
import type { AiScreenContext } from '@/types/aiScreenContext';
import { VERSION_STATUS_LABEL, type VersionResponse } from '@/types/version';

import { buildFacts, buildRefs, clip, LIMITS } from '../common';

export function buildVersionDetailContext({
  projectKey,
  version,
  today,
}: {
  projectKey: string;
  version: VersionResponse;
  /** 오늘(yyyy-MM-dd, KST) — 「N일 남음」 계산용. */
  today: string;
}): AiScreenContext {
  const { done, inProgress, todo } = version.progress;
  const total = done + inProgress + todo;
  return {
    view: '버전 상세',
    app: 'ISSUE',
    focus: {
      type: '버전',
      label: clip(version.name, LIMITS.label),
      refs: buildRefs({ projectKey, fixVersion: version.name }),
      facts: buildFacts([
        ['상태', VERSION_STATUS_LABEL[version.status]],
        ['시작일', version.startDate],
        ['출시일', version.releaseDate],
        ['기간', daysLeftLabel(version, today)],
        ['진행', total > 0 ? `${done}/${total} 완료` : null],
        ['영향 버전 이슈', version.affectsCount > 0 ? `${version.affectsCount}건` : null],
        ['설명', version.description],
      ]),
    },
    scope: { label: `프로젝트 ${projectKey}`, refs: buildRefs({ projectKey }) },
  };
}
