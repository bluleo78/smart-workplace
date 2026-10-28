// 이슈 상세의 「수정 버전」·「영향 버전」 줄(WP-888) — 칩 목록 + 「＋」 피커(값이 없으면 줄 전체 「＋ 추가」, WP-1079). 속성 레일 구성요소 줄 바로 아래(모바일 속성 시트에선 단독)에 놓인다.
// 보관 안 된 버전이 없는 프로젝트에선 그리지 않고, 보관된 버전만 붙은 이슈는 값만 읽기 전용으로 보인다(showVersionField).
// 두 종류는 한 PUT 으로 저장하지만 보낸 종류만 바뀐다 — 한 줄을 고쳐도 다른 줄을 덮어쓰지 않는다.

import { useUpdateIssueVersions, useVersions } from '../../hooks/queries/useVersions';
import { showVersionField } from '../../lib/issueVersions';
import type { VersionSummary } from '../../types/version';
import { PropertyChipRow } from '../issue/PropertyChipRow';
import { VersionChip } from './VersionChip';
import { VersionPickerPopover } from './VersionPickerPopover';

const KIND = {
  fix: { label: '수정 버전', body: 'fixVersionIds' },
  affects: { label: '영향 버전', body: 'affectsVersionIds' },
} as const;

export function IssueVersionsField({
  projectKey,
  issueNumber,
  kind,
  current,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  /** fix = 수정 버전(이 버전에 나가는 것), affects = 영향 버전(이 버전에서 난 결함). */
  kind: 'fix' | 'affects';
  /** 이슈에 붙은 버전(목록 순서). */
  current: VersionSummary[];
  /** 워크플로 편집 권한 없음 — 고르기를 숨긴다(값은 보인다). */
  disabled?: boolean;
}) {
  const versions = useVersions(projectKey);
  const update = useUpdateIssueVersions(projectKey, issueNumber);
  // 목록을 받기 전엔 판정하지 않는다 — 버전을 안 쓰는 프로젝트에서 줄이 잠깐 떴다 사라지지 않게.
  if (!versions.isSuccess) return null;
  const mode = showVersionField(versions.data, current);
  if (mode === 'hidden') return null;
  const { label, body } = KIND[kind];
  return (
    <PropertyChipRow
      label={label}
      testId={`issue-${kind}-versions-field`}
      valuesTestId={`issue-${kind}-versions`}
      empty={current.length === 0}
      // 권한이 없거나 보관된 값만 붙었으면 고르기 없이 값만.
      picker={
        mode === 'edit' && !disabled
          ? (trigger) => (
              <VersionPickerPopover
                versions={versions.data}
                value={current.map((v) => v.id)}
                onCommit={(ids) => update.mutate({ [body]: ids })}
                ariaLabel={label}
                testIdPrefix={`${kind}-version`}
                trigger={trigger}
              />
            )
          : undefined
      }
    >
      {current.map((v) => (
        <VersionChip key={v.id} version={v} projectKey={projectKey} />
      ))}
    </PropertyChipRow>
  );
}
