package com.workplace.issue.service;

import static com.workplace.issue.service.SearchParams.csv;
import static com.workplace.issue.service.SearchParams.trimToNull;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.AiTaskProject;
import com.workplace.issue.dto.ChecklistCursor;
import com.workplace.issue.dto.ChecklistOrder;
import com.workplace.issue.dto.EpicChildrenResponse;
import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueGroupCountsResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.MeGroupedCursor;
import com.workplace.issue.dto.MeIssueGrouping;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueRepository.ChecklistRow;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.MeIssueGroupedRepository;
import com.workplace.issue.repository.MeIssueGroupedRepository.GroupedRow;
import com.workplace.label.dto.LabelSummary;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.version.repository.VersionRepository;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 검색/필터 + cursor 페이징 단일 진입점. 컨트롤러에서 받은 Map<String,String> 쿼리 파라미터를 IssueSearchQuery 로 정규화한 뒤
 * 리포지토리에 위임한다. 라벨/첨부/담당자/유형 모두 N+1 회피를 위해 한 번의 IN 쿼리로 일괄 fetch 후 in-memory 그룹핑.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class IssueSearchService {

  private final IssueRepository issueRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueAttachmentRepository issueAttachmentRepository;
  private final IssueAssigneeRepository issueAssigneeRepository;
  private final IssueTypeRepository typeRepository;
  private final IssueDependencyRepository dependencyRepository;
  private final IssueFieldValueRepository fieldValueRepository;
  // WP-270: 목록 항목에 연결된 사이클 요약을 싣는다(이슈별 정렬은 상세와 같다).
  private final IssueCycleRepository issueCycleRepository;
  // WP-270: 목록 항목에 보고자 요약을 싣는다(reporterId distinct 일괄 조회).
  private final UserRepository userRepository;
  // WP-377: 목록 항목에 진행 중 AI 작업을 싣는다.
  private final AgentWorkService agentWorkService;
  private final ProjectAccessGuard accessGuard;
  // #841: 라벨·유형 이름, username 필터 토큰 → id 해석(해석 불가 시 400).
  private final IssueFilterResolver filterResolver;
  // 7c: 횡단 검색 시 row 별 projectId → projectKey 일괄 해석용.
  private final com.workplace.project.repository.ProjectRepository projectRepository;
  // WP-915: /me/issues 프로젝트 묶음 정렬(group=due|recent).
  private final MeIssueGroupedRepository groupedRepository;
  // WP-933: 목록 항목에 붙은 구성요소를 싣는다.
  private final com.workplace.component.repository.ComponentRepository componentRepository;
  private final VersionRepository versionRepository;
  // WP-1038: 다른 프로젝트 에픽 부모를 조회자 권한으로 가린다.
  private final ParentRefReader parentRefReader;

  /** 그룹별 총계를 낼 수 있는 기준(WP-472) — 에픽·사이클 그룹은 구간별로 따로 불러오거나 필터가 없어 대상이 아니다. */
  private static final java.util.Set<String> COUNTABLE_GROUPS =
      java.util.Set.of("status", "statusId", "priority", "assignee");

  /**
   * 목록 그룹별 총계(WP-472) — 검색과 같은 params(cursor·size 무시)로 거른 이슈를 groupBy 기준으로 센다. 권한도 검색과
   * 같다(assertReadable).
   */
  public IssueGroupCountsResponse groupCounts(
      Long callerId, String projectKey, Map<String, String> params) {
    String groupBy = params.get("groupBy");
    if (groupBy == null || !COUNTABLE_GROUPS.contains(groupBy)) {
      throw new InvalidCursorException("groupBy 는 status·statusId·priority·assignee 중 하나여야 합니다");
    }
    var project = accessGuard.assertReadable(projectKey, callerId);
    IssueSearchQuery query = parse(callerId, project.id(), params);
    var groups =
        issueRepository.countGrouped(project.id(), query, groupBy).entrySet().stream()
            .map(e -> new IssueGroupCountsResponse.GroupCount(e.getKey(), e.getValue()))
            .toList();
    return new IssueGroupCountsResponse(groupBy, groups);
  }

  /**
   * 검색. params 키: q, status, statusId·statusName(WP-807), assignee, priority, dueFrom, dueTo,
   * label, type, component(WP-933, id·이름·none), fixVersion·affectsVersion(WP-888, id·이름·none),
   * cursor, size, watching(WP-356, true 만). assignee·reporter 는 me/숫자 id/username, label·type 은 숫자
   * id/이름을 받는다(#841).
   */
  public IssueSearchResponse search(Long callerId, String projectKey, Map<String, String> params) {
    // read 진입점 — OPEN 프로젝트는 테넌트 전원이 보드/목록을 조회할 수 있다(assertReadable). TEAM/PERSONAL 은 멤버만.
    var project = accessGuard.assertReadable(projectKey, callerId);
    // WP-918: order=checklist 면 화면 섹션 순서 정렬로. 없으면 아래 기존 (updated_at, id) 경로 그대로.
    ChecklistOrder order =
        ChecklistOrder.parse(
            params.get("order"), params.get("mode"), params.get("today"), params.get("weekEnd"));
    if (order != null) {
      return searchChecklist(callerId, project.id(), project.key(), params, order);
    }
    IssueSearchQuery query = parse(callerId, project.id(), params);

    var rows = issueRepository.search(project.id(), query);
    // 단일 프로젝트 검색이므로 projectId 무시하고 상수 key 사용.
    return assemble(callerId, rows, query, pid -> project.key());
  }

  /**
   * WP-918: 개인 작업 목록 체크리스트 정렬 — 범위·필터는 기본 검색과 같고 정렬·커서만 화면 섹션 순서({@link ChecklistOrder})다.
   *
   * <p>커서는 전용 형식({@link ChecklistCursor})이라 cursor 를 뺀 params 로 parse 한다 — parse 는 cursor 를 {@link
   * IssueCursor} 로 풀어 실패하면 400 이라, 그대로 넘기면 2페이지가 항상 400 이 된다.
   */
  private IssueSearchResponse searchChecklist(
      Long callerId,
      long projectId,
      String projectKey,
      Map<String, String> params,
      ChecklistOrder order) {
    var withoutCursor = new HashMap<>(params);
    withoutCursor.remove("cursor");
    IssueSearchQuery query = parse(callerId, projectId, withoutCursor);
    String cursorStr = trimToNull(params.get("cursor"));
    ChecklistCursor cursor = cursorStr == null ? null : ChecklistCursor.decode(cursorStr);

    List<ChecklistRow> sorted = issueRepository.searchChecklist(projectId, query, order, cursor);
    List<IssueRow> rows = sorted.stream().map(ChecklistRow::row).toList();
    var items = assembleItems(callerId, rows, pid -> projectKey);
    String nextCursor = null;
    boolean hasMore = false;
    if (!sorted.isEmpty() && sorted.size() >= query.size()) {
      nextCursor = sorted.get(sorted.size() - 1).toCursor().encode();
      hasMore = true;
    }
    return new IssueSearchResponse(items, nextCursor, hasMore);
  }

  /**
   * 주어진 이슈 중 지금도 이 사용자의 「마감 지남·오늘」 내 이슈인 것(WP-1104) — 홈 AI 우선순위가 저장해 둔 이슈 마감 행을 읽을 때 다시 맞춘다. 다른
   * 도메인(home)이 이슈 저장소를 직접 부르지 않게 검색 서비스로 연다. 조건은 {@link IssueRepository#findStillDueAssignedIds}.
   */
  public java.util.Set<Long> findStillDueAssignedIds(
      long userId, java.util.Collection<Long> issueIds, java.time.LocalDate today) {
    return issueRepository.findStillDueAssignedIds(userId, issueIds, today);
  }

  /**
   * 이 사용자의 「마감 지남·오늘」 열린 담당 이슈 — 마감이 오늘에 가까운 순으로 최대 limit 개(WP-1177). 홈 AI 우선순위 배치가 후보로 받는다. 조건은
   * {@link IssueRepository#findDueAssigned}.
   */
  public List<IssueResponse> findDueAssigned(long userId, java.time.LocalDate today, int limit) {
    return assembleCrossProject(userId, issueRepository.findDueAssigned(userId, today, limit));
  }

  /** 여러 프로젝트에 걸친 행 → 응답 항목 — projectId → key 를 한 번에 풀어(distinct) 조립한다(횡단 검색·마감 후보가 함께 쓴다). */
  private List<IssueResponse> assembleCrossProject(Long viewerId, List<IssueRow> rows) {
    var keyById =
        projectRepository.keysByIds(rows.stream().map(IssueRow::projectId).distinct().toList());
    return assembleItems(viewerId, rows, pid -> keyById.getOrDefault(pid, ""));
  }

  /**
   * 7c: 프로젝트 횡단 "내 이슈" 검색. 홈 위젯(issue_list/my_tasks)·기본구성용. assignee=me 는 parse 에서 callerId 로 해석되고,
   * 스코프는 호출자가 멤버인 모든 프로젝트(searchMemberOf 의 멤버십 EXISTS)로 제한된다.
   */
  public IssueSearchResponse searchMine(Long callerId, Map<String, String> params) {
    // #841: projectKey 가 오면 그 프로젝트 검색으로 위임한다. 예전엔 조용히 무시돼 "특정 프로젝트 내 이슈" 요청이 횡단 결과를 돌려줬다.
    // 단일 프로젝트 경로는 접근 가드(없는 키 404·권한 403)와 프로젝트 스코프 이름 해석을 함께 제공한다.
    String projectKey = trimToNull(params.get("projectKey"));
    if (projectKey != null) {
      return search(callerId, projectKey, params);
    }
    // WP-915: group 이 있으면 프로젝트 묶음 정렬로. 없으면 아래 기존 (updated_at, id) 경로 그대로.
    MeIssueGrouping grouping = MeIssueGrouping.parse(trimToNull(params.get("group")));
    if (grouping != null) {
      return searchMineGrouped(callerId, params, grouping);
    }
    IssueSearchQuery query = parse(callerId, null, params);
    var rows = issueRepository.searchMemberOf(callerId, query);
    return pageOf(assembleCrossProject(callerId, rows), rows, query.size());
  }

  /**
   * WP-915: 프로젝트 묶음 정렬 횡단 검색. 범위·필터는 기본 경로와 같고(memberOfFilterCondition), 정렬·커서만 프로젝트 묶음 단위다. 각 행에
   * 프로젝트 이름·묶음 건수(projectGroup)를 싣는다 — 건수는 커서 앞에서 세므로 어느 페이지에서 받아도 같다. hideClosed 는 group 이 있을 때만
   * 읽는다.
   *
   * <p>커서는 묶음 전용 형식({@link MeGroupedCursor})이라 cursor 를 뺀 params 로 parse 한다 — parse 는 cursor 를
   * {@link IssueCursor} 로 풀어 실패하면 400 이라, 그대로 넘기면 2페이지가 항상 400 이 된다.
   */
  private IssueSearchResponse searchMineGrouped(
      Long callerId, Map<String, String> params, MeIssueGrouping grouping) {
    var withoutCursor = new HashMap<>(params);
    withoutCursor.remove("cursor");
    IssueSearchQuery query = parse(callerId, null, withoutCursor);
    String cursorStr = trimToNull(params.get("cursor"));
    MeGroupedCursor cursor = cursorStr == null ? null : MeGroupedCursor.decode(cursorStr);
    if (cursor != null && !cursor.fits(grouping)) {
      // 다른 묶음 기준(due ↔ recent)의 커서는 쓰는 정렬 키가 비어 있어 이어 읽을 수 없다.
      throw new InvalidCursorException("cursor 가 group 과 맞지 않습니다");
    }
    boolean hideClosed = "true".equalsIgnoreCase(params.get("hideClosed"));

    List<GroupedRow> grouped =
        groupedRepository.search(
            issueRepository.memberOfFilterCondition(callerId, query),
            grouping,
            hideClosed,
            cursor,
            query.size());
    return groupedPageOf(callerId, grouped, query.size());
  }

  /**
   * WP-915: 구독 목록(/me/watched-issues) 한 페이지. 범위는 {@link
   * IssueRepository#watchedReadableCondition}(구독 + 활성 + OPEN 또는 멤버). grouping 이 null 이면 기존
   * (updated_at, id) 순서와 {@link IssueCursor}, 있으면 프로젝트 묶음 순서와 {@link MeGroupedCursor} 에
   * projectGroup 을 싣는다. 어느 쪽이든 항목은 {@link #assembleItems} 로 조립해 담당자·유형·부모·하위 건수가 실리고, 프로젝트 키는 한 번에
   * 해석한다 — 예전엔 행마다 프로젝트를 다시 조회했다. 구독 탭은 모든 상태를 보이므로 hideClosed 는 없다.
   */
  public IssueSearchResponse watchedPage(
      Long callerId, String cursorStr, int size, MeIssueGrouping grouping) {
    int clamped = Math.max(1, Math.min(100, size));
    String trimmed = trimToNull(cursorStr);
    if (grouping == null) {
      IssueCursor cursor = trimmed == null ? null : IssueCursor.decode(trimmed);
      var rows = issueRepository.findReadableWatchedBy(callerId, cursor, clamped);
      var keyById =
          projectRepository.keysByIds(rows.stream().map(IssueRow::projectId).distinct().toList());
      var items = assembleItems(callerId, rows, pid -> keyById.getOrDefault(pid, ""));
      return pageOf(items, rows, clamped);
    }
    MeGroupedCursor cursor = trimmed == null ? null : MeGroupedCursor.decode(trimmed);
    if (cursor != null && !cursor.fits(grouping)) {
      throw new InvalidCursorException("cursor 가 group 과 맞지 않습니다");
    }
    List<GroupedRow> grouped =
        groupedRepository.search(
            issueRepository.watchedReadableCondition(callerId), grouping, false, cursor, clamped);
    return groupedPageOf(callerId, grouped, clamped);
  }

  /**
   * 묶음 정렬 행 → 응답. 항목을 조립하고 각 행에 프로젝트 이름·묶음 건수(projectGroup)를 싣는다 — 건수는 커서 앞에서 세므로 어느 페이지에서 받아도 같다.
   * 마지막 행의 정렬 키가 다음 커서({@link MeGroupedCursor}).
   */
  private IssueSearchResponse groupedPageOf(Long viewerId, List<GroupedRow> grouped, int size) {
    List<IssueRow> rows = grouped.stream().map(GroupedRow::row).toList();
    List<Long> projectIds = rows.stream().map(IssueRow::projectId).distinct().toList();
    var keyById = projectRepository.keysByIds(projectIds);
    var nameById = projectRepository.namesByIds(projectIds);
    var items = assembleItems(viewerId, rows, pid -> keyById.getOrDefault(pid, ""));

    List<IssueResponse> withGroups = new ArrayList<>(items.size());
    for (int i = 0; i < items.size(); i++) {
      GroupedRow g = grouped.get(i);
      // 이름이 없으면(이론상 없음 — 활성 프로젝트만 조회됨) 키로 대신한다 — AI 위임 작업 머리와 같은 규칙.
      String name = nameById.getOrDefault(g.projectId(), keyById.getOrDefault(g.projectId(), ""));
      withGroups.add(items.get(i).withProjectGroup(new AiTaskProject(name, g.projectSize())));
    }

    String nextCursor = null;
    boolean hasMore = false;
    if (!grouped.isEmpty() && grouped.size() >= size) {
      nextCursor = grouped.get(grouped.size() - 1).toCursor().encode();
      hasMore = true;
    }
    return new IssueSearchResponse(withGroups, nextCursor, hasMore);
  }

  /**
   * 이슈의 활성 하위 목록(WP-1038) — 다른 프로젝트 하위까지. 이슈를 읽을 수 있어야 하고(없거나 못 읽으면 404), 하위는 조회자가 그 프로젝트를 읽을 수 있을
   * 때만 싣고 나머지는 hiddenCount 로 센다. 이 이슈와 같은 프로젝트 하위는 늘 읽을 수 있다. 항목 모양은 목록과 같다({@link
   * #assembleItems}).
   */
  public EpicChildrenResponse children(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var parent =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var visibility = parentRefReader.forViewer(callerId);
    List<IssueRow> readable = new ArrayList<>();
    int hidden = 0;
    for (IssueRow child : issueRepository.findActiveChildren(parent.id())) {
      if (child.projectId().equals(project.id()) || visibility.canRead(child.projectId())) {
        readable.add(child);
      } else {
        hidden++;
      }
    }
    var keyById =
        projectRepository.keysByIds(readable.stream().map(IssueRow::projectId).distinct().toList());
    return new EpicChildrenResponse(
        assembleItems(callerId, readable, pid -> keyById.getOrDefault(pid, "")), hidden);
  }

  /** rows → IssueSearchResponse 조립. 항목 조립은 {@link #assembleItems} 에 맡기고 여기선 커서만 계산한다. */
  private IssueSearchResponse assemble(
      Long viewerId,
      List<IssueRow> rows,
      IssueSearchQuery query,
      java.util.function.LongFunction<String> keyResolver) {
    var items = assembleItems(viewerId, rows, keyResolver);
    return pageOf(items, rows, query.size());
  }

  /**
   * rows → IssueResponse 목록 조립(라벨·첨부·담당자·유형·부모·의존성·필드·AI 작업 일괄 조회). projectKey 는 row 마다 keyResolver
   * 로 해석(횡단 검색 대응). 다른 목록 조회(AI 진행 목록 등)도 같은 응답 모양을 쓰도록 공개한다.
   *
   * @param viewerId 조회자 — 다른 프로젝트 에픽 부모를 읽을 수 없으면 부모 요약을 가린다(WP-1038)
   */
  public List<IssueResponse> assembleItems(
      Long viewerId, List<IssueRow> rows, java.util.function.LongFunction<String> keyResolver) {
    List<Long> issueIds = rows.stream().map(IssueRow::id).toList();
    Map<Long, List<LabelSummary>> labelsByIssue =
        issueLabelRepository.findLabelsByIssueIds(issueIds);
    // 첨부 카운트 N+1 회피: 단일 IN 쿼리로 일괄 집계.
    Map<Long, Integer> countsByIssue = issueAttachmentRepository.countByIssueIds(issueIds);
    // 담당자 N+1 회피: issueIds 일괄 조회 후 in-memory 그룹핑.
    Map<Long, List<UserSummary>> assigneesByIssue =
        issueAssigneeRepository.findByIssueIds(issueIds);
    // 유형 N+1 회피: row 들의 typeId distinct 모아 한 번에 fetch.
    List<Long> typeIdsToFetch = rows.stream().map(IssueRow::typeId).distinct().toList();
    Map<Long, IssueTypeSummary> typesById = typeRepository.findByIds(typeIdsToFetch);
    // Phase 4a — 부모 ref + 자식 카운트 batch (N+1 회피).
    // WP-1038 — 다른 프로젝트 에픽 부모는 조회자가 그 프로젝트를 읽을 수 있을 때만 그대로 싣는다.
    var parentRefByChild =
        parentRefReader.redact(viewerId, rows, issueRepository.findParentRefsByIssueIds(issueIds));
    var childCountByParent = issueRepository.countChildrenByParentIds(issueIds);
    var childDoneCountByParent = issueRepository.countDoneChildrenByParentIds(issueIds);
    // Phase 4b — 의존성 batch (blockedBy / blocks / blocked 플래그) (N+1 회피).
    var blockedByByIssue = dependencyRepository.findBlockedByForIssues(issueIds);
    var blocksByIssue = dependencyRepository.findBlocksForIssues(issueIds);
    var blockedFlagByIssue = dependencyRepository.findBlockedFlags(issueIds);
    // Phase 4c — custom field 값 batch (N+1 회피).
    var fieldsByIssue = fieldValueRepository.findByIssueIds(issueIds);
    // WP-377 — 진행 중 AI 작업 batch (N+1 회피).
    var agentWorkByIssue = agentWorkService.viewsByIssueIds(issueIds);
    // WP-270 — 보고자(reporterId distinct 일괄)·사이클 batch (N+1 회피). 사용자 행이 없으면 reporter 는 null(생략).
    Map<Long, UserSummary> reporterById =
        userRepository
            .findByIds(
                rows.stream()
                    .map(IssueRow::reporterId)
                    .filter(Objects::nonNull)
                    .distinct()
                    .toList())
            .stream()
            .collect(Collectors.toMap(u -> u.id(), UserResponse::toSummary));
    var cyclesByIssue = issueCycleRepository.findCyclesByIssueIds(issueIds);
    // WP-933 — 구성요소 batch(이슈별 목록 순서, N+1 회피). 없는 이슈는 빈 배열.
    var componentsByIssue = componentRepository.summariesByIssueIds(issueIds);
    // WP-888 — 수정·영향 버전 batch(한 쿼리, N+1 회피). 없는 이슈는 빈 배열.
    var versionsByIssue = versionRepository.summariesByIssueIdsBothKinds(issueIds);
    return rows.stream()
        .map(
            r ->
                IssueResponse.fromWithCustomFields(
                        keyResolver.apply(r.projectId()), // ← project.key() 대신 row 별 해석
                        r,
                        labelsByIssue.getOrDefault(r.id(), List.of()),
                        countsByIssue.getOrDefault(r.id(), 0),
                        typesById.get(r.typeId()),
                        assigneesByIssue.getOrDefault(r.id(), List.of()),
                        parentRefByChild.get(r.id()),
                        childCountByParent.getOrDefault(r.id(), 0),
                        childDoneCountByParent.getOrDefault(r.id(), 0),
                        blockedByByIssue.getOrDefault(r.id(), List.of()),
                        blocksByIssue.getOrDefault(r.id(), List.of()),
                        blockedFlagByIssue.getOrDefault(r.id(), false),
                        fieldsByIssue.getOrDefault(r.id(), List.of()))
                    .withAgentWork(agentWorkByIssue.getOrDefault(r.id(), List.of()))
                    .withListExtras(
                        r.reporterId() == null ? null : reporterById.get(r.reporterId()),
                        cyclesByIssue.getOrDefault(r.id(), List.of()))
                    .withComponents(componentsByIssue.getOrDefault(r.id(), List.of()))
                    .withVersions(
                        versionsByIssue
                            .getOrDefault(r.id(), VersionRepository.IssueVersionSummaries.EMPTY)
                            .fix(),
                        versionsByIssue
                            .getOrDefault(r.id(), VersionRepository.IssueVersionSummaries.EMPTY)
                            .affects()))
        .toList();
  }

  /** 항목 + 원본 rows 로 커서 페이지 응답을 만든다. 마지막 행의 (updatedAt, id) 가 다음 커서. */
  private IssueSearchResponse pageOf(List<IssueResponse> items, List<IssueRow> rows, int size) {

    String nextCursor = null;
    boolean hasMore = false;
    if (!rows.isEmpty() && rows.size() >= size) {
      var last = rows.get(rows.size() - 1);
      nextCursor = IssueCursor.encode(last.updatedAt(), last.id());
      hasMore = true;
    }
    return new IssueSearchResponse(items, nextCursor, hasMore);
  }

  /**
   * Map → IssueSearchQuery 정규화. 잘못된 cursor/date 는 InvalidCursorException(400) 으로 변환.
   *
   * @param callerId 호출자 ID — assignee=me / reporter=me 리터럴을 실제 ID 로 치환 (7a, 7-nav).
   * @param projectId 단일 프로젝트 검색이면 그 id, 횡단 검색이면 null — 라벨·유형 이름 해석 스코프(#841).
   */
  private IssueSearchQuery parse(Long callerId, Long projectId, Map<String, String> p) {
    String q = trimToNull(p.get("q"));
    // WP-661: 없는 상태·우선순위는 빈 목록 대신 400, 소문자는 정식 값으로.
    List<String> statuses = SearchParams.statuses(p.get("status"));
    List<String> priorities = SearchParams.priorities(p.get("priority"));
    // WP-807 개별 상태 — statusId(숫자 CSV)·statusName(이름 CSV, AI 도구용)을 상태 id 합집합으로. 범주(status)와는 AND.
    List<Long> statusIds =
        filterResolver.resolveStatusIds(
            csv(p.get("statusId")), csv(p.get("statusName")), projectId, callerId);

    // 7a: assignee — 'me' 는 호출자 본인(홈 컴포저가 사용자 ID 를 몰라도 "내 담당" 조회), 'null' 은 미지정 포함.
    // #841: 숫자 외 토큰은 username 으로 해석하고 없으면 400(예전엔 조용히 버려 필터가 빠진 결과를 반환했다).
    var assigneeTokens = csv(p.get("assignee"));
    boolean includeUnassigned = assigneeTokens.stream().anyMatch("null"::equalsIgnoreCase);
    List<Long> assigneeIds =
        filterResolver.resolveUsers(
            "assignee",
            assigneeTokens.stream().filter(t -> !"null".equalsIgnoreCase(t)).toList(),
            callerId);

    // 7-nav: reporter 필터. "me" → 호출자 본인("내가 만든" 조회). #841: 숫자 외 토큰은 username 해석.
    List<Long> reporterIds =
        filterResolver.resolveUsers("reporter", csv(p.get("reporter")), callerId);

    LocalDate dueFrom = parseDate(p.get("dueFrom"));
    LocalDate dueTo = parseDate(p.get("dueTo"));
    // WP-307: 종료일·생성일 범위(Asia/Seoul 날짜, 양끝 포함) — AI 의 "이번 주 완료한/만든 이슈" 조회용.
    LocalDate closedFrom = parseDate(p.get("closedFrom"));
    LocalDate closedTo = parseDate(p.get("closedTo"));
    LocalDate createdFrom = parseDate(p.get("createdFrom"));
    LocalDate createdTo = parseDate(p.get("createdTo"));

    IssueCursor cursor = null;
    String cursorStr = trimToNull(p.get("cursor"));
    if (cursorStr != null) {
      cursor = IssueCursor.decode(cursorStr);
    }

    int size = SearchParams.size(p.get("size"));

    // 라벨 CSV — 숫자 id 또는 라벨 이름(#841). 토큰마다 그룹 하나(그룹 간 AND).
    List<List<Long>> labelIdGroups =
        filterResolver.resolveLabelGroups(csv(p.get("label")), projectId, callerId);

    // 사이클 CSV — 숫자 id 또는 사이클 이름, OR 결합 필터. 'null' 은 백로그 = 진행 중·예정 사이클에 연결되지 않은 이슈 포함(완료
    // 사이클에만 남은 이슈 포함, assignee=null 과 같은 토큰 규약, #878). 'none' 은 사이클 연결이 하나도 없는 이슈(WP-176).
    // 못 찾는 이름은 400 — 예전엔 버려서 필터 없는 전체 목록을 돌려줬다(WP-735).
    var cycleTokens = csv(p.get("cycle"));
    boolean includeNoOpenCycle = cycleTokens.stream().anyMatch("null"::equalsIgnoreCase);
    boolean includeNoCycle = cycleTokens.stream().anyMatch("none"::equalsIgnoreCase);
    List<Long> cycleIds =
        filterResolver.resolveCycleIds(
            cycleTokens.stream()
                .filter(t -> !"null".equalsIgnoreCase(t) && !"none".equalsIgnoreCase(t))
                .toList(),
            projectId,
            callerId);

    // 구성요소 CSV(WP-933) — 숫자 id 또는 구성요소 이름(대소문자 무시, 보관 포함), OR 결합. 'none' 은 구성요소가 없는 이슈(사이클 none
    // 과 같은 토큰 규약). 못 찾는 이름은 400.
    var componentTokens = csv(p.get("component"));
    boolean componentNone = componentTokens.stream().anyMatch("none"::equalsIgnoreCase);
    List<Long> componentIds =
        filterResolver.resolveComponentIds(
            componentTokens.stream().filter(t -> !"none".equalsIgnoreCase(t)).toList(),
            projectId,
            callerId);

    // 수정 버전·영향 버전 CSV(WP-888) — 구성요소와 같은 규약(id 또는 이름·대소문자 무시·보관 포함, OR, 'none' = 그 종류 버전이 없는 이슈).
    // 두 필터는 서로 AND. 못 찾는 이름은 400.
    var versionCandidates = filterResolver.versionCandidates(projectId, callerId);
    var fixTokens = csv(p.get("fixVersion"));
    boolean fixVersionNone = fixTokens.stream().anyMatch("none"::equalsIgnoreCase);
    List<Long> fixVersionIds =
        filterResolver.resolveVersionIds(
            "fixVersion",
            fixTokens.stream().filter(t -> !"none".equalsIgnoreCase(t)).toList(),
            versionCandidates);
    var affectsTokens = csv(p.get("affectsVersion"));
    boolean affectsVersionNone = affectsTokens.stream().anyMatch("none"::equalsIgnoreCase);
    List<Long> affectsVersionIds =
        filterResolver.resolveVersionIds(
            "affectsVersion",
            affectsTokens.stream().filter(t -> !"none".equalsIgnoreCase(t)).toList(),
            versionCandidates);

    // 마일스톤 CSV — 숫자 id 또는 마일스톤 이름, OR 결합 필터. 못 찾는 이름은 400(WP-735).
    List<Long> milestoneIds =
        filterResolver.resolveMilestoneIds(csv(p.get("milestone")), projectId, callerId);

    // 유형 CSV — 숫자 id 또는 유형 이름(#841). OR 결합 필터.
    List<Long> typeIds = filterResolver.resolveTypeIds(csv(p.get("type")), projectId, callerId);

    // Phase 4a — parent / topLevel 파싱. parent 가 지정되면 topLevel 은 리포지토리에서 무시.
    Integer parentNumber = null;
    String pn = trimToNull(p.get("parent"));
    if (pn != null) {
      try {
        parentNumber = Integer.parseInt(pn);
      } catch (NumberFormatException ignored) {
        // 잘못된 값은 필터 미적용
      }
    }
    Boolean topLevel = "true".equalsIgnoreCase(p.get("topLevel"));
    // Phase 4b — blocked 파싱. "true" 만 활성화, 그 외는 null (필터 미적용).
    Boolean blocked = "true".equalsIgnoreCase(p.get("blocked")) ? Boolean.TRUE : null;
    // 목록 화면 전용 — SUBTASK 유형 제외. "true" 만 활성화, 그 외는 null (필터 미적용).
    Boolean excludeSubtasks =
        "true".equalsIgnoreCase(p.get("excludeSubtasks")) ? Boolean.TRUE : null;
    // 보드·목록 기본 뷰 전용 — EPIC 유형 제외. "true" 만 활성화, 그 외는 null (필터 미적용).
    Boolean excludeEpics = "true".equalsIgnoreCase(p.get("excludeEpics")) ? Boolean.TRUE : null;
    // 보드·목록 기본 뷰 전용 — 활성 사이클 밖 종료 이슈 제외. "true" 만 활성화, 그 외는 null (필터 미적용).
    Boolean hideInactiveClosed =
        "true".equalsIgnoreCase(p.get("hideInactiveClosed")) ? Boolean.TRUE : null;

    // Phase 4c — fieldId / fieldValue. fieldId 가 숫자가 아니면 null 로 무시 (필터 미적용).
    // WP-356 — watching=true 면 호출자가 워치 중인 이슈만. 다른 사용자의 워치 목록은 열지 않는다(값은 true 만 받는다).
    Long watcherId = "true".equalsIgnoreCase(p.get("watching")) ? callerId : null;
    // WP-373·WP-719 — pendingForMe=true 면 호출자의 마지막 글(이슈 챗 글·댓글) 이후 다른 사람이 글·댓글을 남긴 이슈만(값은 true 만
    // 받는다).
    Long pendingForUserId = "true".equalsIgnoreCase(p.get("pendingForMe")) ? callerId : null;
    // WP-719 — mentionsMe=true 면 호출자의 마지막 글 이후 호출자를 멘션한 다른 사람 글이 있는 이슈만. 다른 사용자 기준으로는 열지 않는다.
    Long mentionedUserId = "true".equalsIgnoreCase(p.get("mentionsMe")) ? callerId : null;
    // WP-1239 — sourceKey=<원본 키> 면 가져올 때 그 원본 키를 받은 이슈만(정확히 일치, 앞뒤 공백은 뗀다). 이관한 Jira 키로 이슈를 찾는다.
    String sourceKey = trimToNull(p.get("sourceKey"));

    Long fieldId = null;
    String fieldValue = trimToNull(p.get("fieldValue"));
    String fid = trimToNull(p.get("fieldId"));
    if (fid != null) {
      try {
        fieldId = Long.parseLong(fid);
      } catch (NumberFormatException ignored) {
        // 잘못된 fieldId 는 필터 미적용
      }
    }

    return new IssueSearchQuery(
        q,
        statuses,
        assigneeIds,
        includeUnassigned,
        priorities,
        dueFrom,
        dueTo,
        cursor,
        size,
        labelIdGroups,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds,
        cycleIds,
        includeNoOpenCycle,
        milestoneIds,
        excludeSubtasks,
        excludeEpics,
        hideInactiveClosed,
        includeNoCycle,
        closedFrom,
        closedTo,
        createdFrom,
        createdTo,
        watcherId,
        pendingForUserId,
        statusIds,
        componentIds,
        componentNone,
        fixVersionIds,
        fixVersionNone,
        affectsVersionIds,
        affectsVersionNone,
        mentionedUserId,
        sourceKey);
  }

  private static LocalDate parseDate(String s) {
    String t = trimToNull(s);
    if (t == null) return null;
    try {
      return LocalDate.parse(t);
    } catch (DateTimeParseException e) {
      throw new InvalidCursorException("날짜 형식 오류: " + t);
    }
  }
}
