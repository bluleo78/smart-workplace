// 이슈 상세 우측 속성 레일 — 3개 접기 그룹으로 속성을 구조화.
// 무엇을: 상태·담당 / 일정 / 분류·관계 3그룹.
// 왜: 9개 속성이 단일 스크롤에 나열되어 과밀한 기존 aside 를 해소(#343).
// 첨부 섹션은 Task 2 에서, 활동 섹션은 Task 3 에서 본문 탭으로 이동 완료.

import { CyclePickerPopover } from '../../../components/cycle/CyclePickerPopover';
import { AiClassifyButton } from '../../../components/issue/AiClassifyButton';
import { LabelChip } from '../../../components/labels/LabelChip';
import { LabelPickerPopover } from '../../../components/labels/LabelPickerPopover';
import type { IssueFieldEntry } from '../../../types/customField';
import type { IssueLinkSummary, IssuePriority, IssueStatus, ParentRef, UpdateIssueRequest } from '../../../types/issue';
import type { LabelSummary } from '../../../types/label';
import type { UserSummary } from '../../../types/user';
import { AssigneePickerPopover } from './AssigneePickerPopover';
import { CustomFieldsSection } from './CustomFieldsSection';
import { DatePickerPopover } from './DatePickerPopover';
import { DueDatePickerPopover } from './DueDatePickerPopover';
import { IssueDependenciesSection } from './IssueDependenciesSection';
import { IssueParentSlot } from './IssueParentSlot';
import { IssuePrioritySelect } from './IssuePrioritySelect';
import { IssuePropertyGroup } from './IssuePropertyGroup';
import { IssueReporterField } from './IssueReporterField';
import { IssueStatusSelect } from './IssueStatusSelect';
import { MilestonePickerPopover } from './MilestonePickerPopover';

// 속성 레일이 받는 props — 기존 aside 가 사용하던 summary.* 값 그대로 전달.
interface IssuePropertyRailProps {
  projectKey: string;
  issueNumber: number;
  isSubtask: boolean;
  isEpic: boolean;
  parent: ParentRef | null;   // summary.parent
  status: IssueStatus;        // summary.status
  priority: IssuePriority;    // summary.priority
  dueDate: string | null;     // summary.dueDate
  startDate: string | null;   // summary.startDate — 타임라인 간트 뷰 시작일 (#620)
  milestoneId: number | null; // summary.milestoneId
  assignees: UserSummary[];   // summary.assignees
  reporter: UserSummary | null | undefined; // 상세 응답 reporter (WP-272)
  createdAt: string;          // summary.createdAt — 보고자 옆 생성일
  labels: LabelSummary[];     // summary.labels
  blockedBy: IssueLinkSummary[];  // summary.blockedBy
  blocks: IssueLinkSummary[];     // summary.blocks
  customFields: IssueFieldEntry[];    // summary.customFields
  updatePending: boolean;     // update.isPending
  onPatch: (changes: UpdateIssueRequest) => void;
  /** 서버 플래그 — 상태·우선순위·담당자·마감일·사이클 편집 가능 여부(멤버만). */
  canEditWorkflow?: boolean;
  /** AI 분류 제안 버튼 — undefined 이면 렌더 안 함 */
  onAiClassify?: () => void;
  isAiClassifying?: boolean;
  aiClassifyReason?: string | null;
  /** sheet = 모바일 ＋ 속성 시트(WP-196): 칩과 겹치는 상태·우선순위·담당자·마감을 숨기고, 부모 슬롯은 SUBTASK 만 노출. 기본 rail(데스크톱). */
  variant?: 'rail' | 'sheet';
}

export function IssuePropertyRail({
  projectKey,
  issueNumber,
  isSubtask,
  isEpic,
  parent,
  status,
  priority,
  dueDate,
  startDate,
  milestoneId,
  assignees,
  reporter,
  createdAt,
  labels,
  blockedBy,
  blocks,
  customFields,
  updatePending,
  onPatch,
  canEditWorkflow = false, // 안전 방향 기본값 — 호출자는 항상 명시적으로 전달
  onAiClassify,
  isAiClassifying,
  aiClassifyReason,
  variant = 'rail',
}: IssuePropertyRailProps) {
  // AI 분류 제안 버튼 — 레일(상태·담당 그룹 맨 아래, 구분선 뒤)과 시트(단독) 두 위치가 같은 버튼을 쓴다. 핸들러가 없으면 렌더하지 않는다.
  const aiButton = onAiClassify !== undefined && (
    <AiClassifyButton
      hasTitle={true}
      isPending={isAiClassifying ?? false}
      reason={aiClassifyReason}
      onClick={onAiClassify}
      fullWidth
    />
  );
  // 분류 그룹 배지 — 라벨 수.
  const classificationCount = labels.length;
  // 커스텀 필드 그룹 배지 — 값이 채워진 필드 수는 섹션이 자체 관리하므로 정의 수 기준.
  const customFieldCount = customFields.length;
  // 의존성 그룹 배지 — 차단됨 + 차단 중(양방향) 합산.
  const dependencyCount = blockedBy.length + blocks.length;

  // 의존성 일정 모순 soft 경고(#669) — 미완료(DONE/CANCELED 아님) 선행 이슈 중 가장 늦은 마감일을
  // 구해, 시작일/마감일이 그보다 이르면 인라인 경고를 띄운다. 저장 자체는 차단하지 않는다(정책 결정).
  const latestActiveBlockerDueDate = blockedBy
    .filter((l) => l.status !== 'DONE' && l.status !== 'CANCELED' && l.dueDate)
    .reduce<string | null>(
      (latest, l) => (latest === null || (l.dueDate as string) > latest ? (l.dueDate as string) : latest),
      null,
    );
  const dateWarning = (date: string | null): string | null =>
    latestActiveBlockerDueDate && date && date < latestActiveBlockerDueDate
      ? `선행 이슈가 아직 진행 중이며 마감일(${latestActiveBlockerDueDate})이 더 늦습니다.`
      : null;

  return (
    <div className="space-y-3" data-testid="property-rail">
      {/* EPIC 은 부모를 가질 수 없으므로 슬롯 자체를 노출하지 않음.
          SUBTASK/일반 이슈는 각각 "부모"/"상위 에픽" 문구로 슬롯 노출(Task 6). */}
      {!isEpic && (variant === 'rail' || isSubtask) && (
        <IssueParentSlot
          projectKey={projectKey}
          issueNumber={issueNumber}
          parent={parent}
          isSubtask={isSubtask}
        />
      )}

      {/* 그룹 1: 상태·담당 — 기본 펼침. 시트에선 칩과 겹치므로 AI 분류 버튼만 남긴다. */}
      {variant === 'rail' ? (
        <IssuePropertyGroup
          title="상태·담당"
          storageKey="issue-rail:status-people"
          defaultOpen={true}
          testId="property-group-status-people"
        >
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">상태</label>
            <IssueStatusSelect
              value={status}
              onChange={(v) => onPatch({ status: v })}
              disabled={updatePending || !canEditWorkflow}
              blockedBy={blockedBy}
              projectKey={projectKey}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">우선순위</label>
            <IssuePrioritySelect
              value={priority}
              onChange={(v) => onPatch({ priority: v })}
              disabled={updatePending || !canEditWorkflow}
            />
          </div>
          {/* 담당자 — 라벨 + 인라인 필드(값 표시 겸 클릭 트리거). 칩/미지정은 필드 내부에서 렌더. */}
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">담당자</span>
            <AssigneePickerPopover
              projectKey={projectKey}
              issueNumber={issueNumber}
              current={assignees}
              disabled={updatePending || !canEditWorkflow}
            />
          </div>
          {/* 보고자 — 읽기 전용(WP-272). 구버전 서버 응답(reporter 없음)이면 필드가 스스로 숨는다. */}
          <IssueReporterField reporter={reporter} createdAt={createdAt} layout="rail" />
          {/* AI 분류 제안 — 섹션 가장 아래(목업 배치). 구분선 후 full-width. */}
          {aiButton && (
            <>
              <div className="border-t" />
              {aiButton}
            </>
          )}
        </IssuePropertyGroup>
      ) : (
        aiButton
      )}

      {/* 그룹 2: 일정 — 기본 펼침 */}
      <IssuePropertyGroup
        title="일정"
        storageKey="issue-rail:planning"
        defaultOpen={true}
        testId="property-group-planning"
      >
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">시작일</span>
          <DatePickerPopover
            value={startDate}
            testIdPrefix="start-date"
            ariaLabel="시작일 선택"
            clearAriaLabel="시작일 지우기"
            disabled={updatePending || !canEditWorkflow}
            warningText={dateWarning(startDate)}
            onChange={(date) =>
              onPatch({
                startDate: date,
                clearStartDate: !date,
              })
            }
          />
        </div>
        {variant === 'rail' && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">마감일</span>
            <DueDatePickerPopover
              value={dueDate}
              disabled={updatePending || !canEditWorkflow}
              warningText={dateWarning(dueDate)}
              onChange={(date) =>
                onPatch({
                  dueDate: date,
                  clearDueDate: !date,
                })
              }
            />
          </div>
        )}
        {/* 사이클 피커 — 이슈에 연결된 사이클 조회·변경 */}
        <section data-testid="issue-cycles-section">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">사이클</h3>
          <CyclePickerPopover projectKey={projectKey} issueNumber={issueNumber} />
        </section>
        {/* 마일스톤 피커 — 이슈당 단일 마일스톤 연결(#620) */}
        <section data-testid="issue-milestone-section">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">마일스톤</h3>
          <MilestonePickerPopover
            projectKey={projectKey}
            value={milestoneId}
            disabled={updatePending || !canEditWorkflow}
            onChange={(id) =>
              onPatch(id === null ? { clearMilestone: true } : { milestoneId: id })
            }
          />
        </section>
      </IssuePropertyGroup>

      {/* 그룹 3: 분류 — 라벨. 기본 접힘, 비어있지 않으면 배지 표시 */}
      <IssuePropertyGroup
        title="분류"
        storageKey="issue-rail:classification"
        defaultOpen={false}
        count={classificationCount}
        testId="property-group-classification"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">라벨</span>
            <LabelPickerPopover
              projectKey={projectKey}
              issueNumber={issueNumber}
              current={labels}
            />
          </div>
          <div className="flex flex-wrap gap-1" data-testid="issue-labels">
            {labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
            {labels.length === 0 && (
              <span className="text-xs text-muted-foreground">없음</span>
            )}
          </div>
        </div>
      </IssuePropertyGroup>

      {/* 그룹 4: 의존성 — 차단됨/차단 중 두 슬롯(커스텀 필드보다 앞). 기본 접힘, 비어있지 않으면 배지 표시 */}
      <IssuePropertyGroup
        title="의존성"
        storageKey="issue-rail:dependencies"
        defaultOpen={false}
        count={dependencyCount}
        testId="property-group-dependencies"
      >
        <IssueDependenciesSection
          projectKey={projectKey}
          issueNumber={issueNumber}
          blockedBy={blockedBy}
          blocks={blocks}
        />
      </IssuePropertyGroup>

      {/* 그룹 5: 커스텀 필드 — 프로젝트 커스텀 필드 인라인 편집(Phase 4c). 기본 접힘 */}
      <IssuePropertyGroup
        title="커스텀 필드"
        storageKey="issue-rail:custom-fields"
        defaultOpen={false}
        count={customFieldCount}
        testId="property-group-custom-fields"
      >
        <CustomFieldsSection
          projectKey={projectKey}
          issueNumber={issueNumber}
          current={customFields}
        />
      </IssuePropertyGroup>

    </div>
  );
}
