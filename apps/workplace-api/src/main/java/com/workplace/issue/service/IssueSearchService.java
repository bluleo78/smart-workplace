package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.label.dto.LabelSummary;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
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

  private static final int DEFAULT_SIZE = 30;
  private static final int MAX_SIZE = 100;

  private final IssueRepository issueRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueAttachmentRepository issueAttachmentRepository;
  private final IssueAssigneeRepository issueAssigneeRepository;
  private final IssueTypeRepository typeRepository;
  private final IssueDependencyRepository dependencyRepository;
  private final IssueFieldValueRepository fieldValueRepository;
  private final ProjectAccessGuard accessGuard;
  // 7c: 횡단 검색 시 row 별 projectId → projectKey 일괄 해석용.
  private final com.workplace.project.repository.ProjectRepository projectRepository;

  /** 검색. params 키: q, status, assignee, priority, dueFrom, dueTo, label, type, cursor, size. */
  public IssueSearchResponse search(Long callerId, String projectKey, Map<String, String> params) {
    var project = accessGuard.assertMember(projectKey, callerId);
    IssueSearchQuery query = parse(callerId, params);

    var rows = issueRepository.search(project.id(), query);
    // 단일 프로젝트 검색이므로 projectId 무시하고 상수 key 사용.
    return assemble(rows, query, pid -> project.key());
  }

  /**
   * 7c: 프로젝트 횡단 "내 이슈" 검색. 홈 위젯(issue_list/my_tasks)·기본구성용. assignee=me 는 parse 에서 callerId 로 해석되고,
   * 스코프는 호출자가 멤버인 모든 프로젝트(searchMemberOf 의 멤버십 EXISTS)로 제한된다.
   */
  public IssueSearchResponse searchMine(Long callerId, Map<String, String> params) {
    IssueSearchQuery query = parse(callerId, params);
    var rows = issueRepository.searchMemberOf(callerId, query);
    // projectId → key 일괄 해석(횡단이므로 여러 프로젝트). distinct 후 한 번에.
    var keyById =
        projectRepository.keysByIds(rows.stream().map(IssueRow::projectId).distinct().toList());
    return assemble(rows, query, pid -> keyById.getOrDefault(pid, ""));
  }

  /** rows → IssueSearchResponse 조립. projectKey 는 row 마다 keyResolver 로 해석(횡단 검색 대응). */
  private IssueSearchResponse assemble(
      List<IssueRow> rows,
      IssueSearchQuery query,
      java.util.function.LongFunction<String> keyResolver) {
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
    var parentRefByChild = issueRepository.findParentRefsByIssueIds(issueIds);
    var childCountByParent = issueRepository.countChildrenByParentIds(issueIds);
    var childDoneCountByParent = issueRepository.countDoneChildrenByParentIds(issueIds);
    // Phase 4b — 의존성 batch (blockedBy / blocks / blocked 플래그) (N+1 회피).
    var blockedByByIssue = dependencyRepository.findBlockedByForIssues(issueIds);
    var blocksByIssue = dependencyRepository.findBlocksForIssues(issueIds);
    var blockedFlagByIssue = dependencyRepository.findBlockedFlags(issueIds);
    // Phase 4c — custom field 값 batch (N+1 회피).
    var fieldsByIssue = fieldValueRepository.findByIssueIds(issueIds);
    var items =
        rows.stream()
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
                        fieldsByIssue.getOrDefault(r.id(), List.of())))
            .toList();

    String nextCursor = null;
    boolean hasMore = false;
    if (!rows.isEmpty() && rows.size() >= query.size()) {
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
   */
  private IssueSearchQuery parse(Long callerId, Map<String, String> p) {
    String q = trimToNull(p.get("q"));
    List<String> statuses = csv(p.get("status"));
    List<String> priorities = csv(p.get("priority"));

    var assigneeTokens = csv(p.get("assignee"));
    List<Long> assigneeIds = new ArrayList<>();
    boolean includeUnassigned = false;
    for (String tok : assigneeTokens) {
      if ("me".equalsIgnoreCase(tok)) {
        // 7a: 'me' 리터럴 → 호출자 본인. 홈 컴포저가 사용자 ID 를 몰라도 "내 담당" 조회 가능.
        assigneeIds.add(callerId);
      } else if ("null".equalsIgnoreCase(tok)) {
        includeUnassigned = true;
      } else {
        try {
          assigneeIds.add(Long.parseLong(tok));
        } catch (NumberFormatException e) {
          // 알 수 없는 토큰은 무시 — 비어 있으면 필터 미적용
        }
      }
    }

    // 7-nav: reporter 필터. "me" → 호출자 본인("내가 만든" 조회). 숫자 외 토큰은 무시.
    var reporterTokens = csv(p.get("reporter"));
    List<Long> reporterIds = new ArrayList<>();
    for (String tok : reporterTokens) {
      if ("me".equalsIgnoreCase(tok)) {
        reporterIds.add(callerId);
      } else {
        try {
          reporterIds.add(Long.parseLong(tok));
        } catch (NumberFormatException e) {
          // 알 수 없는 토큰 무시
        }
      }
    }

    LocalDate dueFrom = parseDate(p.get("dueFrom"));
    LocalDate dueTo = parseDate(p.get("dueTo"));

    IssueCursor cursor = null;
    String cursorStr = trimToNull(p.get("cursor"));
    if (cursorStr != null) {
      cursor = IssueCursor.decode(cursorStr);
    }

    int size = DEFAULT_SIZE;
    String sizeStr = trimToNull(p.get("size"));
    if (sizeStr != null) {
      try {
        size = Math.max(1, Math.min(MAX_SIZE, Integer.parseInt(sizeStr)));
      } catch (NumberFormatException ignored) {
        // 기본값 유지
      }
    }

    // 라벨 ID CSV → List<Long> (잘못된 토큰은 무시)
    List<Long> labelIds = new ArrayList<>();
    for (String tok : csv(p.get("label"))) {
      try {
        labelIds.add(Long.parseLong(tok));
      } catch (NumberFormatException ignored) {
        // 잘못된 라벨 토큰은 필터 미적용
      }
    }

    // 사이클 ID CSV — OR 결합 필터. 잘못된 토큰은 무시.
    List<Long> cycleIds = new ArrayList<>();
    for (String tok : csv(p.get("cycle"))) {
      try {
        cycleIds.add(Long.parseLong(tok));
      } catch (NumberFormatException ignored) {
        // 잘못된 사이클 토큰은 필터 미적용
      }
    }

    // 유형 ID CSV — OR 결합 필터. 잘못된 토큰은 무시.
    List<Long> typeIds = new ArrayList<>();
    for (String tok : csv(p.get("type"))) {
      try {
        typeIds.add(Long.parseLong(tok));
      } catch (NumberFormatException ignored) {
        // 잘못된 유형 토큰은 필터 미적용
      }
    }

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

    // Phase 4c — fieldId / fieldValue. fieldId 가 숫자가 아니면 null 로 무시 (필터 미적용).
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
        labelIds,
        typeIds,
        parentNumber,
        topLevel,
        blocked,
        fieldId,
        fieldValue,
        reporterIds,
        cycleIds);
  }

  private static String trimToNull(String s) {
    if (s == null) return null;
    String t = s.trim();
    return t.isEmpty() ? null : t;
  }

  private static List<String> csv(String s) {
    String t = trimToNull(s);
    if (t == null) return List.of();
    return Arrays.stream(t.split(",")).map(String::trim).filter(x -> !x.isEmpty()).toList();
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
