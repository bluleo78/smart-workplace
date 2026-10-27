package com.workplace.issue.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.ConvertParentEpicLinksRequest;
import com.workplace.issue.dto.ConvertParentEpicLinksResponse;
import com.workplace.issue.dto.ConvertParentEpicLinksResponse.Outcome;
import com.workplace.issue.dto.ConvertParentEpicLinksResponse.Row;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.ParentTarget;
import com.workplace.issue.repository.IssueExternalLinkRepository;
import com.workplace.issue.repository.IssueExternalLinkRepository.LinkRow;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserResponse;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 부모 에픽 외부 링크 일괄 변환(WP-1038) — Jira 이관 때 다른 프로젝트 에픽에 속한 이슈는 부모로 걸 수 없어 「상위 에픽(PARENT_EPIC)」 외부 링크로
 * 남겼다. 이제 다른 프로젝트 에픽도 부모가 될 수 있으므로, 그 링크가 가리키는 에픽을 Works 에서 찾아 실제 부모 관계로 바꾸고 링크를 지운다.
 *
 * <p>에픽 찾기 — ① 링크 키를 원본 키(import_source_key)로 가져온 활성 이슈가 워크스페이스에 하나뿐이면 그것(여럿이면 모호함) ② 없으면 링크 키를
 * Works 이슈 키(예: PLAN-12)로 읽어 찾는다. 규칙은 일반 부모 지정과 같다(IssueService.resolveParent) — 하위 태스크·에픽 자식, 개인
 * 프로젝트, 에픽이 아닌 부모, 완료 에픽 아래 미완료 자식은 바꾸지 않고 사유로 알린다.
 *
 * <p>가져오기와 같이 사람 관리자만 쓴다. 바꿀 때 부모 변경 이력과 양쪽 프로젝트 화면 갱신은 남기지만 워처 알림·AI 작업은 만들지 않는다. dryRun 은 판정만 하고
 * 아무것도 쓰지 않는다(감사 로그도 남기지 않는다).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ParentEpicLinkConversionService {

  /** 감사 로그 행위 종류 — 실제 변환 한 번에 한 건. */
  static final String AUDIT_ACTION = "ISSUE_PARENT_EPIC_LINKS_CONVERTED";

  /** 원본 키 조회 상한 — 둘만 보면 「하나뿐인가」를 가를 수 있다. */
  private static final int SOURCE_KEY_PROBE = 2;

  /** Jira 이슈 주소의 키 앞 경로 — 링크에 키가 없을 때 주소에서 키를 꺼낸다. */
  private static final String BROWSE_PATH = "/browse/";

  private final IssueImportGuard importGuard;
  private final IssueService issueService;
  private final IssueExternalLinkRepository linkRepository;
  private final IssueRelationTypeRepository relationTypeRepository;
  private final IssueRepository issueRepository;
  private final IssueTypeRepository typeRepository;
  private final ProjectRepository projectRepository;
  private final AuditLogService auditLogService;
  private final ProjectAccessGuard accessGuard;

  /** 줄 하나의 판정 — 찾은 에픽(없으면 null)과 그 프로젝트. */
  private record Verdict(Outcome outcome, IssueRow epic, ProjectRow epicProject) {

    static Verdict of(Outcome outcome) {
      return new Verdict(outcome, null, null);
    }
  }

  /**
   * PARENT_EPIC 링크를 링크 id 순으로 limit 건 보고 줄마다 판정한다. dryRun 이 아니면 CONVERT 줄을 실제로 바꾼다(한 트랜잭션 — 한 줄이라도
   * 쓰기 중 실패하면 모두 되돌린다).
   *
   * @throws com.workplace.issue.exception.IssueImportException 사람 관리자가 아님(403), 개인 프로젝트 지정(400)
   */
  public ConvertParentEpicLinksResponse convert(long callerId, ConvertParentEpicLinksRequest req) {
    UserResponse caller = importGuard.requireHumanAdmin(callerId);
    // 자식 프로젝트를 좁히면 가져오기와 같은 규칙으로 프로젝트를 고른다(없으면 404, 개인 프로젝트 400).
    ProjectRow scope =
        req.projectKey() == null || req.projectKey().isBlank()
            ? null
            : importGuard.resolveImportProject(req.projectKey().strip());
    boolean dryRun = req.dryRun();

    // PARENT_EPIC 은 기본 유형이라 모든 워크스페이스에 있다. 없으면(이론상) 바꿀 링크도 없다.
    List<LinkRow> links =
        relationTypeRepository
            .findByCode(IssueRelationBuiltIns.PARENT_EPIC)
            .map(
                t ->
                    linkRepository.findByTypeOnActiveIssues(
                        t.id(), scope == null ? null : scope.id(), req.effectiveLimit()))
            .orElse(List.of());

    Map<Long, ProjectRow> projects = new HashMap<>();
    // 같은 요청 안에서 이미 부모를 붙인(dryRun 이면 붙일) 자식 — 한 이슈에 링크가 둘 이상이면 뒤 줄은 「이미 부모 있음」.
    Set<Long> parented = new HashSet<>();
    Map<Outcome, Integer> counts = new EnumMap<>(Outcome.class);
    for (Outcome o : Outcome.values()) counts.put(o, 0);
    List<Row> rows = new ArrayList<>();

    for (LinkRow link : links) {
      String extKey = extKeyOf(link);
      // 조회 쿼리가 지운 이슈·지운 프로젝트를 이미 거르지만, 그사이 지워졌으면 던지지 않고 「찾을 수 없음」으로 둔다.
      IssueRow child = issueRepository.findById(link.issueId()).orElse(null);
      ProjectRow childProject = child == null ? null : project(projects, child.projectId());
      if (childProject == null) {
        counts.merge(Outcome.NOT_FOUND, 1, Integer::sum);
        rows.add(new Row(link.id(), null, extKey, Outcome.NOT_FOUND, null));
        continue;
      }
      Verdict v = judge(callerId, child, childProject, extKey, parented, projects);
      if (v.outcome() == Outcome.CONVERT) {
        parented.add(child.id());
        if (!dryRun) {
          ParentTarget target =
              new ParentTarget(
                  v.epicProject().id().equals(childProject.id()) ? null : v.epicProject().key(),
                  v.epic().number());
          // 판정 뒤 그사이 부모가 생겼으면(동시 수정) 쓰지 않고 「이미 부모 있음」으로 알린다. 링크도 남긴다.
          if (issueService.attachParentFromLink(callerId, childProject, child.number(), target)) {
            linkRepository.deleteById(link.id());
          } else {
            v = Verdict.of(Outcome.SKIP_HAS_PARENT);
          }
        }
      }
      counts.merge(v.outcome(), 1, Integer::sum);
      rows.add(
          new Row(
              link.id(),
              childProject.key() + "-" + child.number(),
              extKey,
              v.outcome(),
              v.epic() == null ? null : v.epicProject().key() + "-" + v.epic().number()));
    }

    if (!dryRun) {
      Map<String, Object> meta = new LinkedHashMap<>();
      meta.put("projectKey", scope == null ? null : scope.key());
      meta.put("scanned", links.size());
      counts.forEach((o, n) -> meta.put(o.name(), n));
      auditLogService.log(
          callerId,
          caller.username(),
          AUDIT_ACTION,
          "issue",
          scope == null ? null : scope.key(),
          "부모 에픽 외부 링크 변환",
          null,
          null,
          "SUCCESS",
          null,
          meta);
    }
    return new ConvertParentEpicLinksResponse(dryRun, links.size(), counts, rows);
  }

  /**
   * 한 줄 판정 — 에픽 찾기(원본 키 → Works 키) → 읽기 권한 → 자식이 에픽인가 → 부모 규칙({@link
   * IssueService#checkParentRules}, 일반 부모 지정과 같은 한 곳) → 이미 부모 있음 순. 실제 변환은
   * IssueService.resolveParent 가 같은 규칙으로 다시 보므로 dryRun 과 실제 변환의 판정이 같다.
   */
  private Verdict judge(
      long callerId,
      IssueRow child,
      ProjectRow childProject,
      String extKey,
      Set<Long> parented,
      Map<Long, ProjectRow> projects) {
    if (extKey == null) return Verdict.of(Outcome.NOT_FOUND);
    // 원본 키로 가져온 이슈 — 하나뿐이어야 한다(조회가 지운 프로젝트 이슈는 거른다).
    List<IssueRow> bySource = issueRepository.findActiveByImportSourceKey(extKey, SOURCE_KEY_PROBE);
    if (bySource.size() > 1) return Verdict.of(Outcome.AMBIGUOUS);
    Optional<IssueRow> found =
        bySource.isEmpty() ? findByWorksKey(extKey) : Optional.of(bySource.get(0));
    if (found.isEmpty()) return Verdict.of(Outcome.NOT_FOUND);
    IssueRow epic = found.get();
    ProjectRow epicProject = project(projects, epic.projectId());
    // 일반 부모 지정(resolveParent ①)과 같이 — 에픽 프로젝트가 없거나(삭제) 호출자가 읽을 수 없으면(관리자도 남의 개인 프로젝트는 못 본다) 찾을 수
    // 없음.
    // 키는 싣지 않는다.
    if (epicProject == null
        || (!epicProject.id().equals(childProject.id())
            && !accessGuard.canRead(epicProject, callerId))) {
      return Verdict.of(Outcome.NOT_FOUND);
    }

    String childType = typeRepository.findById(child.typeId()).orElseThrow().name();
    Outcome outcome;
    if ("EPIC".equals(childType)) {
      // 에픽은 부모를 가질 수 없다 — 일반 경로도 resolveParent 전에 같은 규칙으로 거른다.
      outcome = Outcome.EPIC_CHILD;
    } else {
      IssueService.ParentViolation violation =
          IssueService.checkParentRules(
              childProject,
              "SUBTASK".equals(childType),
              child.status(),
              epic,
              typeRepository.findById(epic.typeId()).orElseThrow(),
              epicProject,
              true);
      if (violation != null) {
        outcome = toOutcome(violation);
      } else if (child.parentIssueId() != null || parented.contains(child.id())) {
        outcome = Outcome.SKIP_HAS_PARENT;
      } else {
        outcome = Outcome.CONVERT;
      }
    }
    return new Verdict(outcome, epic, epicProject);
  }

  /** 부모 규칙 위반 → 판정. 하위 태스크 관련 위반은 모두 SUBTASK 로 묶는다(하위 태스크는 에픽을 부모로 둘 수 없다). */
  private static Outcome toOutcome(IssueService.ParentViolation violation) {
    return switch (violation) {
      case PERSONAL -> Outcome.PERSONAL;
      case SUBTASK_CROSS_PROJECT, SUBTASK_PARENT_SUBTASK, SUBTASK_PARENT_EPIC -> Outcome.SUBTASK;
      case NOT_EPIC -> Outcome.NOT_EPIC;
      case DONE_EPIC_OPEN_CHILD -> Outcome.DONE_EPIC_OPEN_CHILD;
    };
  }

  /** 링크 키를 Works 이슈 키로 읽어 활성 이슈를 찾는다 — 키 꼴이 아니거나 프로젝트·이슈가 없으면 빈 값. */
  private Optional<IssueRow> findByWorksKey(String extKey) {
    return IssueKeys.parse(extKey)
        .flatMap(
            k ->
                projectRepository
                    .findByKey(k.projectKey())
                    .flatMap(p -> issueRepository.findByProjectAndNumber(p.id(), k.number())));
  }

  /** 링크가 가리키는 원본 키 — 링크의 키, 없으면 주소의 {@code /browse/} 뒤(쿼리·조각 제외). 둘 다 없으면 null. */
  static String extKeyOf(LinkRow link) {
    if (link.key() != null && !link.key().isBlank()) return link.key().strip();
    String url = link.url();
    int at = url == null ? -1 : url.lastIndexOf(BROWSE_PATH);
    if (at < 0) return null;
    String tail = url.substring(at + BROWSE_PATH.length());
    int end = tail.length();
    for (char c : new char[] {'/', '?', '#'}) {
      int i = tail.indexOf(c);
      if (i >= 0 && i < end) end = i;
    }
    tail = tail.substring(0, end).strip();
    return tail.isEmpty() ? null : tail;
  }

  /** 활성 프로젝트 행 — 같은 요청 안에서 한 번만 읽는다. 지운 프로젝트면 null(호출자가 「찾을 수 없음」으로 다룬다). */
  private ProjectRow project(Map<Long, ProjectRow> cache, long projectId) {
    if (cache.containsKey(projectId)) return cache.get(projectId);
    ProjectRow row = projectRepository.findById(projectId).orElse(null);
    cache.put(projectId, row);
    return row;
  }
}
