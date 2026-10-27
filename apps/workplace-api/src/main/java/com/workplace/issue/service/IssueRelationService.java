package com.workplace.issue.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.global.security.PermissionChecker;
import com.workplace.global.util.LikePatternUtils;
import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.domain.IssueKeys.IssueKey;
import com.workplace.issue.domain.IssueRelationBuiltIns;
import com.workplace.issue.dto.AddIssueRelationRequest;
import com.workplace.issue.dto.IssueHistoryEntryResponse;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueLookupItem;
import com.workplace.issue.dto.IssueRelationTypeRow;
import com.workplace.issue.dto.IssueRelationView;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.IssueRelationException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueRelationRepository;
import com.workplace.issue.repository.IssueRelationRepository.LinkedRow;
import com.workplace.issue.repository.IssueRelationRepository.RelationRow;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 사이 관계(WP-887) — 관련·중복·복제·원인과 사용자 정의 유형을 같은·다른 프로젝트 이슈와 걸고 지우고, 상세 목록·이력 가림·관계 대상 찾기를 맡는다.
 * 차단(BLOCKS)은 여기 오지 않는다 — 저장·블로커 계산은 {@link IssueDependencyService} 그대로.
 *
 * <p>권한: 걸기·지우기 모두 주소 이슈 프로젝트의 워크플로 편집(멤버/ADMIN, {@code assertMember}) + 상대 이슈 프로젝트 읽기({@code
 * canRead}). 그래서 어느 쪽 팀이든 자기 이슈 화면에서 지울 수 있다. 상대를 읽을 수 없는 사람에게는 관계가 아예 보이지 않는다(상세 목록·이력 모두).
 *
 * <p>이력은 두 이슈 모두에 각자 쪽 말로 남기고, 실시간 갱신은 두 이슈 각자의 프로젝트로 보낸다. 알림(인박스·푸시)·AI 작업 터치는 내지 않는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueRelationService {

  /** 관계 대상 찾기 결과 상한. */
  static final int LOOKUP_LIMIT = 20;

  /** 번호 꼴({@code #12} 또는 {@code 12}). */
  private static final Pattern NUMBER_QUERY = Pattern.compile("^#?(\\d+)$");

  private static final String SIDE_SOURCE = "source";
  private static final String SIDE_TARGET = "target";

  private final IssueRelationRepository relationRepository;
  private final IssueRelationTypeRepository typeRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final PermissionChecker permissionChecker;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;
  private final ObjectMapper objectMapper;

  /**
   * 저장할 (source, target) 쌍 — 방향 없는 유형은 (작은 id, 큰 id) 로 정규화해 같은 쌍이 한 줄만 남게 한다. 가져오기(관계 일괄)도 같은 규칙을
   * 쓴다.
   */
  public record StoredPair(long sourceIssueId, long targetIssueId) {

    /**
     * @param directed 유형의 방향 있음 여부
     * @param sourceIssueId A 쪽으로 의도한 이슈
     * @param targetIssueId B 쪽으로 의도한 이슈
     */
    public static StoredPair of(boolean directed, long sourceIssueId, long targetIssueId) {
      if (directed) {
        return new StoredPair(sourceIssueId, targetIssueId);
      }
      return new StoredPair(
          Math.min(sourceIssueId, targetIssueId), Math.max(sourceIssueId, targetIssueId));
    }
  }

  /** 상대 이슈와 그 프로젝트. */
  private record Endpoint(ProjectRow project, IssueRow issue) {}

  // ── 걸기·지우기 ─────────────────────────────────────────────────────────────────────────

  /**
   * 관계 한 줄 걸기. 검사 순서가 존재 노출을 막는다 — 상대 프로젝트 읽기·상대 이슈 찾기가 실패하면 모두 같은 {@code
   * RELATION_TARGET_NOT_FOUND}, 개인 프로젝트 검사는 상대를 읽을 수 있음이 확인된 뒤에 한다(남의 개인 프로젝트 이슈가 있는지 드러내지 않게). 같은
   * 관계가 이미 있으면 그대로(이력·신호 없음).
   *
   * @return 이 이슈 기준 갱신된 관계 목록
   */
  public List<IssueRelationView> add(
      long callerId, String projectKey, int number, AddIssueRelationRequest req) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    IssueRow thisRow =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    IssueRelationTypeRow type = requireLinkableType(req.typeId());
    boolean thisIsSource = parseSide(req.side());
    assertSideAllowed(type, thisIsSource);
    Endpoint other = resolveTarget(callerId, project, req.target());
    if (other.issue().id().equals(thisRow.id())) {
      throw IssueRelationException.self();
    }
    boolean crossProject = !project.id().equals(other.project().id());
    if (crossProject && (project.isPersonal() || other.project().isPersonal())) {
      throw IssueRelationException.crossProjectNotAllowed();
    }

    StoredPair pair =
        thisIsSource
            ? StoredPair.of(type.directed(), thisRow.id(), other.issue().id())
            : StoredPair.of(type.directed(), other.issue().id(), thisRow.id());
    if (relationRepository.insertIfAbsent(
        type.id(), pair.sourceIssueId(), pair.targetIssueId(), callerId)) {
      boolean thisStoredAsSource = pair.sourceIssueId() == thisRow.id();
      recordBoth(
          IssueHistoryEventType.RELATION_ADDED,
          callerId,
          type,
          project,
          thisRow,
          other,
          thisStoredAsSource);
    }
    return listFor(callerId, thisRow, project);
  }

  /**
   * 관계 한 줄 지우기 — 주소 이슈 기준으로 거는 것과 같은 규칙(주소 이슈 편집 + 상대 읽기). 관계가 없거나, 주소 이슈가 끝이 아니거나, 상대가 삭제됐거나 읽을 수
   * 없으면 아무것도 하지 않는다(컨트롤러는 늘 204 — 보이지 않는 관계의 존재를 드러내지 않고, 아무 이슈 주소로 남의 관계를 지울 수 없게).
   */
  public void remove(long callerId, String projectKey, int number, long relationId) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    IssueRow thisRow =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    RelationRow rel = relationRepository.findById(relationId).orElse(null);
    if (rel == null) {
      return;
    }
    boolean thisIsSource = rel.sourceIssueId() == thisRow.id();
    if (!thisIsSource && rel.targetIssueId() != thisRow.id()) {
      return;
    }
    long otherId = thisIsSource ? rel.targetIssueId() : rel.sourceIssueId();
    IssueRow otherRow = issueRepository.findById(otherId).orElse(null);
    if (otherRow == null) {
      return;
    }
    ProjectRow otherProject =
        otherRow.projectId().equals(project.id())
            ? project
            : projectRepository.findById(otherRow.projectId()).orElse(null);
    if (otherProject == null
        || (!otherProject.id().equals(project.id())
            && !accessGuard.canRead(otherProject, callerId))) {
      return;
    }
    IssueRelationTypeRow type =
        typeRepository.findById(rel.typeId()).orElseThrow(IssueRelationException::notFound);
    if (relationRepository.deleteById(relationId) > 0) {
      recordBoth(
          IssueHistoryEventType.RELATION_REMOVED,
          callerId,
          type,
          project,
          thisRow,
          new Endpoint(otherProject, otherRow),
          thisIsSource);
    }
  }

  // ── 상세 목록·이력 가림 ─────────────────────────────────────────────────────────────────

  /**
   * 이 이슈의 관계 목록(차단 제외) — 상대가 삭제된 관계는 빼고, 상대 프로젝트를 프로젝트 id 별로 한 번씩 {@code canRead} 로 걸러 조회자가 읽을 수 있는
   * 것만 낸다. 정렬은 유형 정렬값 → 이 이슈 쪽 말({@link RelationListOrder}) → (프로젝트 키, 번호).
   *
   * @param project 이 이슈의 프로젝트(조회자가 이미 읽을 수 있음이 확인된 것)
   */
  @Transactional(readOnly = true)
  public List<IssueRelationView> listFor(long callerId, IssueRow issue, ProjectRow project) {
    List<LinkedRow> rows = relationRepository.findLinkedTo(issue.id());
    if (rows.isEmpty()) {
      return List.of();
    }
    Map<Long, IssueRelationTypeRow> types = RelationListOrder.typesById(typeRepository);
    Map<Long, Boolean> readable = new HashMap<>();
    readable.put(project.id(), true);
    return rows.stream()
        .filter(
            r ->
                readable.computeIfAbsent(
                    r.otherProjectId(), pid -> accessGuard.canRead(pid, callerId)))
        .map(r -> toView(r, types.get(r.typeId())))
        .sorted(
            RelationListOrder.byTypeThenLabel(
                    types, IssueRelationView::typeId, IssueRelationView::label)
                .thenComparing(v -> v.issue().projectKey())
                .thenComparingInt(v -> v.issue().number()))
        .toList();
  }

  /** 관계 한 줄 → 이 이슈 기준 화면 줄. 방향 없는 유형은 저장 쌍이 (작은 id, 큰 id) 라 쪽에 뜻이 없어 늘 source 로 낸다. */
  private static IssueRelationView toView(LinkedRow r, IssueRelationTypeRow type) {
    return new IssueRelationView(
        r.id(),
        r.typeId(),
        type.code(),
        type.labelFor(r.thisIsSource()),
        sideOf(type, r.thisIsSource()),
        new IssueRelationView.RelatedIssue(
            r.otherProjectKey(), r.otherNumber(), r.otherTitle(), r.otherStatus(), r.otherType()));
  }

  /** 이 이슈가 어느 쪽인지 응답 값 — 방향 없는 유형은 늘 {@code source}(외부 링크도 같은 규칙). */
  static String sideOf(IssueRelationTypeRow type, boolean thisIsSource) {
    return !type.directed() || thisIsSource ? SIDE_SOURCE : SIDE_TARGET;
  }

  /**
   * 관계 이력(RELATION_*)의 상대 정보를 조회자가 읽을 수 없으면 {@code {"hidden":true}} 로 바꾼다 — 유형 id·말은 남긴다. 부모 변경
   * 이력(PARENT_CHANGED)도 다른 프로젝트 에픽 쪽을 같은 규칙으로 가린다(WP-1038). 다른 이력은 그대로. 상대 프로젝트 키가 이제 없으면(삭제·키 변경)
   * 가린다(fail-closed). 읽기 검사는 키별로 한 번.
   *
   * @param viewerId 조회자. null 이면 특정 조회자가 없는 출력(AI 요약 입력 — 그 이슈를 읽는 모든 사람이 보는 결과)이라 다른 프로젝트 중 OPEN 만
   *     보인다
   * @param issueProject 이 이력의 이슈가 속한 프로젝트 — 같은 프로젝트 상대는 늘 보인다
   */
  @Transactional(readOnly = true)
  public List<IssueHistoryEntryResponse> redactHistory(
      Long viewerId, ProjectRow issueProject, List<IssueHistoryEntryResponse> history) {
    Map<String, Boolean> readableByKey = new HashMap<>();
    readableByKey.put(issueProject.key(), true);
    return history.stream()
        .map(
            h -> {
              if (isRelationEvent(h)) return redactRelationEntry(h, viewerId, readableByKey);
              if (IssueHistoryEventType.PARENT_CHANGED.name().equals(h.eventType())) {
                return redactParentEntry(h, viewerId, readableByKey);
              }
              return h;
            })
        .toList();
  }

  /**
   * 부모 변경 이력 한 건(WP-1038) — from/to 에 실린 부모 프로젝트 키를 조회자가 읽을 수 없으면 그쪽을 {@code {"hidden":true}} 로
   * 바꾼다. 키가 없는 값(WP-1038 이전 이력 — 그때는 같은 프로젝트 부모만 있었다)은 그대로 둔다. 읽을 수 없는 JSON 도 그대로(가릴 키를 알 수 없고, 예전
   * 이력은 같은 프로젝트뿐이다).
   */
  private IssueHistoryEntryResponse redactParentEntry(
      IssueHistoryEntryResponse h, Long viewerId, Map<String, Boolean> readableByKey) {
    if (h.toValue() == null) return h;
    ObjectNode payload;
    try {
      if (!(objectMapper.readTree(h.toValue()) instanceof ObjectNode o)) return h;
      payload = o;
    } catch (Exception e) {
      return h;
    }
    boolean changed = false;
    for (String side : List.of("from", "to")) {
      JsonNode keyNode = payload.path(side).path("projectKey");
      if (keyNode.isTextual()
          && !readableByKey.computeIfAbsent(keyNode.asText(), k -> canReadKey(k, viewerId))) {
        payload.set(side, objectMapper.createObjectNode().put("hidden", true));
        changed = true;
      }
    }
    if (!changed) return h;
    return new IssueHistoryEntryResponse(
        h.id(),
        h.actorId(),
        h.actorName(),
        h.actorKind(),
        h.eventType(),
        h.fromValue(),
        payload.toString(),
        h.createdAt(),
        h.actorUsername());
  }

  private static boolean isRelationEvent(IssueHistoryEntryResponse h) {
    return IssueHistoryEventType.RELATION_ADDED.name().equals(h.eventType())
        || IssueHistoryEventType.RELATION_REMOVED.name().equals(h.eventType());
  }

  /** 관계 이력 한 건 — 상대 키를 읽을 수 있으면 그대로, 아니면(파싱 실패 포함) other 를 가린 사본. */
  private IssueHistoryEntryResponse redactRelationEntry(
      IssueHistoryEntryResponse h, Long viewerId, Map<String, Boolean> readableByKey) {
    ObjectNode payload;
    try {
      JsonNode node = h.toValue() == null ? null : objectMapper.readTree(h.toValue());
      payload = node instanceof ObjectNode o ? o : objectMapper.createObjectNode();
    } catch (Exception e) {
      payload = objectMapper.createObjectNode();
    }
    JsonNode keyNode = payload.path("other").path("projectKey");
    if (keyNode.isTextual()
        && readableByKey.computeIfAbsent(keyNode.asText(), k -> canReadKey(k, viewerId))) {
      return h;
    }
    payload.set("other", objectMapper.createObjectNode().put("hidden", true));
    return new IssueHistoryEntryResponse(
        h.id(),
        h.actorId(),
        h.actorName(),
        h.actorKind(),
        h.eventType(),
        h.fromValue(),
        payload.toString(),
        h.createdAt(),
        h.actorUsername());
  }

  /** 프로젝트 키를 조회자가 읽을 수 있는가 — 규칙은 {@link ProjectAccessGuard#canReadForViewer}(부모 요약 가림과 같은 한 곳). */
  private boolean canReadKey(String projectKey, Long viewerId) {
    return projectRepository
        .findByKey(projectKey)
        .map(p -> accessGuard.canReadForViewer(p, viewerId))
        .orElse(false);
  }

  // ── 관계 대상 찾기 ──────────────────────────────────────────────────────────────────────

  /**
   * 관계 대상 찾기 — 현재 이슈와 걸 수 있는 활성 이슈만. {@code from}(현재 이슈의 프로젝트 키)이 호출자가 읽을 수 있는 개인 프로젝트면 그 프로젝트만, 그
   * 밖엔(없음·비개인·없는 키·읽을 수 없음) 읽을 수 있는 비개인 프로젝트 전부 — 개인 프로젝트는 다른 프로젝트와 관계를 못 맺어 제안해도 늘 거절되기 때문이다.
   * 없는·읽을 수 없는 {@code from} 은 없는 것처럼 다뤄 존재를 드러내지 않는다.
   *
   * <p>q 가 키 꼴({@code WPV-28})이면 키 정확 일치, 번호 꼴({@code #12})이면 그 번호({@code from} 프로젝트의 것이 맨 앞), 그 밖엔
   * 제목 부분 일치(대소문자 무시). 키·번호로 못 찾으면 제목으로 다시 찾는다. 최신 수정순 최대 20건, q 가 비면 빈 목록.
   *
   * <p>type·openOnly·excludeFrom 은 다른 프로젝트 에픽 고르기(WP-1039)가 쓰는 선택 거름으로, SQL 에서 상한 전에 건다 — 화면에서 거르면
   * 다른 유형·같은 프로젝트 이슈가 20건을 채워 에픽이 밀려난다.
   *
   * @param type 유형 이름(대소문자 무시, 예: EPIC). 비면 모든 유형
   * @param openOnly 참이면 완료·취소 범주 이슈를 뺀다
   * @param excludeFrom 참이면 {@code from} 프로젝트 이슈를 뺀다(같은 프로젝트 에픽은 화면이 따로 받아 둔다)
   */
  @Transactional(readOnly = true)
  public List<IssueLookupItem> lookup(
      long callerId, String q, String from, String type, boolean openOnly, boolean excludeFrom) {
    if (q == null || q.isBlank()) {
      return List.of();
    }
    String query = q.trim();
    var scope =
        new IssueRelationRepository.LookupScope(
            callerId,
            permissionChecker.userHasRole(callerId, "ADMIN"),
            personalFrom(callerId, from),
            normalizeKey(type),
            openOnly,
            excludeFrom ? normalizeKey(from) : null);
    Optional<IssueKey> key = IssueKeys.parse(query);
    if (key.isPresent()) {
      List<IssueLookupItem> byKey =
          relationRepository.lookupByKey(
              key.get().projectKey(), key.get().number(), scope, LOOKUP_LIMIT);
      // 키 꼴이어도 제목일 수 있다("covid-19") — 키로 못 찾으면 제목으로 다시 찾는다.
      return byKey.isEmpty() ? lookupTitle(query, scope) : byKey;
    }
    Matcher num = NUMBER_QUERY.matcher(query);
    if (num.matches()) {
      Integer n = IssueKeys.parseNumber(num.group(1));
      // 화면은 번호만 친 검색어를 그대로 보낸다 — 여러 프로젝트에 같은 번호가 있어 20건에서 잘려도 현재 이슈 프로젝트(from)의 그 번호가 맨 앞에 오게 한다.
      List<IssueLookupItem> byNumber =
          n == null
              ? List.of()
              : relationRepository.lookupByNumber(n, normalizeKey(from), scope, LOOKUP_LIMIT);
      // 번호 꼴이어도 제목일 수 있다("404 페이지") — 그 번호가 없으면 제목으로 다시 찾는다.
      return byNumber.isEmpty() ? lookupTitle(query, scope) : byNumber;
    }
    return lookupTitle(query, scope);
  }

  /** 제목 부분 일치 찾기 — 키·번호 꼴 검색어의 대체 경로이기도 하다. */
  private List<IssueLookupItem> lookupTitle(
      String query, IssueRelationRepository.LookupScope scope) {
    return relationRepository.lookupByTitle(
        LikePatternUtils.containsPattern(query), scope, LOOKUP_LIMIT);
  }

  /** {@code from} 이 호출자가 읽을 수 있는 개인 프로젝트면 그 id, 아니면 null. */
  private Long personalFrom(long callerId, String from) {
    String key = normalizeKey(from);
    if (key == null) {
      return null;
    }
    return projectRepository
        .findByKey(key)
        .filter(ProjectRow::isPersonal)
        .filter(p -> accessGuard.canRead(p, callerId))
        .map(ProjectRow::id)
        .orElse(null);
  }

  /** 프로젝트 키 입력 → 대문자 키. 비면 null. */
  private static String normalizeKey(String projectKey) {
    return projectKey == null || projectKey.isBlank()
        ? null
        : projectKey.trim().toUpperCase(Locale.ROOT);
  }

  // ── 내부 ────────────────────────────────────────────────────────────────────────────────

  /** 새로 걸 수 있는 유형인지 — 없음 404, 차단(의존성 API 로)·외부 전용·숨김 400. 유형 행을 공유 잠금해 같은 순간의 유형 삭제와 차례를 세운다. */
  private IssueRelationTypeRow requireLinkableType(long typeId) {
    IssueRelationTypeRow type =
        typeRepository.findByIdForShare(typeId).orElseThrow(IssueRelationException::notFound);
    if (IssueRelationBuiltIns.BLOCKS.equals(type.code())) {
      throw IssueRelationException.typeBlocks();
    }
    if (type.externalOnly()) {
      throw IssueRelationException.typeExternalOnly();
    }
    if (type.hidden()) {
      throw IssueRelationException.typeHidden();
    }
    return type;
  }

  /** 상대 쪽 말이 없는 방향 있는 유형(예: 상위 에픽)은 이 이슈가 B 쪽(target)일 수 없다 — 라벨이 비어 화면·정렬이 깨진다. */
  static boolean isSideAllowed(IssueRelationTypeRow type, boolean isSource) {
    return isSource
        || !type.directed()
        || (type.inwardLabel() != null && !type.inwardLabel().isBlank());
  }

  /**
   * 방향 있는 유형인데 B 쪽 말(inwardLabel)이 없으면 이 이슈를 B 쪽에 둘 수 없다 — 상위 에픽처럼 한쪽 말만 있는 유형을 target 으로 저장하면 이 이슈
   * 쪽 말이 null 이라 목록 정렬·화면·이력이 깨진다. 방향 없는 유형은 side 를 무시하므로 통과.
   *
   * @param isSource 이 이슈가 A(source) 쪽인가
   */
  static void assertSideAllowed(IssueRelationTypeRow type, boolean isSource) {
    if (!isSideAllowed(type, isSource)) {
      throw IssueRelationException.targetSideNotAllowed();
    }
  }

  /** side → 이 이슈가 A(source) 쪽인가. null·빈 값은 source. 그 밖의 값은 400(오타가 반대 방향으로 저장되지 않게). */
  static boolean parseSide(String side) {
    if (side == null || side.isBlank() || SIDE_SOURCE.equals(side)) {
      return true;
    }
    if (SIDE_TARGET.equals(side)) {
      return false;
    }
    throw IssueRelationException.sideInvalid();
  }

  /**
   * 상대 이슈 찾기 — 프로젝트 키가 비면 주소 이슈와 같은 프로젝트. 없는 프로젝트·읽을 수 없는 프로젝트·없는(삭제된) 번호는 모두 같은 400 이다 ({@code
   * assertReadable} 의 404 를 쓰면 응답이 달라져 존재가 드러난다).
   */
  private Endpoint resolveTarget(
      long callerId, ProjectRow project, AddIssueRelationRequest.Target target) {
    ProjectRow targetProject;
    if (target.projectKey() == null || target.projectKey().isBlank()) {
      targetProject = project;
    } else {
      String key = target.projectKey().trim().toUpperCase(Locale.ROOT);
      targetProject =
          key.equals(project.key())
              ? project
              : projectRepository
                  .findByKey(key)
                  .filter(p -> accessGuard.canRead(p, callerId))
                  .orElseThrow(IssueRelationException::targetNotFound);
    }
    IssueRow issue =
        issueRepository
            .findByProjectAndNumber(targetProject.id(), target.number())
            .orElseThrow(IssueRelationException::targetNotFound);
    return new Endpoint(targetProject, issue);
  }

  /**
   * 관계 추가·삭제 공통 후처리 — 두 이슈 각각에 각자 쪽 말로 이력을 남기고, 두 이슈 각자의 프로젝트로 화면 갱신 신호를 보낸다. 정리성 쓰기라 AI 작업은 터치하지
   * 않는다({@code updatedWithoutTouch}).
   *
   * @param thisIsSource 저장된 관계에서 주소 이슈가 A(source) 쪽인가
   */
  private void recordBoth(
      IssueHistoryEventType event,
      long callerId,
      IssueRelationTypeRow type,
      ProjectRow project,
      IssueRow thisRow,
      Endpoint other,
      boolean thisIsSource) {
    historyRecorder.recordRelation(
        event.name(),
        callerId,
        thisRow.id(),
        type.id(),
        type.labelFor(thisIsSource),
        other.project().key(),
        other.issue().number(),
        other.issue().title());
    historyRecorder.recordRelation(
        event.name(),
        callerId,
        other.issue().id(),
        type.id(),
        type.labelFor(!thisIsSource),
        project.key(),
        thisRow.number(),
        thisRow.title());
    changeNotifier.updatedWithoutTouch(project, thisRow.number(), thisRow.id(), callerId);
    changeNotifier.updatedWithoutTouch(
        other.project(), other.issue().number(), other.issue().id(), callerId);
  }
}
