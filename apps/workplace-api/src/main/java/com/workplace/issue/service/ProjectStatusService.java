package com.workplace.issue.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.issue.dto.CreateProjectStatusRequest;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ProjectStatusResponse;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.dto.RenameProjectStatusRequest;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.StatusEditNotSupportedException;
import com.workplace.issue.exception.StatusNameDuplicatedException;
import com.workplace.issue.exception.StatusNotFoundException;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트별 이슈 상태 서비스(WP-807) — 조회는 프로젝트를 볼 수 있으면, 추가·이름 변경은 OWNER. 개인 프로젝트는 기본 4상태로 고정이라 편집을 막는다. 기본
 * 4상태 시드는 DB 트리거(project AFTER INSERT)만 담당하므로 여기서는 하지 않는다.
 *
 * <p>position 은 프로젝트 전체에서 범주 순서({@link IssueStatuses#CATEGORY_ORDER})와 맞는 단조 증가값으로 유지한다. 그래서 새 상태는
 * 「어느 상태 바로 뒤」(after 또는 범주의 마지막 상태)에 넣고, 그 뒤 행을 한 칸씩 민다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ProjectStatusService {

  /** 상태 이름 최대 길이 — project_status.name VARCHAR(30) 과 같다(코드 포인트 기준, PostgreSQL 과 같은 셈). */
  static final int NAME_MAX = 30;

  private final ProjectStatusRepository repo;
  private final ProjectAccessGuard accessGuard;
  private final ProjectChangeNotifier changeNotifier;

  /** 프로젝트의 상태 목록 — 범주 순서 → position 순. OPEN 은 테넌트 전원 조회 허용(assertReadable). */
  @Transactional(readOnly = true)
  public List<ProjectStatusResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return repo.findByProject(project.id()).stream().map(ProjectStatusResponse::from).toList();
  }

  /**
   * 상태 추가 — OWNER. afterStatusId 가 있으면 그 상태 바로 뒤(같은 범주여야 함), 없으면 범주 맨 뒤에 넣는다. 같은 프로젝트의 동시 추가가 같은
   * position 을 잡지 않도록 상태 행을 잠근 뒤 위치를 정한다.
   */
  public ProjectStatusResponse create(
      Long callerId, String projectKey, CreateProjectStatusRequest req) {
    var project = assertEditable(projectKey, callerId);
    String name = requireName(req.name());
    String category = req.category();
    if (!IssueStatuses.isCategory(category)) {
      // 컨트롤러는 @Pattern 으로 거르지만, 서비스를 직접 부르는 경로(MCP 등)도 같은 400 을 받게 한다
      throw new IllegalArgumentException("알 수 없는 상태 범주입니다: " + category);
    }

    repo.lockByProject(project.id());
    // 잠근 뒤 목록을 한 번 읽는다 — 잠금을 기다린 쪽은 잠금 문장에서 상대가 방금 넣은 행을 보지 못한다(READ COMMITTED).
    int anchor = anchorPosition(repo.findByProject(project.id()), category, req.afterStatusId());
    // 중복은 쓰기 전에 거른다 — 유일 인덱스 위반은 트랜잭션을 중단시켜, 같은 트랜잭션에서 이어지는 문장(호출부의 후속 처리 등)까지 실패하게 한다
    if (repo.existsName(project.id(), name, null)) {
      throw new StatusNameDuplicatedException(name);
    }
    repo.shiftPositionsAfter(project.id(), anchor);
    ProjectStatusRow row;
    try {
      row = repo.insert(project.id(), name, category, anchor + 1);
    } catch (DuplicateKeyException e) {
      // 위 확인과 INSERT 사이 경합(다른 트랜잭션의 이름 변경 등) — 유일 인덱스가 막은 것을 같은 409 로(트랜잭션은 롤백)
      throw new StatusNameDuplicatedException(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_PROJECT_STATUS, OP_CREATED, project, row.id(), callerId);
    return ProjectStatusResponse.from(row);
  }

  /** 상태 이름 변경 — OWNER. 기본 상태도 바꿀 수 있고 범주·position 은 그대로다. 자기 이름 그대로는 중복이 아니다. */
  public ProjectStatusResponse rename(
      Long callerId, String projectKey, Long statusId, RenameProjectStatusRequest req) {
    var project = assertEditable(projectKey, callerId);
    String name = requireName(req.name());
    var current = repo.findById(statusId).orElseThrow(StatusNotFoundException::new);
    if (!current.projectId().equals(project.id())) {
      throw new StatusNotFoundException();
    }
    // 자기 자신은 빼고 확인한다 — 자기 이름 그대로(대소문자만 바꿈 포함)는 중복이 아니다
    if (repo.existsName(project.id(), name, statusId)) {
      throw new StatusNameDuplicatedException(name);
    }
    ProjectStatusRow row;
    try {
      row = repo.rename(statusId, name);
    } catch (DuplicateKeyException e) {
      // 위 확인과 UPDATE 사이 경합 — 유일 인덱스가 막은 것을 같은 409 로
      throw new StatusNameDuplicatedException(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_PROJECT_STATUS, OP_UPDATED, project, statusId, callerId);
    return ProjectStatusResponse.from(row);
  }

  /** OWNER 권한을 확인하고, 개인 프로젝트면 거절한다 — 권한 확인이 먼저라 비멤버·MEMBER 는 그대로 404/403 을 받는다. */
  private ProjectRow assertEditable(String projectKey, Long callerId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    if ("PERSONAL".equals(project.type())) {
      throw new StatusEditNotSupportedException();
    }
    return project;
  }

  /**
   * 새 상태가 들어갈 자리의 바로 앞 position. after 가 있으면 그 상태(없거나 다른 프로젝트면 404, 범주가 다르면 400), 없으면 그 범주까지(범주 순서상
   * 이 범주와 그 앞 범주들)의 마지막 position — 범주가 비어 있어도 앞 범주 뒤에 들어가 범주 순서가 깨지지 않는다. 상태가 하나도 없으면 -1.
   */
  private static int anchorPosition(
      List<ProjectStatusRow> statuses, String category, Long afterStatusId) {
    if (afterStatusId != null) {
      // 목록은 이 프로젝트의 상태뿐이라, 없는 id·다른 프로젝트 id 모두 여기서 404 가 된다
      var after =
          statuses.stream()
              .filter(s -> s.id().equals(afterStatusId))
              .findFirst()
              .orElseThrow(StatusNotFoundException::new);
      if (!after.category().equals(category)) {
        throw new InvalidStatusForProjectException();
      }
      return after.position();
    }
    int rank = IssueStatuses.CATEGORY_ORDER.indexOf(category);
    return statuses.stream()
        .filter(s -> IssueStatuses.CATEGORY_ORDER.indexOf(s.category()) <= rank)
        .mapToInt(ProjectStatusRow::position)
        .max()
        .orElse(-1);
  }

  /**
   * 이름 검증 — 요청 record 가 이미 한 줄로 다듬었으므로 비었는지·길이·범주 코드인지만 본다. 서비스를 직접 부르는 경로도 같은 한국어 400 을 받도록
   * IllegalArgumentException(→ 400, 메시지 그대로)으로 던진다.
   *
   * <p>범주 코드(TODO 등)와 같은 이름은 거절한다 — 이력은 예전 행의 범주 코드와 새 행의 상태 이름을 한 칸에 담아, 「DONE」이라는 이름이 「완료」 범주 라벨로
   * 잘못 보이기 때문이다. 중복 판정(lower(btrim))과 같이 대소문자·앞뒤 공백은 무시한다.
   */
  private static String requireName(String name) {
    if (name == null || name.isEmpty()) {
      throw new IllegalArgumentException("상태 이름을 입력해 주세요");
    }
    if (name.codePointCount(0, name.length()) > NAME_MAX) {
      throw new IllegalArgumentException("상태 이름은 " + NAME_MAX + "자 이하로 입력해 주세요");
    }
    if (IssueStatuses.isCategory(name.strip().toUpperCase(Locale.ROOT))) {
      throw new IllegalArgumentException("범주 코드(TODO·IN_PROGRESS·DONE·CANCELED)는 상태 이름으로 쓸 수 없습니다");
    }
    return name;
  }
}
