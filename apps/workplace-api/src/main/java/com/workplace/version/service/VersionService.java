package com.workplace.version.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_CREATED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_DELETED;
import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.issue.service.IssueVersionService;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.version.dto.CreateVersionRequest;
import com.workplace.version.dto.ReleaseVersionRequest;
import com.workplace.version.dto.UpdateVersionRequest;
import com.workplace.version.dto.VersionIssueCount;
import com.workplace.version.dto.VersionKind;
import com.workplace.version.dto.VersionProgress;
import com.workplace.version.dto.VersionResponse;
import com.workplace.version.dto.VersionRow;
import com.workplace.version.exception.VersionException;
import com.workplace.version.repository.VersionRepository;
import com.workplace.version.repository.VersionRepository.LockMode;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 버전(WP-888) 목록 관리 서비스. 보기는 프로젝트를 읽을 수 있는 사람, 추가·편집·보관·복원은 프로젝트 OWNER 와 테넌트 ADMIN 이다(구성요소와 같은
 * 가드). 출시·출시 취소·삭제도 여기서 하며, 그때 이슈를 옮기는 쓰기는 {@link IssueVersionService#applyChange} 에 맡긴다.
 *
 * <p>잠금 순서는 모든 경로가 <b>이슈 행 → 버전 행</b> 한 방향이다. 출시 옮기기·삭제는 대상 이슈 id 를 읽고 → 이슈 행들을 id 순으로 잠그고 → 원래·대상
 * 버전 행을 id 순으로 잠근 뒤 → 잠근 상태에서 대상 집합을 다시 읽어 반영한다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class VersionService {

  /** 프로젝트당 버전 상한(보관 포함). */
  public static final int LIMIT = 200;

  /** 출시일 기본값(오늘)을 정하는 시간대. */
  private static final ZoneId RELEASE_ZONE = ZoneId.of("Asia/Seoul");

  private final VersionRepository versionRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueVersionService issueVersionService;
  private final ProjectChangeNotifier changeNotifier;

  /** 목록(보관 포함, 목록 순서) — 프로젝트를 읽을 수 있으면 누구나. 진행·영향 수는 목록 전체를 한 번씩 집계한다. */
  @Transactional(readOnly = true)
  public List<VersionResponse> list(Long callerId, String projectKey) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return toResponses(versionRepository.listByProject(project.id()));
  }

  /** 한 건 조회 — 다른 프로젝트의 id 는 없는 것과 같게 404. */
  @Transactional(readOnly = true)
  public VersionResponse get(Long callerId, String projectKey, long versionId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return toResponses(List.of(findInProject(project, versionId, false))).get(0);
  }

  /** 버전 추가 — OWNER·ADMIN. 개인 프로젝트·상한·이름 중복·날짜 순서 위반은 400. */
  public VersionResponse create(Long callerId, String projectKey, CreateVersionRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    if (project.isPersonal()) {
      throw VersionException.personalProject();
    }
    assertDatesOrdered(req.startDate(), req.releaseDate());
    // 개수 검사와 삽입 사이에 다른 추가가 끼어 상한을 넘기지 않게 프로젝트 단위로 직렬화한다.
    versionRepository.lockProject(project.id());
    if (versionRepository.countByProject(project.id()) >= LIMIT) {
      throw VersionException.limit(LIMIT);
    }
    assertNameFree(project.id(), req.name(), null);
    try {
      var row =
          versionRepository.insert(
              project.id(),
              req.name(),
              req.description(),
              req.startDate(),
              req.releaseDate(),
              callerId);
      // 다른 탭·다른 멤버 화면의 버전 목록·상세가 새 항목을 다시 읽게 알린다(구성요소와 같은 방식).
      changeNotifier.changed(
          ProjectChangeNotifier.RESOURCE_VERSION, OP_CREATED, project, row.id(), callerId);
      // 막 만든 버전엔 붙은 이슈가 있을 수 없어 집계 없이 빈 진행·영향 0 으로 응답한다.
      return toResponse(row, VersionProgress.EMPTY, 0);
    } catch (DuplicateKeyException e) {
      throw VersionException.nameTaken(req.name());
    }
  }

  /**
   * 부분 수정 — OWNER·ADMIN. 보낸 필드만 바꾼다. 대상 행을 잠그고 읽어 동시 변경과 겹치지 않게 하고, 날짜 순서는 기존 값과 합쳐 검사한다 — 출시일만 보내도
   * 기존 시작일보다 앞서면 거절. 보관·복원은 {@code archived_at} 만 바꿔 출시 상태가 그대로 남는다.
   */
  public VersionResponse update(
      Long callerId, String projectKey, long versionId, UpdateVersionRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    VersionRow row = findInProject(project, versionId, true);
    String name = row.name();
    if (req.name() != null && !req.name().equals(row.name())) {
      // 대소문자만 바꾸는 이름 변경은 자기 자신을 제외하고 비교하므로 허용된다.
      assertNameFree(project.id(), req.name(), versionId);
      name = req.name();
    }
    String description = row.description();
    if (Boolean.TRUE.equals(req.clearDescription())) {
      description = null;
    } else if (req.description() != null) {
      description = req.description().isEmpty() ? null : req.description();
    }
    LocalDate start = resolveDate(row.startDate(), req.startDate(), req.clearStartDate());
    LocalDate release = resolveDate(row.releaseDate(), req.releaseDate(), req.clearReleaseDate());
    assertDatesOrdered(start, release);
    boolean archived = req.archived() == null ? row.archived() : req.archived();
    try {
      versionRepository.update(versionId, name, description, start, release, archived);
    } catch (DuplicateKeyException e) {
      throw VersionException.nameTaken(name);
    }
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_VERSION, OP_UPDATED, project, versionId, callerId);
    return response(versionId);
  }

  /**
   * 출시 — OWNER·ADMIN. 출시일은 보낸 값 &gt; 기존 출시 예정일 &gt; 오늘(Asia/Seoul) 순으로 정하고, 시작일보다 앞서면 400
   * VERSION_INVALID_DATES. {@code moveUnresolvedTo} 가 있으면 이 버전을 수정 버전으로 가진 끝나지 않은 이슈를 그 버전으로 옮긴다(영향
   * 버전은 건드리지 않는다). 대상이 잘못되면(자기 자신·다른 프로젝트·보관됨·이미 출시됨) 아무것도 바꾸지 않고 400 VERSION_MOVE_TARGET_INVALID.
   * 출시할 버전이 보관돼 있으면 400 VERSION_ARCHIVED.
   */
  public VersionResponse release(
      Long callerId, String projectKey, long versionId, ReleaseVersionRequest req) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    Long target = req == null ? null : req.moveUnresolvedTo();
    // 잠그기 전 존재·소속 확인(404)과 자기 자신 대상 거절 — 버전 행은 아직 잠그지 않는다(잠금 순서 이슈 → 버전).
    findInProject(project, versionId, false);
    if (target != null && target == versionId) throw VersionException.moveTargetInvalid();

    // 옮길 이슈를 먼저 잠그고 → 원래·대상 버전을 잠근다. 옮기지 않으면 이슈는 잠그지 않는다.
    Set<Long> lockedIssues =
        target == null
            ? Set.of()
            : versionRepository.lockIssues(
                versionRepository.issueIdsByVersion(versionId, VersionKind.FIX, true));
    var locked = lockVersions(versionId, target);
    VersionRow source = sourceInProject(locked, project, versionId);
    // 보관된 버전은 출시할 수 없다 — 쓰기 전에 거절해 아무것도 바뀌지 않게 한다.
    if (source.archived()) throw VersionException.archived();
    VersionRow t = target == null ? null : locked.get(target);
    if (target != null) {
      requireMoveTarget(t, project);
      if (t.releasedAt() != null) throw VersionException.moveTargetInvalid();
    }
    LocalDate date =
        req != null && req.releaseDate() != null
            ? req.releaseDate()
            : source.releaseDate() != null ? source.releaseDate() : today();
    assertDatesOrdered(source.startDate(), date);

    // 검증을 모두 마친 뒤 쓴다 — 잠근 상태에서 대상 집합을 다시 읽어 그 사이 끝났거나 빠진 이슈는 건너뛴다.
    if (target != null) {
      moveIssues(project, versionId, t, VersionKind.FIX, true, lockedIssues, callerId);
    }
    versionRepository.release(versionId, date);
    // 옮긴 이슈의 수정 버전 칩·원래·대상 버전 진행이 함께 바뀌므로 이슈 대상은 규칙(updated)이 더한다.
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_VERSION, OP_UPDATED, project, versionId, callerId);
    return response(versionId);
  }

  /** 출시 취소 — OWNER·ADMIN. 출시 시각만 지우고 출시일은 남긴다(옮긴 이슈는 되돌리지 않는다). */
  public VersionResponse unrelease(Long callerId, String projectKey, long versionId) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    findInProject(project, versionId, true);
    versionRepository.unrelease(versionId);
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_VERSION, OP_UPDATED, project, versionId, callerId);
    return response(versionId);
  }

  /** 붙은 (삭제되지 않은) 이슈 수 — 삭제 확인창·출시 대화상자 안내. 목록과 같은 읽기 권한. */
  @Transactional(readOnly = true)
  public VersionIssueCount issueCount(Long callerId, String projectKey, long versionId) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    return versionRepository.issueCount(findInProject(project, versionId, false).id());
  }

  /**
   * 삭제 — OWNER·ADMIN, 보관한 버전만(아니면 400 VERSION_NOT_ARCHIVED). {@code moveTo} 가 있으면 붙어 있던 이슈를 같은
   * 종류(수정→수정, 영향→영향)로 옮기고, 없으면 떼기만 한다. 이슈마다 종류별 변경 이력을 남긴다 — cascade 로 조용히 빠지면 이슈에서 이유를 알 수 없다. 대상은
   * 같은 프로젝트의 보관 아님 버전이어야 하고(출시된 것은 된다) 아니면 400 VERSION_MOVE_TARGET_INVALID.
   */
  public void delete(Long callerId, String projectKey, long versionId, Long moveTo) {
    var project = accessGuard.assertWithRole(projectKey, callerId, "OWNER");
    findInProject(project, versionId, false);
    if (moveTo != null && moveTo == versionId) throw VersionException.moveTargetInvalid();

    // 두 종류로 붙은 이슈를 한 번에 읽어 id 순으로 잠근다(같은 이슈가 두 종류로 붙어도 한 번).
    Set<Long> lockedIssues =
        versionRepository.lockIssues(versionRepository.issueIdsByVersionAnyKind(versionId));
    var locked = lockVersions(versionId, moveTo);
    VersionRow source = sourceInProject(locked, project, versionId);
    if (!source.archived()) throw VersionException.notArchived();
    VersionRow target = moveTo == null ? null : locked.get(moveTo);
    if (moveTo != null) requireMoveTarget(target, project);

    for (String kind : List.of(VersionKind.FIX, VersionKind.AFFECTS)) {
      moveIssues(project, versionId, target, kind, false, lockedIssues, callerId);
    }
    versionRepository.delete(versionId);
    // 붙어 있던 이슈에서 빠지거나 옮겨지므로 이슈 화면도 다시 읽게 한다(규칙이 deleted 에 이슈 대상을 더한다).
    changeNotifier.changed(
        ProjectChangeNotifier.RESOURCE_VERSION, OP_DELETED, project, versionId, callerId);
  }

  /** 원래·대상 버전 행을 id 순으로 배타 잠금하고 id → 행으로 돌려준다(이슈 행을 잠근 뒤에만 부른다). */
  private Map<Long, VersionRow> lockVersions(long sourceId, Long targetId) {
    Set<Long> ids = new TreeSet<>();
    ids.add(sourceId);
    if (targetId != null) ids.add(targetId);
    return versionRepository.lockByIds(ids, LockMode.UPDATE).stream()
        .collect(Collectors.toMap(VersionRow::id, Function.identity()));
  }

  /** 잠근 원래 버전 — 그 사이 지워졌거나 다른 프로젝트면 404. */
  private static VersionRow sourceInProject(
      Map<Long, VersionRow> locked, ProjectRow project, long versionId) {
    VersionRow row = locked.get(versionId);
    if (row == null || row.projectId() != project.id()) throw VersionException.notFound();
    return row;
  }

  /** 옮길 대상의 공통 조건 — 있고, 같은 프로젝트이고, 보관되지 않았다. */
  private static void requireMoveTarget(VersionRow target, ProjectRow project) {
    if (target == null || target.projectId() != project.id() || target.archived()) {
      throw VersionException.moveTargetInvalid();
    }
  }

  /**
   * 이 버전을 한 종류로 가진 이슈를 대상으로 옮긴다(target 이 null 이면 떼기만). 프로젝트·대상 행은 이미 잠가 읽은 것을 모든 이슈에 같이 쓴다. 이미 잠근
   * 상태에서 대상 집합을 다시 읽고, 잠근 이슈에만 손댄다 — 처음 읽은 뒤에 새로 붙은 이슈를 지금 잠그면 버전 → 이슈 순서가 되어 교착할 수 있어 건너뛴다(그 이슈는
   * 붙인 쪽의 결과를 따른다). 이슈마다 한 번의 {@code applyChange} 로 이력이 종류별 한 건만 남는다.
   */
  private void moveIssues(
      ProjectRow project,
      long sourceId,
      VersionRow target,
      String kind,
      boolean unresolvedOnly,
      Set<Long> lockedIssues,
      Long actor) {
    List<VersionRow> add = target == null ? List.of() : List.of(target);
    for (Long issueId : versionRepository.issueIdsByVersion(sourceId, kind, unresolvedOnly)) {
      if (!lockedIssues.contains(issueId)) continue;
      issueVersionService.applyChange(issueId, project, kind, add, Set.of(sourceId), actor);
    }
  }

  /** 오늘(Asia/Seoul) — 출시일 기본값. 사용자가 보는 날짜가 한국 날짜라 서버 시간대와 무관하게 이 시간대로 정한다. */
  private static LocalDate today() {
    return LocalDate.now(RELEASE_ZONE);
  }

  /** 한 건을 진행·영향 수와 함께 다시 읽어 응답으로. */
  private VersionResponse response(long versionId) {
    return toResponses(
            List.of(versionRepository.findById(versionId).orElseThrow(VersionException::notFound)))
        .get(0);
  }

  /** 지우기 플래그 &gt; 새 값 &gt; 기존 값 순으로 날짜를 정한다. */
  private static LocalDate resolveDate(LocalDate current, LocalDate sent, Boolean clear) {
    if (Boolean.TRUE.equals(clear)) return null;
    return sent != null ? sent : current;
  }

  /** 시작일 &lt;= 출시 예정일(둘 다 있을 때) — 아니면 400 VERSION_INVALID_DATES. */
  private static void assertDatesOrdered(LocalDate start, LocalDate release) {
    if (start != null && release != null && start.isAfter(release)) {
      throw VersionException.invalidDates();
    }
  }

  /** 이름이 프로젝트 안에서 비어 있는지(대소문자 무시, 보관된 것 포함) — excludeId 는 자기 자신(이름 변경). */
  private void assertNameFree(long projectId, String name, Long excludeId) {
    boolean taken =
        versionRepository.findByNamesIgnoreCase(projectId, List.of(name)).stream()
            .anyMatch(r -> excludeId == null || r.id() != excludeId);
    if (taken) {
      throw VersionException.nameTaken(name);
    }
  }

  /**
   * 프로젝트에 속한 버전을 찾는다 — 다른 프로젝트의 id 는 없는 것과 같게 404.
   *
   * @param lock true 면 행을 잠그고 읽는다(수정용)
   */
  private VersionRow findInProject(ProjectRow project, long versionId, boolean lock) {
    var found =
        lock ? versionRepository.lockById(versionId) : versionRepository.findById(versionId);
    var row = found.orElseThrow(VersionException::notFound);
    if (row.projectId() != project.id()) {
      throw VersionException.notFound();
    }
    return row;
  }

  /** 행 목록 → 응답. 진행·영향 수를 목록 전체에 대해 한 번씩 집계해 붙인다(N+1 방지). */
  private List<VersionResponse> toResponses(List<VersionRow> rows) {
    if (rows.isEmpty()) return List.of();
    List<Long> ids = rows.stream().map(VersionRow::id).toList();
    var tallies = versionRepository.talliesByVersionIds(ids);
    return rows.stream()
        .map(
            r ->
                toResponse(
                    r,
                    tallies.progress().getOrDefault(r.id(), VersionProgress.EMPTY),
                    tallies.affects().getOrDefault(r.id(), 0)))
        .toList();
  }

  /** 행 + 집계 → 응답 한 건(목록·만들기가 같은 모양을 쓰게). */
  private static VersionResponse toResponse(
      VersionRow r, VersionProgress progress, int affectsCount) {
    return new VersionResponse(
        r.id(),
        r.name(),
        r.description(),
        r.startDate(),
        r.releaseDate(),
        r.status(),
        r.releasedAt(),
        progress,
        affectsCount);
  }
}
