package com.workplace.issue.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;

import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.dto.StatusDeletionImpact;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.StatusLastInCategoryException;
import com.workplace.issue.exception.StatusMoveTargetRequiredException;
import com.workplace.issue.exception.StatusNotFoundException;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueRepository.MigratedIssue;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.view.repository.SavedViewRepository;
import com.workplace.view.service.SavedViewQueries;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 상태 삭제와 이슈 이전(WP-809). 상태를 지우면 그 상태의 이슈(휴지통 포함)를 다른 상태로 옮기고, 저장된 뷰의 상태 필터를 맞추고, 이력·감사 로그를 남긴
 * 뒤 상태 행을 지운다 — 모두 한 트랜잭션이라 어디서 실패해도 아무것도 바뀌지 않는다.
 *
 * <p>이전은 「조용한」 설정 정리다. 사용자가 이슈를 바꾼 것이 아니므로 이슈의 updated_at·version 을 올리지 않고, 상태 변경 알림·ai-agent 발사·이슈
 * 실시간 무효화도 내지 않는다(이슈마다 알림이 쏟아지지 않게). 대신 이슈 이력에 STATUS_MIGRATED 를 남기고, 범주가 바뀌는 데 따른 규칙(종료 시각·AI 작업
 * 종료·완료 에픽 불변식)은 이슈 수정 경로와 같게 지킨다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ProjectStatusDeletionService {

  private final ProjectStatusRepository statusRepository;
  private final IssueRepository issueRepository;
  private final IssueHistoryRepository historyRepository;
  private final SavedViewRepository savedViewRepository;
  private final AgentWorkService agentWorkService;
  private final ProjectAccessGuard accessGuard;
  private final ProjectChangeNotifier changeNotifier;
  private final ProjectStatusAudit audit;

  /**
   * 삭제 영향 — 삭제 확인 창이 버튼 문구(이슈 N개)·옮길 상태 필수 여부·저장된 뷰 안내·에픽 차단 경고를 고르는 근거. 프로젝트를 볼 수 있으면 조회할 수 있다(삭제
   * 자체는 OWNER).
   */
  @Transactional(readOnly = true)
  public StatusDeletionImpact impact(Long callerId, String projectKey, long statusId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var status = statusInProject(project, statusId);
    var queries =
        savedViewRepository.findByProject(project.id()).stream().map(v -> v.query()).toList();
    int savedViewCount =
        (int) queries.stream().filter(q -> SavedViewQueries.references(q, status.id())).count();
    int emptied =
        (int)
            queries.stream()
                .filter(q -> SavedViewQueries.emptiesStatusFilter(q, status.id()))
                .count();
    return new StatusDeletionImpact(
        issueRepository.countActiveByStatus(project.id(), status.id()),
        savedViewCount,
        issueRepository.countEpicsWithIncompleteChildrenOutside(project.id(), status.id()),
        emptied);
  }

  /**
   * 상태 삭제 — OWNER, 개인 프로젝트 불가. 검증(범주의 마지막 상태·옮길 상태·에픽 차단)을 모두 마친 뒤에만 쓴다.
   *
   * @param moveTo 이슈를 옮길 상태. 활성 이슈가 있으면 필수. 없고 휴지통 이슈만 있으면 같은 범주의 기본 상태(지우는 것이 기본이면 다음 상태)로 옮긴다 —
   *     휴지통 이슈가 FK 로 상태 행을 잡고 있어 그대로는 지울 수 없다.
   */
  public void delete(Long callerId, String projectKey, long statusId, Long moveTo) {
    var project = ProjectStatusService.assertEditable(accessGuard, projectKey, callerId);
    // 추가·이름 변경·순서 변경과 같은 잠금으로 직렬화한 뒤 다시 읽는다 — 동시에 같은 범주의 다른 상태가 지워져 범주가 비는 일을 막는다.
    statusRepository.lockByProject(project.id());
    List<ProjectStatusRow> statuses = statusRepository.findByProject(project.id());
    var status =
        statuses.stream()
            .filter(s -> s.id() == statusId)
            .findFirst()
            .orElseThrow(StatusNotFoundException::new);
    // 이 상태로 이슈를 넣거나 옮기는 동시 쓰기가 이전과 삭제 사이에 끼어들지 못하게 행 자체를 잠근다(FK 검사와 충돌하는 잠금).
    statusRepository.lockForDelete(status.id());

    // 1) 범주의 마지막 상태는 지울 수 없다 — 범주 기본 상태가 사라진다. 같은 범주의 남는 상태는 표시 순서(position)라 첫 번째가 새 기본 상태다.
    var sameCategoryRest =
        statuses.stream()
            .filter(s -> s.category().equals(status.category()) && s.id() != statusId)
            .toList();
    if (sameCategoryRest.isEmpty()) {
      throw new StatusLastInCategoryException();
    }

    // 2) 옮길 상태 — 활성 이슈가 있으면 필수. 주어졌으면 이 프로젝트의 다른 상태여야 한다.
    int activeCount = issueRepository.countActiveByStatus(project.id(), statusId);
    ProjectStatusRow target = moveTo == null ? null : moveTarget(statuses, statusId, moveTo);
    if (target == null && activeCount > 0) {
      throw new StatusMoveTargetRequiredException();
    }

    // 3) 완료 범주로 옮기면 미완료 하위가 남은 에픽이 완료된다(#710 불변식) — 그런 에픽이 있으면 아무것도 쓰지 않고 거절한다.
    if (target != null
        && IssueStatuses.DONE.equals(target.category())
        && !IssueStatuses.DONE.equals(status.category())) {
      int blocked = issueRepository.countEpicsWithIncompleteChildrenOutside(project.id(), statusId);
      if (blocked > 0) {
        throw new EpicHasIncompleteChildrenException(
            "미완료 하위가 있는 에픽 %d개 때문에 완료 범주로 옮길 수 없어요".formatted(blocked));
      }
    }

    // 4) 이슈를 실제로 옮길 상태 — 고른 상태, 없으면(활성 0) 휴지통 행을 위한 같은 범주의 기본 상태(지우는 것이 기본이면 다음 상태).
    ProjectStatusRow issueTarget = target != null ? target : sameCategoryRest.get(0);

    // 5) 활성·휴지통 전부 옮긴다(updated_at·version 그대로).
    List<MigratedIssue> migrated =
        issueRepository.migrateStatus(
            project.id(), statusId, issueTarget.id(), issueTarget.category());
    boolean wasClosed = IssueStatuses.isClosed(status.category());
    boolean nowClosed = IssueStatuses.isClosed(issueTarget.category());
    List<Long> activeIds =
        migrated.stream().filter(m -> !m.deleted()).map(MigratedIssue::id).toList();

    // 6) 열림→종료로 바뀐 활성 이슈의 진행 중 AI 작업을 닫는다 — 이슈 수정 경로(!wasClosed && nowClosed)와 같은 규칙. 완료↔취소는 부르지
    // 않는다.
    if (nowClosed && !wasClosed && !activeIds.isEmpty()) {
      if (IssueStatuses.DONE.equals(issueTarget.category())) {
        agentWorkService.endAllOnIssueDone(activeIds);
      } else {
        agentWorkService.cancelAllForIssues(activeIds);
      }
    }

    // 7) 종료→열림으로 바뀐 하위가 완료 에픽 아래 남지 않게 그 에픽을 진행 중 기본 상태로 되돌린다(WP-689, 이슈 수정 경로와 같은 규칙).
    if (wasClosed && !nowClosed) {
      reopenDoneEpics(callerId, project, migrated);
    }

    // 8) 옮긴 이슈(휴지통 포함) 각각의 이력 — 사용자 변경(STATUS_CHANGED)과 구분되는 STATUS_MIGRATED.
    historyRepository.insertBatch(
        migrated.stream().map(MigratedIssue::id).toList(),
        callerId,
        IssueHistoryEventType.STATUS_MIGRATED.name(),
        status.name(),
        issueTarget.name());

    // 9) 저장된 뷰(다른 사람의 비공개 뷰 포함)의 상태 필터·선택 탭 — 고른 상태로 바꾸고, 고른 상태가 없으면(이슈 0개) 뺀다.
    Long viewTarget = target == null ? null : target.id();
    int changedViews = 0;
    for (var view : savedViewRepository.findByProject(project.id())) {
      String next = SavedViewQueries.replaceStatus(view.query(), statusId, viewTarget);
      if (!Objects.equals(next, view.query())) {
        savedViewRepository.updateQuery(view.id(), next);
        changedViews++;
      }
    }

    // 10) 상태 행 삭제와 기록 — 상태 목록 무효화만 알린다(이슈 알림·ai-agent 발사 없음).
    statusRepository.delete(statusId);
    audit.deleted(
        callerId,
        project,
        status,
        target != null ? target : (migrated.isEmpty() ? null : issueTarget),
        migrated.size(),
        changedViews);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_PROJECT_STATUS, OP_DELETED, project, statusId, callerId);
  }

  /** 이 프로젝트의 상태 — 없거나 다른 프로젝트면 404. */
  private ProjectStatusRow statusInProject(ProjectRow project, long statusId) {
    return statusRepository
        .findById(statusId)
        .filter(s -> s.projectId().equals(project.id()))
        .orElseThrow(StatusNotFoundException::new);
  }

  /** 옮길 상태 확인 — 지우는 상태 자신·다른 프로젝트의 상태는 400, 없는 id 는 404(이슈 상태 지정과 같은 구분). */
  private ProjectStatusRow moveTarget(List<ProjectStatusRow> statuses, long statusId, long moveTo) {
    if (moveTo == statusId) {
      throw new InvalidStatusForProjectException();
    }
    return statuses.stream()
        .filter(s -> s.id() == moveTo)
        .findFirst()
        // 다른 프로젝트의 상태면 400(잘못된 상태), 어디에도 없으면 404.
        .orElseThrow(
            () ->
                statusRepository.findById(moveTo).isPresent()
                    ? new InvalidStatusForProjectException()
                    : new StatusNotFoundException());
  }

  /**
   * 옮긴 활성 이슈의 부모 중 완료 범주 에픽을 진행 중 기본 상태로 조용히 되돌리고 STATUS_CHANGED 이력을 남긴다. 함께 옮겨진 에픽은 이미 이전 대상 범주라
   * 빼고, 휴지통 이슈는 하위로 세지 않으므로(미완료 판정이 활성만 본다) 그 부모는 다시 열지 않는다.
   */
  private void reopenDoneEpics(Long callerId, ProjectRow project, List<MigratedIssue> migrated) {
    var migratedIds = new HashSet<Long>();
    migrated.forEach(m -> migratedIds.add(m.id()));
    var parentIds = new LinkedHashSet<Long>();
    for (var m : migrated) {
      if (!m.deleted() && m.parentIssueId() != null && !migratedIds.contains(m.parentIssueId())) {
        parentIds.add(m.parentIssueId());
      }
    }
    Map<Long, String> epics = issueRepository.findDoneEpicStatusNames(parentIds);
    if (epics.isEmpty()) return;
    var inProgress =
        statusRepository
            .findDefault(project.id(), IssueStatuses.IN_PROGRESS)
            .orElseThrow(() -> new IllegalStateException("진행 중 범주의 상태가 없습니다"));
    issueRepository.reopenQuietly(epics.keySet(), IssueStatuses.IN_PROGRESS, inProgress.id());
    epics.forEach(
        (epicId, fromName) ->
            historyRepository.insert(
                epicId,
                callerId,
                IssueHistoryEventType.STATUS_CHANGED.name(),
                fromName,
                inProgress.name()));
  }
}
