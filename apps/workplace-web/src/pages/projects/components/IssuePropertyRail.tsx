// 이슈 상세 우측 속성 레일 — 3개 접기 그룹으로 속성을 구조화.
// 무엇을: 상태·담당 / 일정 / 분류·관계 3그룹 + 첨부·활동 (임시 하단 배치).
// 왜: 9개 속성이 단일 스크롤에 나열되어 과밀한 기존 aside 를 해소(#343).

import { CyclePickerPopover } from '../../../components/cycle/CyclePickerPopover';
import { LabelChip } from '../../../components/labels/LabelChip';
import { LabelPickerPopover } from '../../../components/labels/LabelPickerPopover';
import { AgentBadge } from '../../../components/users/AgentBadge';
import { UserAvatar } from '../../../components/users/UserAvatar';
import type { IssueFieldEntry } from '../../../types/customField';
import type { IssueLinkSummary, IssuePriority, IssueStatus, ParentRef, UpdateIssueRequest } from '../../../types/issue';
import type { IssueHistoryEntry } from '../../../types/issue';
import type { LabelSummary } from '../../../types/label';
import type { UserSummary } from '../../../types/user';
import { AssigneePickerPopover } from './AssigneePickerPopover';
import { CustomFieldsSection } from './CustomFieldsSection';
import { DueDatePickerPopover } from './DueDatePickerPopover';
import { IssueActivityTimeline } from './IssueActivityTimeline';
import { IssueAttachmentDropzone } from './IssueAttachmentDropzone';
import { IssueAttachmentList } from './IssueAttachmentList';
import { IssueDependenciesSection } from './IssueDependenciesSection';
import { IssueParentSlot } from './IssueParentSlot';
import { IssuePrioritySelect } from './IssuePrioritySelect';
import { IssuePropertyGroup } from './IssuePropertyGroup';
import { IssueStatusSelect } from './IssueStatusSelect';

// 속성 레일이 받는 props — 기존 aside 가 사용하던 summary.* 값 그대로 전달.
interface IssuePropertyRailProps {
  projectKey: string;
  issueNumber: number;
  issueId: number;            // summary.id
  isSubtask: boolean;
  parent: ParentRef | null;   // summary.parent
  status: IssueStatus;        // summary.status
  priority: IssuePriority;    // summary.priority
  dueDate: string | null;     // summary.dueDate
  assignees: UserSummary[];   // summary.assignees
  labels: LabelSummary[];     // summary.labels
  blockedBy: IssueLinkSummary[];  // summary.blockedBy
  blocks: IssueLinkSummary[];     // summary.blocks
  customFields: IssueFieldEntry[];    // summary.customFields
  updatePending: boolean;     // update.isPending
  onPatch: (changes: UpdateIssueRequest) => void;
  // 첨부 섹션용 (임시 — Task 2 에서 본문으로 이동)
  attachmentCount: number;    // summary.attachmentCount
  currentUserId: number | null;
  isOwner: boolean;
  // 활동 섹션용 (임시 — Task 4 에서 탭으로 이동)
  history: IssueHistoryEntry[];
}

export function IssuePropertyRail({
  projectKey,
  issueNumber,
  isSubtask,
  parent,
  status,
  priority,
  dueDate,
  assignees,
  labels,
  blockedBy,
  blocks,
  customFields,
  updatePending,
  onPatch,
  attachmentCount,
  currentUserId,
  isOwner,
  history,
}: IssuePropertyRailProps) {
  // 분류·관계 그룹 배지 — 라벨 + 의존성(양방향) + 커스텀 필드 합산.
  const classificationCount =
    labels.length + blockedBy.length + blocks.length + (customFields?.length ?? 0);

  return (
    <div className="space-y-2">
      {/* SUBTASK 상세에서만 부모 슬롯 노출 */}
      {isSubtask && (
        <IssueParentSlot
          projectKey={projectKey}
          issueNumber={issueNumber}
          parent={parent}
        />
      )}

      {/* 그룹 1: 상태·담당 — 기본 펼침 */}
      <IssuePropertyGroup
        title="상태·담당"
        storageKey="issue-rail:status-people"
        defaultOpen={true}
        testId="property-group-status-people"
      >
        <div className="space-y-1" data-testid="issue-status-select">
          <label className="text-xs font-medium text-muted-foreground">상태</label>
          <IssueStatusSelect
            value={status}
            onChange={(v) => onPatch({ status: v })}
            disabled={updatePending}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">우선순위</label>
          <IssuePrioritySelect
            value={priority}
            onChange={(v) => onPatch({ priority: v })}
            disabled={updatePending}
          />
        </div>
        <section aria-label="담당자" className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">담당자</span>
            <AssigneePickerPopover
              projectKey={projectKey}
              issueNumber={issueNumber}
              current={assignees}
            />
          </div>
          <div className="flex flex-wrap gap-2" data-testid="issue-assignees">
            {assignees.length === 0 ? (
              <span className="text-xs text-muted-foreground">미지정</span>
            ) : (
              assignees.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 text-sm"
                  data-testid={`issue-assignee-${u.id}`}
                >
                  <UserAvatar user={u} size="sm" />
                  <span>{u.name}</span>
                  {u.kind === 'AGENT' && <AgentBadge size="xs" />}
                </span>
              ))
            )}
          </div>
        </section>
      </IssuePropertyGroup>

      {/* 그룹 2: 일정 — 기본 펼침 */}
      <IssuePropertyGroup
        title="일정"
        storageKey="issue-rail:planning"
        defaultOpen={true}
        testId="property-group-planning"
      >
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">마감일</span>
          <DueDatePickerPopover
            value={dueDate}
            disabled={updatePending}
            onChange={(date) =>
              onPatch({
                dueDate: date,
                clearDueDate: !date,
              })
            }
          />
        </div>
        {/* 사이클 피커 — 이슈에 연결된 사이클 조회·변경 */}
        <section data-testid="issue-cycles-section">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">사이클</h3>
          <CyclePickerPopover projectKey={projectKey} issueNumber={issueNumber} />
        </section>
      </IssuePropertyGroup>

      {/* 그룹 3: 분류·관계 — 기본 접힘, 비어있지 않으면 배지 표시 */}
      <IssuePropertyGroup
        title="분류·관계"
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
        {/* Phase 4b — 의존성 두 슬롯(차단됨/차단 중) + Picker */}
        <IssueDependenciesSection
          projectKey={projectKey}
          issueNumber={issueNumber}
          blockedBy={blockedBy}
          blocks={blocks}
        />
        {/* Phase 4c — 프로젝트 커스텀 필드 인라인 편집 */}
        <CustomFieldsSection
          projectKey={projectKey}
          issueNumber={issueNumber}
          current={customFields}
        />
      </IssuePropertyGroup>

      {/* 첨부 섹션 — 임시 하단 배치, Task 2 에서 본문으로 이동 */}
      <section aria-label="첨부" className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">첨부</span>
          <span className="text-xs text-muted-foreground">
            {attachmentCount}/10
          </span>
        </div>
        <IssueAttachmentDropzone
          projectKey={projectKey}
          number={issueNumber}
          currentCount={attachmentCount}
          disabled={attachmentCount >= 10}
        />
        <IssueAttachmentList
          projectKey={projectKey}
          number={issueNumber}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />
      </section>

      {/* 활동 섹션 — 임시 하단 배치, Task 4 에서 탭으로 이동 */}
      <div>
        <h3 className="text-sm font-semibold mb-2">활동</h3>
        <IssueActivityTimeline entries={history} />
      </div>
    </div>
  );
}
