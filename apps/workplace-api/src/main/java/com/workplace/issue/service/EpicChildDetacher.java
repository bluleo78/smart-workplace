package com.workplace.issue.service;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueTypeRow;
import com.workplace.issue.dto.ParentRef;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 에픽에서 하위를 떼어 낸다(WP-1038). 에픽 하위는 다른 프로젝트에 있을 수 있어, 에픽을 지우면서 하위까지 지우면 남의 프로젝트 이슈가 사라진다 — 그래서 에픽
 * 삭제·프로젝트 삭제는 하위를 지우지 않고 부모만 뗀다(외래 키는 ON DELETE CASCADE 그대로지만 앱은 이슈·프로젝트를 하드 삭제하지 않는다).
 *
 * <p>뗀 하위마다 PARENT_CHANGED 이력(from=에픽, to=없음)을 남기고, 하위 프로젝트(와 다른 프로젝트 에픽이면 그 에픽 프로젝트)에 실시간 무효화를 낸다.
 * 하위는 id 순으로 잠그고(부모 → 하위 순서는 호출부가 지킨다) 다시 읽은 행으로 떼므로, 그 사이 다른 부모로 옮겨진 하위는 건드리지 않는다.
 */
@Component
@RequiredArgsConstructor
public class EpicChildDetacher {

  private final IssueRepository issueRepository;
  private final IssueTypeRepository typeRepository;
  private final ProjectRepository projectRepository;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;

  /**
   * 지우려는 에픽의 활성 하위(같은 프로젝트·다른 프로젝트 모두)를 뗀다. 에픽을 soft-delete 하기 전에, 에픽 행을 쓰기 잠금한 뒤 부른다 — 이력의 from 을
   * 만들 때 에픽이 아직 활성이어야 하고, 새 하위를 붙이는 요청(에픽 공유 잠금)이 삭제 커밋까지 기다리게 하려는 것이다.
   *
   * @return 뗀 하위 수
   */
  public int detachChildrenOfDeletedEpic(Long actorId, IssueRow epic) {
    // 에픽 프로젝트는 삭제 알림(deleted)이 따로 나가므로 에픽 쪽 알림은 내지 않는다.
    return detach(actorId, issueRepository.lockActiveChildren(epic.id()), null, epic.id());
  }

  /**
   * 지우려는 프로젝트와 다른 프로젝트 사이의 부모 관계를 두 방향 모두 뗀다 — 다른 프로젝트 하위가 이 프로젝트 에픽을 가리키는 것, 이 프로젝트 하위가 다른 프로젝트
   * 에픽을 가리키는 것. 프로젝트를 soft-delete 하기 전에 부른다(이력의 프로젝트 키를 읽을 수 있게). 같은 프로젝트 안의 부모 관계는 프로젝트와 함께 사라지므로
   * 그대로 둔다.
   *
   * @return 뗀 하위 수
   */
  public int detachCrossProject(Long actorId, long deletingProjectId) {
    return detach(
        actorId,
        issueRepository.lockCrossProjectChildren(deletingProjectId),
        deletingProjectId,
        null);
  }

  /**
   * 잠근 하위들의 부모를 떼고 이력·알림을 남긴다.
   *
   * @param skipProjectId 알림을 내지 않을 프로젝트(지우는 프로젝트 — 프로젝트 삭제 알림이 대신한다). 없으면 null
   * @param deletingEpicId 지우는 에픽(그 프로젝트는 이슈 삭제 알림이 대신한다). 없으면 null
   */
  private int detach(
      Long actorId, List<IssueRow> children, Long skipProjectId, Long deletingEpicId) {
    if (children.isEmpty()) return 0;
    // 부모(에픽)·유형·프로젝트를 한 번씩만 읽는다 — 프로젝트 삭제는 하위가 여러 에픽에 걸친다.
    Set<Long> parentIds =
        children.stream()
            .map(IssueRow::parentIssueId)
            .collect(Collectors.toCollection(LinkedHashSet::new));
    Map<Long, IssueRow> parents =
        issueRepository.findByIds(parentIds).stream()
            .collect(Collectors.toMap(IssueRow::id, Function.identity()));
    Map<Long, IssueTypeRow> types = new HashMap<>();
    Map<Long, ProjectRow> projects = new HashMap<>();

    issueRepository.clearParents(children.stream().map(IssueRow::id).toList());

    Set<Long> notifiedEpics = new LinkedHashSet<>();
    for (IssueRow child : children) {
      IssueRow parent = parents.get(child.parentIssueId());
      ParentRef from = null;
      if (parent != null) {
        IssueTypeRow type =
            types.computeIfAbsent(parent.typeId(), id -> typeRepository.findById(id).orElseThrow());
        ProjectRow parentProject = project(projects, parent.projectId());
        from =
            IssueService.toParentRef(
                parent, type, parentProject == null ? null : parentProject.key());
      }
      historyRecorder.recordParentChanged(actorId, child.id(), from, null);

      // 하위 자신 — 부모 칩·묶음이 바뀌었다(정리성 쓰기라 AI 작업을 건드리지 않는다).
      if (!Objects.equals(child.projectId(), skipProjectId)) {
        ProjectRow childProject = project(projects, child.projectId());
        if (childProject != null) {
          changeNotifier.updatedWithoutTouch(childProject, child.number(), child.id(), actorId);
        }
      }
      // 다른 프로젝트 에픽 — 하위 수·진행률이 바뀌었다. 지우는 에픽·지우는 프로젝트는 각자의 삭제 알림이 대신한다.
      if (parent != null
          && !parent.projectId().equals(child.projectId())
          && !parent.id().equals(deletingEpicId)
          && !Objects.equals(parent.projectId(), skipProjectId)
          && notifiedEpics.add(parent.id())) {
        ProjectRow epicProject = project(projects, parent.projectId());
        if (epicProject != null) {
          changeNotifier.updatedWithoutTouch(epicProject, parent.number(), parent.id(), actorId);
        }
      }
    }
    return children.size();
  }

  /** 프로젝트 행 캐시 조회 — 없으면(이미 삭제) null. */
  private ProjectRow project(Map<Long, ProjectRow> cache, Long projectId) {
    if (cache.containsKey(projectId)) return cache.get(projectId);
    ProjectRow row = projectRepository.findById(projectId).orElse(null);
    cache.put(projectId, row);
    return row;
  }
}
