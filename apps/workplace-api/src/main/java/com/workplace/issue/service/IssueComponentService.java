package com.workplace.issue.service;

import com.workplace.component.dto.ComponentRow;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.component.repository.ComponentRepository;
import com.workplace.component.service.ComponentService;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueComponentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈에 구성요소 집합을 통째로 교체한다(WP-933) — {@link IssueLabelService#replace} 와 같은 모양: 멤버 가드, 이슈 행 잠금, 프로젝트
 * 소속 검증, diff 만 INSERT/DELETE, 차이가 있을 때만 {@code COMPONENTS_CHANGED} 한 건과 화면 갱신 알림.
 *
 * <p>담당자는 바꾸지 않는다 — 구성요소 담당자 자동 지정은 이슈를 만들 때만 일어난다(설계 §4.3).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueComponentService {

  private final IssueComponentRepository issueComponentRepository;
  private final ComponentRepository componentRepository;
  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;

  /**
   * 구성요소 집합 교체. 이 프로젝트에 없는 id 는 400 COMPONENT_NOT_FOUND, 보관된 구성요소를 새로 붙이면 400 COMPONENT_ARCHIVED —
   * 이미 붙어 있던 보관 구성요소는 그대로 둘 수 있다(보관 뒤에도 지난 이슈의 분류가 사라지지 않게).
   *
   * @return 교체 뒤 이슈의 구성요소(목록 순서)
   */
  public List<ComponentSummary> replace(
      Long callerId, String projectKey, int number, List<Long> componentIds) {
    var project = accessGuard.assertMember(projectKey, callerId);
    // 이슈 행 잠금 — 현재 집합 읽기→diff→반영이 한 덩어리가 되게 해, 동시 교체가 서로의 변경을 조용히 되돌리지 못하게 한다(라벨과 같다).
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    // 1) 요청 id 가 모두 이 프로젝트 소속인지(중복 id 는 하나로). 구성요소 행을 공유 잠금한 채 읽는다 — 잠금 순서는 이슈 행(위) → 구성요소 행이고,
    //    ComponentService 의 보관·삭제는 구성요소 행(FOR UPDATE)만 잡은 채 이력으로 이슈 행의 KEY SHARE 를 얻는데 이슈 행 잠금(NO
    // KEY UPDATE)과
    //    충돌하지 않아 서로 기다리는 고리가 생기지 않는다. 잠그지 않으면 보관·삭제가 「보관 여부 확인」과 INSERT 사이에 끼어, 보관된 것이 새로 붙거나
    //    삭제된 것의 외래키 위반이 COMPONENT_NOT_FOUND 대신 일반 409 로 나간다.
    List<Long> requested =
        componentIds == null ? List.of() : List.copyOf(new LinkedHashSet<>(componentIds));
    List<ComponentRow> rows = componentRepository.findByIds(project.id(), requested, true);
    ComponentService.requireInProject(rows, requested.size());

    // 2) 지금 붙은 것과 diff — 제거분의 이름은 지우기 전에 읽어 둔다(이력은 당시 이름을 남긴다).
    List<ComponentSummary> before = componentRepository.summariesByIssue(issue.id());
    Set<Long> current = before.stream().map(ComponentSummary::id).collect(Collectors.toSet());
    Set<Long> target = new HashSet<>(requested);

    // 보관된 구성요소는 새로 붙이는 것만 막는다(목록 순서로 처음 걸린 이름을 알려 준다).
    List<ComponentRow> toAdd = rows.stream().filter(r -> !current.contains(r.id())).toList();
    ComponentService.requireNotArchived(toAdd);
    List<ComponentSummary> removed = before.stream().filter(s -> !target.contains(s.id())).toList();

    for (ComponentRow r : toAdd) {
      issueComponentRepository.add(issue.id(), r.id());
    }
    for (ComponentSummary s : removed) {
      issueComponentRepository.remove(issue.id(), s.id());
    }

    // 3) 차이가 있을 때만 이력·실시간 무효화(no-op 은 미발행). 정리성 쓰기라 AI 작업을 건드리지 않는 알림을 쓴다.
    if (!toAdd.isEmpty() || !removed.isEmpty()) {
      List<ComponentSummary> added = toAdd.stream().map(ComponentRow::toSummary).toList();
      historyRecorder.recordComponentsChanged(callerId, issue.id(), added, removed);
      changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
    }

    // 교체 뒤 집합은 곧 요청한 구성요소(잠가서 읽은 행, 목록 순서)다 — 다시 읽지 않는다.
    return rows.stream().map(ComponentRow::toSummary).toList();
  }
}
