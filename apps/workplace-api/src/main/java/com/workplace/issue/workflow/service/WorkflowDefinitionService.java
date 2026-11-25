package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.workflow.domain.ParseResult;
import com.workplace.issue.workflow.domain.ProjectMembers;
import com.workplace.issue.workflow.domain.StartOverlap;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModelJson;
import com.workplace.issue.workflow.domain.WorkflowValidator;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import com.workplace.issue.workflow.dto.CreateWorkflowRequest;
import com.workplace.issue.workflow.dto.PublishResult;
import com.workplace.issue.workflow.dto.SaveDraftResult;
import com.workplace.issue.workflow.dto.SaveWorkflowDraftRequest;
import com.workplace.issue.workflow.dto.UpdateWorkflowRequest;
import com.workplace.issue.workflow.dto.ValidateWorkflowRequest;
import com.workplace.issue.workflow.dto.WorkflowActiveVersion;
import com.workplace.issue.workflow.dto.WorkflowActor;
import com.workplace.issue.workflow.dto.WorkflowDetail;
import com.workplace.issue.workflow.dto.WorkflowProblem;
import com.workplace.issue.workflow.dto.WorkflowSummary;
import com.workplace.issue.workflow.dto.WorkflowValidationResult;
import com.workplace.issue.workflow.dto.WorkflowVersionDetail;
import com.workplace.issue.workflow.dto.WorkflowVersionSummary;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.issue.workflow.repository.WorkflowVersionRow;
import com.workplace.issue.workflow.repository.WorkflowVersionSummaryRow;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 워크플로우 정의의 초안 저장·검증·게시·되돌리기(WP-1984). 실행은 하지 않는다.
 *
 * <p>순서는 모든 경로가 같다: 읽을 수 있는지(못 보면 없는 것과 같은 404) → 쓰기 권한(OWNER, 테넌트 ADMIN 우회) → 행 잠금 → 내용
 * 검사(크기·이름·충돌). RLS 는 FK 삽입을 막지 않으므로 부모 id(프로젝트·워크플로우)는 이 확인을 지난 값만 저장소에 넘기고, 잠근 뒤에는 잠근 행의 값만 쓴다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WorkflowDefinitionService {

  private static final String OWNER = "OWNER";

  private final WorkflowRepository workflowRepository;
  private final WorkflowRunRepository runRepository;
  private final WorkflowMemberLookup memberLookup;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final UserRepository userRepository;
  private final WorkflowModelLoader modelLoader;

  /** 프로젝트의 워크플로우 목록(요약). */
  @Transactional(readOnly = true)
  public List<WorkflowSummary> list(long projectId, long callerId) {
    ProjectRow project = readableProject(projectId, callerId);
    return workflowRepository.findByProject(project.id()).stream()
        .map(
            r ->
                new WorkflowSummary(
                    r.id(), r.name(), r.enabled(), r.activeVersionNo(), r.draftChanged()))
        .toList();
  }

  /** 한 건 — 초안의 문제는 구성원이 바뀔 수 있어 읽을 때마다 계산한다. */
  @Transactional(readOnly = true)
  public WorkflowDetail get(long workflowId, long callerId) {
    return detail(readable(workflowId, callerId).workflow());
  }

  /** 저장하지 않고 검증만 한다. 크기 초과·저장할 수 없는 글자도 예외가 아니라 문제로 돌려준다. */
  @Transactional(readOnly = true)
  public WorkflowValidationResult validate(ValidateWorkflowRequest req, long callerId) {
    ProjectRow project = readableProject(req.projectId(), callerId);
    return new WorkflowValidationResult(check(project.id(), req.yaml()).problems());
  }

  /** 게시 버전 목록 — 게시자는 사용자 조회 한 번, 버전별 활성 실행 수는 집계 한 번으로 붙인다(WP-1985). */
  @Transactional(readOnly = true)
  public List<WorkflowVersionSummary> versions(long workflowId, long callerId) {
    WorkflowRow workflow = readable(workflowId, callerId).workflow();
    List<WorkflowVersionSummaryRow> rows = workflowRepository.findVersions(workflow.id());
    Map<Long, WorkflowActor> actors =
        actorsOf(
            rows.stream()
                .map(WorkflowVersionSummaryRow::createdBy)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
    // 활성(RUNNING·WAITING·SUSPENDED) 실행만 센다 — 끝난 실행은 그 버전을 붙잡지 않는다. 삭제된 이슈의 실행도 빼 실행 목록과 맞춘다.
    Map<Long, Integer> activeRuns = runRepository.countActiveByVersion(workflow.id());
    return rows.stream()
        .map(
            r ->
                new WorkflowVersionSummary(
                    r.versionNo(),
                    r.createdAt(),
                    r.createdBy() == null ? null : actors.get(r.createdBy()),
                    activeRuns.getOrDefault(r.id(), 0)))
        .toList();
  }

  /** 게시 버전 한 건(원문과 저장된 모델 JSON 그대로). */
  @Transactional(readOnly = true)
  public WorkflowVersionDetail version(long workflowId, int versionNo, long callerId) {
    WorkflowRow workflow = readable(workflowId, callerId).workflow();
    WorkflowVersionRow v = versionIn(workflow.id(), versionNo);
    return new WorkflowVersionDetail(v.versionNo(), v.sourceYaml(), v.modelJson());
  }

  /** 만들기 — 초안은 오류가 있어도 저장하고, 꺼진 채 게시 버전 없이 시작한다. */
  public WorkflowDetail create(long projectId, CreateWorkflowRequest req, long actorId) {
    ProjectRow project = accessGuard.assertWithRole(projectById(projectId).key(), actorId, OWNER);
    assertSize(req.yaml());
    assertNameFree(project.id(), req.name(), null);
    long id;
    try {
      id = workflowRepository.insert(project.id(), req.name(), req.yaml(), actorId, nowMillis());
    } catch (DuplicateKeyException e) {
      // 사전 검사와 삽입 사이에 같은 이름이 끼어든 경합 — 이 호출의 유일 제약은 이름뿐이다.
      throw WorkflowException.nameTaken();
    }
    return detail(reload(id));
  }

  /** 초안 덮어쓰기 — 오류가 있어도 저장하고 문제를 함께 돌려준다. 같은 글이어도 시각은 바뀐다. */
  public SaveDraftResult saveDraft(long workflowId, SaveWorkflowDraftRequest req, long actorId) {
    WorkflowRow locked = lockForWrite(workflowId, actorId);
    assertSize(req.yaml());
    assertNotChanged(locked, req.expectedDraftUpdatedAt());
    Instant savedAt = nextDraftTime(locked.draftUpdatedAt());
    workflowRepository.updateDraft(locked.id(), req.yaml(), actorId, savedAt);
    return new SaveDraftResult(savedAt, check(locked.projectId(), req.yaml()).problems());
  }

  /**
   * 게시 — 잠근 초안을 검증해 ERROR 가 없으면 새 버전으로 쌓고 활성으로 바꾼다. 경고와 같은 내용의 재게시는 허용하고, 초안과 그 시각은 그대로 둔다. 버전의
   * 모델에만 저장된 정확한 username 을 남기고 원문은 적은 그대로 둔다.
   *
   * <p>켜져 있거나 첫 게시의 enable 이면, 쓰기 전에 새 모델의 시작 조건이 켜진 다른 정의와 겹치는지 보고 겹치면 거절한다(버전을 쌓지 않는다). 통과하면 첫
   * 게시의 enable 은 같은 요청에서 켠다(WP-2119). enable 은 첫 게시(활성 버전 없음)에만 따른다 — 화면이 「첫 게시」로 본 사이 다른 관리자가 끈 채
   * 게시했으면 그 선택을 덮지 않는다.
   *
   * @param expectedDraftUpdatedAt 게시하려고 본 초안의 시각(null 이면 충돌 검사 생략)
   * @param enable true 면 첫 게시와 함께 켠다(이미 게시 버전이 있으면 무시)
   */
  public PublishResult publish(
      long workflowId, Instant expectedDraftUpdatedAt, boolean enable, long actorId) {
    WorkflowRow locked = lockForWrite(workflowId, actorId);
    assertNotChanged(locked, expectedDraftUpdatedAt);
    Checked checked = check(locked.projectId(), locked.draftYaml());
    if (checked.hasError()) {
      throw WorkflowException.invalid(checked.problems());
    }
    // 구성원을 다시 읽으면 검증한 사람과 남는 사람이 달라질 수 있어, 검증에 쓴 표로 바꾼다.
    WorkflowModel published = checked.model().withStoredUsernames(checked.members());
    boolean enableNow = enable && locked.activeVersionId() == null && !locked.enabled();
    boolean willBeEnabled = enableNow || locked.enabled();
    if (willBeEnabled) {
      assertNoStartOverlap(locked, published);
    }
    // 번호 매김(max+1)은 위 행 잠금이 직렬화한다. 이곳의 유일 위반은 이름 중복이 아니므로 바꿔 읽지 않는다.
    WorkflowVersionRow version =
        workflowRepository.insertVersion(
            locked.id(), locked.draftYaml(), WorkflowModelJson.write(published), actorId);
    workflowRepository.setActiveVersion(locked.id(), version.id());
    if (enableNow) {
      workflowRepository.updateEnabled(locked.id(), true);
    }
    // 옛 버전으로 도는(활성) 실행 수 — 실행은 시작한 버전에 고정이라 새 버전으로 옮겨 가지 않는다(WP-1985). 정의 행을 잠근 채 세므로
    // 같은 정의의 게시와는 겹치지 않는다. 방금 만든 버전에는 아직 실행이 없지만 뜻을 분명히 하려고 뺀다.
    int older =
        runRepository.countActiveByVersion(locked.id()).entrySet().stream()
            .filter(e -> e.getKey() != version.id())
            .mapToInt(Map.Entry::getValue)
            .sum();
    return new PublishResult(version.versionNo(), older);
  }

  /**
   * 되돌리기 — 그 버전 원문을 초안에 쓰기만 한다(게시하지 않는다, 활성 그대로).
   *
   * @param expectedDraftUpdatedAt 덮으려고 본 초안의 시각(null 이면 충돌 검사 생략)
   */
  public WorkflowDetail restoreDraft(
      long workflowId, int versionNo, Instant expectedDraftUpdatedAt, long actorId) {
    WorkflowRow locked = lockForWrite(workflowId, actorId);
    // 초안은 기록이 없어 덮으면 되찾을 수 없다 — 내용(버전 찾기)보다 먼저, 잠근 행으로 충돌을 본다.
    assertNotChanged(locked, expectedDraftUpdatedAt);
    WorkflowVersionRow from = versionIn(locked.id(), versionNo);
    workflowRepository.updateDraft(
        locked.id(), from.sourceYaml(), actorId, nextDraftTime(locked.draftUpdatedAt()));
    return detail(reload(locked.id()));
  }

  /** 켜기·끄기와 이름 바꾸기 — 보낸 칸만. 끄기는 언제나 되고 켜기는 활성 버전이 있어야 한다. */
  public WorkflowDetail update(long workflowId, UpdateWorkflowRequest req, long actorId) {
    WorkflowRow locked = lockForWrite(workflowId, actorId);
    // 거절할 것은 어떤 칸이든 쓰기 전에 거절한다 — 켜기가 409 면 이름도 그대로다.
    if (Boolean.TRUE.equals(req.enabled()) && locked.activeVersionId() == null) {
      throw WorkflowException.notPublished();
    }
    // 꺼져 있던 것을 켤 때만 시작 조건 겹침을 본다 — 이미 켜진 것의 재저장·끄기는 막지 않는다.
    if (Boolean.TRUE.equals(req.enabled()) && !locked.enabled()) {
      assertNoStartOverlap(locked, modelLoader.get(locked.activeVersionId()));
    }
    if (req.name() != null && !req.name().equals(locked.name())) {
      assertNameFree(locked.projectId(), req.name(), locked.id());
      try {
        workflowRepository.updateName(locked.id(), req.name());
      } catch (DuplicateKeyException e) {
        throw WorkflowException.nameTaken();
      }
    }
    if (req.enabled() != null && req.enabled() != locked.enabled()) {
      workflowRepository.updateEnabled(locked.id(), req.enabled());
    }
    return detail(reload(locked.id()));
  }

  /**
   * 시작 조건 겹침 거절(WP-2119) — 프로젝트 켜기 잠금을 잡은 뒤(동시에 켜는 두 정의가 서로를 못 보는 경합을 막는다) 켜진 다른 정의의 활성 모델과 비교한다.
   * 구성원 표는 한 번만 읽어 모든 모델에 같이 쓴다. 쓰기 전에 부른다.
   */
  private void assertNoStartOverlap(WorkflowRow locked, WorkflowModel mine) {
    workflowRepository.acquireProjectEnableLock(locked.projectId());
    List<StartOverlap.Other> others =
        workflowRepository.findOtherEnabledPublished(locked.projectId(), locked.id()).stream()
            .map(o -> new StartOverlap.Other(o.name(), modelLoader.get(o.activeVersionId())))
            .toList();
    if (others.isEmpty()) {
      return;
    }
    StartOverlap.find(mine, others, memberLookup.activeMembersOf(locked.projectId()))
        .ifPresent(
            o -> {
              throw WorkflowException.startConditionOverlap(o.otherName(), o.personName());
            });
  }

  // ───────────────────────── 접근 ─────────────────────────

  /** 읽을 수 있음이 확인된 워크플로우와 그 프로젝트. */
  private record Readable(WorkflowRow workflow, ProjectRow project) {}

  /** 경로의 projectId → 프로젝트(없으면 프로젝트 404). 가드가 key 기반이라 먼저 읽는다. */
  private ProjectRow projectById(long projectId) {
    return projectRepository.findById(projectId).orElseThrow(ProjectNotFoundException::hidden);
  }

  /** 읽을 수 있는 프로젝트(못 보면 없는 것과 같은 프로젝트 404). */
  private ProjectRow readableProject(long projectId, long callerId) {
    return accessGuard.assertReadable(projectById(projectId).key(), callerId);
  }

  /** 없음·못 봄·지운 프로젝트를 구별하지 않는 같은 404. */
  private Readable readable(long workflowId, long callerId) {
    WorkflowRow workflow =
        workflowRepository.findById(workflowId).orElseThrow(WorkflowException::notFound);
    ProjectRow project =
        projectRepository
            .findById(workflow.projectId())
            .filter(p -> accessGuard.canRead(p, callerId))
            .orElseThrow(WorkflowException::notFound);
    return new Readable(workflow, project);
  }

  /** 읽기(404) → OWNER(403) → 잠금. 잠그기 전에 읽은 초안·활성·시각은 낡았을 수 있어 버리고 잠근 행만 돌려준다. */
  private WorkflowRow lockForWrite(long workflowId, long actorId) {
    Readable seen = readable(workflowId, actorId);
    accessGuard.assertWithRole(seen.project().key(), actorId, OWNER);
    return workflowRepository
        .lockById(seen.workflow().id())
        .orElseThrow(WorkflowException::notFound);
  }

  // ───────────────────────── 규칙 ─────────────────────────

  /** 검증 결과(모델과 검증에 쓴 구성원 표는 파서 ERROR 가 있으면 null). */
  private record Checked(
      WorkflowModel model, ProjectMembers members, List<WorkflowProblem> problems) {

    /** 게시를 막는 문제가 하나라도 있는가. */
    boolean hasError() {
      return problems.stream().anyMatch(p -> WorkflowProblem.ERROR.equals(p.severity()));
    }
  }

  /** 저장·게시·GET·validate 가 함께 쓰는 검증: 파싱 → (모델이 있으면) 새로 읽은 구성원으로 검증 → 두 목록을 합친다. */
  private Checked check(long projectId, String yaml) {
    ParseResult parsed = WorkflowYamlParser.parse(yaml);
    List<WorkflowProblem> problems = new ArrayList<>(parsed.problems());
    ProjectMembers members = null;
    if (parsed.model() != null) {
      members = memberLookup.membersOf(projectId);
      problems.addAll(WorkflowValidator.validate(parsed.model(), members, parsed.source()));
    }
    return new Checked(parsed.model(), members, List.copyOf(problems));
  }

  /** 저장할 글의 크기 상한(파서와 같은 규칙). */
  private static void assertSize(String yaml) {
    if (WorkflowYamlParser.isTooLarge(yaml)) {
      throw WorkflowException.yamlTooLarge();
    }
  }

  /** 이름 사전 검사 — 경합은 유일 색인이 막는다. */
  private void assertNameFree(long projectId, String name, Long exceptId) {
    if (workflowRepository.existsByName(projectId, name, exceptId)) {
      throw WorkflowException.nameTaken();
    }
  }

  /** 초안 충돌 검사 — DB 는 마이크로초, 클라이언트는 밀리초라 밀리초로 비교한다. null 이면 생략. */
  private static void assertNotChanged(WorkflowRow locked, Instant expected) {
    if (expected != null && !millis(expected).equals(millis(locked.draftUpdatedAt()))) {
      throw WorkflowException.draftConflict();
    }
  }

  /** 다음 초안 시각 = max(지금, 이전 + 1ms) — 같은 밀리초에 두 번 저장되거나 시계가 뒤처져도 충돌 검사가 놓치지 않는다. */
  private static Instant nextDraftTime(Instant previous) {
    Instant now = nowMillis();
    Instant least = millis(previous).plusMillis(1);
    return now.isAfter(least) ? now : least;
  }

  /** 밀리초로 자른 지금. */
  private static Instant nowMillis() {
    return millis(Instant.now());
  }

  /** 초안 시각의 단위는 밀리초다. */
  private static Instant millis(Instant at) {
    return at.truncatedTo(ChronoUnit.MILLIS);
  }

  // ───────────────────────── 읽기·응답 ─────────────────────────

  /** 그 워크플로우 안에서만 번호로 찾는다. */
  private WorkflowVersionRow versionIn(long workflowId, int versionNo) {
    return workflowRepository
        .findVersion(workflowId, versionNo)
        .orElseThrow(WorkflowException::versionNotFound);
  }

  /** 같은 트랜잭션에서 방금 쓴 행을 다시 읽는다 — 응답은 저장된 값이어야 한다. */
  private WorkflowRow reload(long workflowId) {
    return workflowRepository.findById(workflowId).orElseThrow(WorkflowException::notFound);
  }

  /** Detail 응답을 만든다. */
  private WorkflowDetail detail(WorkflowRow w) {
    WorkflowActiveVersion active =
        Optional.ofNullable(w.activeVersionId())
            .flatMap(workflowRepository::findVersionSummaryById)
            .map(
                v ->
                    new WorkflowActiveVersion(
                        v.versionNo(),
                        v.createdAt(),
                        v.createdBy() == null
                            ? null
                            : actorsOf(Set.of(v.createdBy())).get(v.createdBy())))
            .orElse(null);
    return new WorkflowDetail(
        w.id(),
        w.projectId(),
        w.name(),
        w.enabled(),
        active,
        w.draftYaml(),
        w.draftUpdatedAt(),
        check(w.projectId(), w.draftYaml()).problems());
  }

  /** 게시자 id → 요약. 조회 한 번이며 사용자 행이 없으면 표에 없다(응답은 null). */
  private Map<Long, WorkflowActor> actorsOf(Collection<Long> userIds) {
    return userRepository.findAssigneeInfos(userIds, TenantContext.get()).stream()
        .collect(
            Collectors.toMap(
                AssigneeInfo::id, u -> new WorkflowActor(u.id(), u.username(), u.name())));
  }
}
