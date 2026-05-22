package com.workplace.issue.service;

import com.workplace.issue.dto.IssueCursor;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.IssueRepository;
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
 * 리포지토리에 위임한다.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class IssueSearchService {

  private static final int DEFAULT_SIZE = 30;
  private static final int MAX_SIZE = 100;

  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;

  /** 검색. params 키: q, status, assignee, priority, dueFrom, dueTo, cursor, size. */
  public IssueSearchResponse search(Long callerId, String projectKey, Map<String, String> params) {
    var project = accessGuard.assertMember(projectKey, callerId);
    IssueSearchQuery query = parse(params);

    var rows = issueRepository.search(project.id(), query);
    var items = rows.stream().map(r -> IssueResponse.from(project.key(), r)).toList();

    String nextCursor = null;
    boolean hasMore = false;
    if (!rows.isEmpty() && rows.size() >= query.size()) {
      var last = rows.get(rows.size() - 1);
      nextCursor = IssueCursor.encode(last.updatedAt(), last.id());
      hasMore = true;
    }
    return new IssueSearchResponse(items, nextCursor, hasMore);
  }

  /** Map → IssueSearchQuery 정규화. 잘못된 cursor/date 는 InvalidCursorException(400) 으로 변환. */
  private IssueSearchQuery parse(Map<String, String> p) {
    String q = trimToNull(p.get("q"));
    List<String> statuses = csv(p.get("status"));
    List<String> priorities = csv(p.get("priority"));

    var assigneeTokens = csv(p.get("assignee"));
    List<Long> assigneeIds = new ArrayList<>();
    boolean includeUnassigned = false;
    for (String tok : assigneeTokens) {
      if ("null".equalsIgnoreCase(tok)) {
        includeUnassigned = true;
      } else {
        try {
          assigneeIds.add(Long.parseLong(tok));
        } catch (NumberFormatException e) {
          // 알 수 없는 토큰은 무시 — 비어 있으면 필터 미적용
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

    return new IssueSearchQuery(
        q, statuses, assigneeIds, includeUnassigned, priorities, dueFrom, dueTo, cursor, size);
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
