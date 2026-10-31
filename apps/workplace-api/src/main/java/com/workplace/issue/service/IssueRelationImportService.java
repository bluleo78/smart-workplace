package com.workplace.issue.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.service.AuditLogService;
import com.workplace.issue.domain.IssueDependencyGraph;
import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.domain.IssueKeys.IssueKey;
import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.ImportRelationsRequest;
import com.workplace.issue.dto.ImportRelationsResponse;
import com.workplace.issue.dto.IssueRelationTypeRow;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueRelationRepository;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueRelationService.StoredPair;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserResponse;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 관계 일괄 가져오기(WP-887) — 이슈를 모두 가져온 뒤 이슈 사이 관계(관련·중복·복제·원인·사용자 정의, 차단)를 한 번에 넣는다. 관리자·프로젝트
 * 소유자(사람)만(WP-1239), 개인 프로젝트 불가 — 이슈 가져오기와 같은 관문({@link IssueImportGuard})이다.
 *
 * <p>전부 검증한 뒤에 쓴다 — 틀린 줄이 하나라도 있으면 아무것도 쓰지 않고 틀린 줄을 모두 알린다(400). 이미 있는 관계·같은 요청 안의 중복 줄(방향 없는 유형의
 * 뒤집힌 쌍 포함)은 오류 없이 건너뛰어 재시도가 멱등이다. 이력·알림은 만들지 않고, 끝나면 관계가 생긴 프로젝트마다 화면 갱신 신호만 한 번 보낸다(AI 작업 터치 없음).
 *
 * <p>차단(BLOCKS)은 관계 행이 아니라 {@code issue_dependency} 로 간다 — 블로커 계산이 거기에 기대고 있다. 프로젝트 의존성 잠금을 잡고, 순환
 * 검사는 이미 저장된 간선에 이 요청에서 앞서 받아들인 간선까지 더해 본다. 숨긴 유형도 쓸 수 있다(이관 직전 숨김 때문에 일괄이 통째로 실패하지 않게).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueRelationImportService {

  /** 감사 로그 행위 종류 — 요청마다 한 건. */
  static final String AUDIT_ACTION = "ISSUE_RELATIONS_IMPORTED";

  private final IssueImportGuard importGuard;
  private final IssueRelationTypeService relationTypeService;
  private final IssueRelationTypeRepository typeRepository;
  private final IssueRelationRepository relationRepository;
  private final IssueDependencyRepository dependencyRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueChangeNotifier changeNotifier;
  private final AuditLogService auditLogService;
  private final ObjectMapper objectMapper;

  /** 형식이 맞는 줄 — 유형을 풀고 상대를 (프로젝트 키, 번호)로 나눈 것. 이슈 존재 여부는 아직 모른다. */
  private record Parsed(
      int index, IssueRelationTypeRow type, int fromNumber, String toProjectKey, int toNumber) {}

  /** 틀린 줄 — 몇 번째(0부터)인지와 사유. */
  private record RowError(int index, String reason) {}

  /** 쓰기 계획 한 줄 — 저장할 (source, target) 와 알림에 쓸 두 이슈. */
  private record Planned(
      IssueRelationTypeRow type, long source, long target, IssueRow from, IssueRow to) {}

  /** 요청 안 중복 줄을 거르는 키. */
  private record PairKey(long typeId, long source, long target) {}

  /**
   * 관계를 일괄로 넣는다. 한 트랜잭션 — 어느 검증이든 실패하면 아무것도 남지 않는다.
   *
   * @return 새로 만든 수와 건너뛴 수(이미 있거나 같은 요청 안의 중복)
   * @throws IssueImportException 관리자·그 프로젝트 OWNER 인 사람이 아님(403), 개인 프로젝트(400), 틀린 줄이 있음(400, {@code
   *     errors.rows})
   */
  public ImportRelationsResponse importRelations(
      long callerId, String projectKey, ImportRelationsRequest req) {
    // 권한·프로젝트 — 테넌트 ADMIN 이거나 이 팀 프로젝트의 OWNER 인 사람만(WP-1239, 이슈 가져오기와 같은 관문).
    IssueImportGuard.ImportAccess access = importGuard.requireImportAccess(callerId, projectKey);
    UserResponse caller = access.caller();
    ProjectRow project = access.project();

    List<RowError> errors = new ArrayList<>();
    List<Parsed> parsed = parse(req.relations(), project, errors);
    Resolved resolved = loadIssues(callerId, project, parsed);

    // 차단 줄이 있으면 프로젝트 의존성 잠금을 먼저 — 순환 검사와 저장 사이에 다른 의존성 추가가 끼지 않게(WP-758 과 같은 이유).
    if (parsed.stream().anyMatch(p -> IssueRelationBuiltIns.BLOCKS.equals(p.type().code()))) {
      dependencyRepository.lockProjectDependencies(project.id());
    }

    List<Planned> plan = new ArrayList<>();
    int skipped = plan(project, parsed, resolved, plan, errors);

    if (!errors.isEmpty()) {
      errors.sort(Comparator.comparingInt(RowError::index));
      throw IssueImportException.invalidRelations(toJson(errors), errors.size());
    }

    int created = 0;
    Map<Long, IssueRow> firstChanged = new LinkedHashMap<>();
    for (Planned p : plan) {
      boolean inserted;
      if (IssueRelationBuiltIns.BLOCKS.equals(p.type().code())) {
        // 차단 — 검증 단계에서 없음을 확인했고 잠금을 쥐고 있어 그대로 넣는다.
        dependencyRepository.add(p.source(), p.target(), callerId);
        inserted = true;
      } else {
        inserted =
            relationRepository.insertIfAbsent(p.type().id(), p.source(), p.target(), callerId);
      }
      if (inserted) {
        created++;
        firstChanged.putIfAbsent(p.from().projectId(), p.from());
        firstChanged.putIfAbsent(p.to().projectId(), p.to());
      } else {
        skipped++;
      }
    }

    // 화면 갱신 — 프론트는 프로젝트 키 단위로 다시 읽으므로 관계가 생긴 프로젝트마다 한 번이면 된다. 아무것도 만들지 않았으면 신호도 없다.
    for (Map.Entry<Long, IssueRow> e : firstChanged.entrySet()) {
      ProjectRow p = resolved.projectsById().get(e.getKey());
      changeNotifier.updatedWithoutTouch(p, e.getValue().number(), e.getValue().id(), callerId);
    }
    Map<String, Object> meta = new LinkedHashMap<>();
    meta.put("created", created);
    meta.put("skipped", skipped);
    auditLogService.log(
        callerId,
        caller.username(),
        AUDIT_ACTION,
        "issue",
        project.key(),
        "이슈 관계 가져오기",
        null,
        null,
        "SUCCESS",
        null,
        meta);
    return new ImportRelationsResponse(created, skipped);
  }

  // ── 1) 형식 ─────────────────────────────────────────────────────────────────────────────

  /**
   * 줄마다 형식을 본다 — 유형을 코드·이름으로 풀고(외부 전용은 거절, 숨김은 허용), 상대를 {@code toNumber} 와 {@code toKey} 중 정확히 하나로
   * 받아 (프로젝트 키, 번호)로 나눈다. 틀린 줄은 {@code errors} 에 모으고 넘어간다.
   */
  private List<Parsed> parse(
      List<ImportRelationsRequest.Item> items, ProjectRow project, List<RowError> errors) {
    Map<String, Optional<IssueRelationTypeRow>> typeCache = new HashMap<>();
    List<Parsed> parsed = new ArrayList<>();
    for (int i = 0; i < items.size(); i++) {
      ImportRelationsRequest.Item item = items.get(i);
      Optional<IssueRelationTypeRow> type =
          typeCache.computeIfAbsent(item.type().trim(), this::lockedType);
      if (type.isEmpty()) {
        errors.add(new RowError(i, "관계 유형을 찾을 수 없습니다: " + item.type()));
        continue;
      }
      if (type.get().externalOnly()) {
        errors.add(new RowError(i, "외부 링크에만 쓰는 유형입니다: " + item.type()));
        continue;
      }
      boolean hasNumber = item.toNumber() != null;
      boolean hasKey = item.toKey() != null && !item.toKey().isBlank();
      if (hasNumber == hasKey) {
        errors.add(new RowError(i, "toNumber 와 toKey 중 정확히 하나를 주세요"));
        continue;
      }
      if (hasNumber) {
        parsed.add(new Parsed(i, type.get(), item.from(), project.key(), item.toNumber()));
        continue;
      }
      Optional<IssueKey> key = IssueKeys.parse(item.toKey().trim()).filter(k -> k.number() >= 1);
      if (key.isEmpty()) {
        errors.add(new RowError(i, "toKey 형식이 올바르지 않습니다(예: WPV-28): " + item.toKey()));
        continue;
      }
      parsed.add(
          new Parsed(i, type.get(), item.from(), key.get().projectKey(), key.get().number()));
    }
    return parsed;
  }

  /** 유형 한 개를 코드·이름으로 찾고 공유 잠금한다 — 같은 순간의 유형 삭제와 차례를 세운다(삭제가 이 커밋을 기다려 넣은 관계까지 본다). */
  private Optional<IssueRelationTypeRow> lockedType(String codeOrName) {
    return relationTypeService
        .resolveByCodeOrName(codeOrName)
        .flatMap(t -> typeRepository.findByIdForShare(t.id()));
  }

  // ── 2) 이슈·프로젝트 조회 ───────────────────────────────────────────────────────────────

  /**
   * 조회 결과 — 프로젝트(키·id 별), 쓸 수 없는 프로젝트의 사유(키별), 이슈(프로젝트 키별 번호 → 이슈).
   *
   * @param unusable 상대로 쓸 수 없는 프로젝트 키 → 사유
   */
  private record Resolved(
      Map<String, ProjectRow> projects,
      Map<Long, ProjectRow> projectsById,
      Map<String, String> unusable,
      Map<String, Map<Integer, IssueRow>> issues) {}

  /**
   * 형식이 맞는 줄이 가리키는 프로젝트와 이슈를 프로젝트마다 한 번에 읽는다(1000줄이어도 쿼리는 프로젝트 수만큼). 다른 프로젝트는 호출자가 읽을 수 있고 개인 프로젝트가
   * 아니어야 상대가 된다 — 없는 키와 읽을 수 없는 키는 같은 사유로 답한다.
   */
  private Resolved loadIssues(long callerId, ProjectRow project, List<Parsed> parsed) {
    Map<String, Set<Integer>> numbers = new HashMap<>();
    numbers.put(project.key(), new HashSet<>());
    for (Parsed p : parsed) {
      numbers.get(project.key()).add(p.fromNumber());
      numbers.computeIfAbsent(p.toProjectKey(), k -> new HashSet<>()).add(p.toNumber());
    }
    Map<String, ProjectRow> projects = new HashMap<>();
    Map<Long, ProjectRow> byId = new HashMap<>();
    Map<String, String> unusable = new HashMap<>();
    Map<String, Map<Integer, IssueRow>> issues = new HashMap<>();
    projects.put(project.key(), project);
    byId.put(project.id(), project);
    for (Map.Entry<String, Set<Integer>> e : numbers.entrySet()) {
      String key = e.getKey();
      ProjectRow target =
          key.equals(project.key()) ? project : projectRepository.findByKey(key).orElse(null);
      if (target == null || !accessGuard.canRead(target, callerId)) {
        unusable.put(key, "프로젝트를 찾을 수 없습니다: " + key);
        continue;
      }
      if (target.isPersonal()) {
        unusable.put(key, "개인 프로젝트 이슈는 다른 프로젝트와 관계를 맺을 수 없습니다: " + key);
        continue;
      }
      projects.put(key, target);
      byId.put(target.id(), target);
      issues.put(key, issueRepository.findByProjectAndNumbers(target.id(), e.getValue()));
    }
    return new Resolved(projects, byId, unusable, issues);
  }

  // ── 3) 줄별 검증과 쓰기 계획 ────────────────────────────────────────────────────────────

  /**
   * 줄마다 이슈를 찾고 규칙을 검사해 쓰기 계획을 만든다. 요청 안 중복 줄(같은 유형·같은 저장 쌍 — 방향 없는 유형은 (작은 id, 큰 id) 로 정규화한 뒤 비교)은
   * 계획에서 빼고 건너뛴 수로 센다.
   *
   * <p>차단 줄은 순환도 본다 — 이미 저장된 간선과 이 요청에서 앞서 받아들인 간선을 합친 그래프에서, 상대에서 출발해 A 에 닿으면 순환이다. 이미 같은 간선이 저장돼
   * 있으면 건너뛴다.
   *
   * @return 건너뛴 수(쓰기 단계에서 「이미 있음」으로 건너뛰는 것은 따로 센다)
   */
  private int plan(
      ProjectRow project,
      List<Parsed> parsed,
      Resolved resolved,
      List<Planned> plan,
      List<RowError> errors) {
    Set<PairKey> seen = new HashSet<>();
    Map<Long, Set<Long>> acceptedEdges = new HashMap<>();
    Map<Long, List<Long>> storedEdges = new HashMap<>();
    int skipped = 0;
    for (Parsed p : parsed) {
      boolean cross = !p.toProjectKey().equals(project.key());
      String unusable = resolved.unusable().get(p.toProjectKey());
      if (unusable != null) {
        errors.add(new RowError(p.index(), unusable));
        continue;
      }
      IssueRow from = resolved.issues().get(project.key()).get(p.fromNumber());
      if (from == null) {
        errors.add(new RowError(p.index(), "이 프로젝트에 없는 이슈 번호입니다: from " + p.fromNumber()));
        continue;
      }
      IssueRow to = resolved.issues().get(p.toProjectKey()).get(p.toNumber());
      if (to == null) {
        errors.add(
            new RowError(p.index(), "상대 이슈를 찾을 수 없습니다: " + p.toProjectKey() + "-" + p.toNumber()));
        continue;
      }
      if (from.id().equals(to.id())) {
        errors.add(new RowError(p.index(), "이슈 자신과는 관계를 걸 수 없습니다"));
        continue;
      }
      boolean blocks = IssueRelationBuiltIns.BLOCKS.equals(p.type().code());
      if (blocks && cross) {
        errors.add(new RowError(p.index(), "차단은 같은 프로젝트 이슈끼리만 걸 수 있습니다"));
        continue;
      }
      StoredPair pair = StoredPair.of(p.type().directed(), from.id(), to.id());
      if (!seen.add(new PairKey(p.type().id(), pair.sourceIssueId(), pair.targetIssueId()))) {
        skipped++;
        continue;
      }
      if (blocks) {
        if (dependencyRepository.exists(pair.sourceIssueId(), pair.targetIssueId())) {
          skipped++;
          continue;
        }
        if (wouldCycle(pair.sourceIssueId(), pair.targetIssueId(), acceptedEdges, storedEdges)) {
          errors.add(
              new RowError(p.index(), "차단이 순환을 만듭니다: " + project.key() + "-" + p.fromNumber()));
          continue;
        }
        acceptedEdges
            .computeIfAbsent(pair.sourceIssueId(), k -> new LinkedHashSet<>())
            .add(pair.targetIssueId());
      }
      plan.add(new Planned(p.type(), pair.sourceIssueId(), pair.targetIssueId(), from, to));
    }
    return skipped;
  }

  /**
   * (from → to) 간선을 더하면 순환이 되는가 — to 에서 출발해 from 에 닿으면 순환이다. 이웃은 저장된 간선(DB, 노드마다 한 번만 읽어 둔다)과 이
   * 요청에서 앞서 받아들인 간선의 합집합이다. 탐색은 {@link IssueDependencyGraph#reaches} — 의존성 API 와 같다.
   */
  private boolean wouldCycle(
      long from, long to, Map<Long, Set<Long>> accepted, Map<Long, List<Long>> stored) {
    return IssueDependencyGraph.reaches(
        to,
        from,
        cur -> {
          List<Long> next =
              new ArrayList<>(stored.computeIfAbsent(cur, dependencyRepository::findBlocksOf));
          next.addAll(accepted.getOrDefault(cur, Set.of()));
          return next;
        });
  }

  private String toJson(List<RowError> errors) {
    List<Map<String, Object>> rows = new ArrayList<>();
    for (RowError e : errors) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("index", e.index());
      row.put("reason", e.reason());
      rows.add(row);
    }
    try {
      return objectMapper.writeValueAsString(rows);
    } catch (JsonProcessingException ex) {
      throw new IllegalStateException(ex);
    }
  }
}
