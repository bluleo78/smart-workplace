package com.workplace.issue.service;

import static com.workplace.issue.service.SearchParams.csv;
import static com.workplace.issue.service.SearchParams.trimToNull;

import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AiTaskCounts;
import com.workplace.issue.dto.AiTaskCursor;
import com.workplace.issue.dto.AiTaskGroup;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchResponse;
import com.workplace.issue.repository.AiTaskRepository;
import com.workplace.issue.repository.AiTaskRepository.AiTaskQuery;
import com.workplace.issue.repository.AiTaskRepository.AiTaskRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 위임 작업 목록·건수(WP-377 §5.2). 쿼리 파라미터를 {@link AiTaskQuery} 로 정규화해 {@link AiTaskRepository} 로 조회하고,
 * 항목은 이슈 목록과 같은 응답 모양({@link IssueSearchService#assembleItems})으로 조립한 뒤 에픽 묶음 정보(aiGroup, WP-375)를
 * 붙인다. /me/issues 의 (updated_at, id) 커서로는 묶음 단위 급한 순 정렬을 넘길 수 없어 전용 복합 커서를 쓴다.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AiTaskSearchService {

  private final AiTaskRepository aiTaskRepository;
  private final IssueSearchService issueSearchService;
  private final ProjectRepository projectRepository;
  private final IssueRepository issueRepository;

  /** 에픽 묶음 단위 급한 순 한 페이지(WP-375). 마지막 행의 정렬 키 7개가 다음 커서, 에픽 묶음 행에는 aiGroup 을 싣는다. */
  public IssueSearchResponse search(long callerId, Map<String, String> params) {
    AiTaskQuery query = parse(params);
    List<AiTaskRow> rows = aiTaskRepository.search(callerId, query);
    List<IssueRow> issueRows = rows.stream().map(AiTaskRow::row).toList();
    // 횡단 조회라 projectId → key 를 한 번에 해석한다.
    var keyById =
        projectRepository.keysByIds(
            issueRows.stream().map(IssueRow::projectId).distinct().toList());
    // assembleItems 는 입력 순서를 보존한다 — rows 와 같은 인덱스로 묶음 정보를 붙인다.
    var items = issueSearchService.assembleItems(issueRows, pid -> keyById.getOrDefault(pid, ""));

    // 에픽 묶음의 하위 진행(└ n/m) — 에픽 행이 이 페이지에 없어도 머리에 그릴 수 있게 묶음 키(에픽 id)로 한 번에 센다.
    List<Long> epicIds =
        rows.stream()
            .filter(r -> r.epicNumber() != null)
            .map(AiTaskRow::groupKey)
            .distinct()
            .toList();
    var childCount = issueRepository.countChildrenByParentIds(epicIds);
    var childDone = issueRepository.countDoneChildrenByParentIds(epicIds);
    List<IssueResponse> withGroups = new ArrayList<>(items.size());
    for (int i = 0; i < items.size(); i++) {
      AiTaskRow r = rows.get(i);
      AiTaskGroup g =
          r.epicNumber() == null
              ? null
              : new AiTaskGroup(
                  r.epicNumber(),
                  r.groupSize(),
                  childCount.getOrDefault(r.groupKey(), 0),
                  childDone.getOrDefault(r.groupKey(), 0));
      withGroups.add(items.get(i).withAiGroup(g));
    }

    // 기존 이슈 검색과 같은 규칙 — 꽉 찬 페이지면 다음이 있다고 본다(마지막 페이지가 정확히 size 면 빈 페이지 한 번 더).
    String nextCursor = null;
    boolean hasMore = false;
    if (!rows.isEmpty() && rows.size() >= query.size()) {
      AiTaskRow last = rows.get(rows.size() - 1);
      nextCursor = last.toCursor().encode();
      hasMore = true;
    }
    return new IssueSearchResponse(withGroups, nextCursor, hasMore);
  }

  /** 빠른 필터 칩 건수. agentState·cursor·size 는 무시된다. */
  public AiTaskCounts counts(long callerId, Map<String, String> params) {
    return aiTaskRepository.counts(callerId, parse(params));
  }

  /**
   * 파라미터 정규화. scope 는 대소문자 무시 ALL 만 전체(그 외 "나와 관련"), size 기본 30·최대 100, CSV 는 trim·빈 값 제외,
   * agentState 는 진행 중 상태만 남기고 모르는 값은 무시한다. 잘못된 cursor 는 InvalidCursorException(400).
   */
  AiTaskQuery parse(Map<String, String> p) {
    boolean all = "ALL".equalsIgnoreCase(trimToNull(p.get("scope")));
    List<String> agentStates =
        csv(p.get("agentState")).stream().filter(AgentWorkState::isActive).toList();

    String cursorStr = trimToNull(p.get("cursor"));
    AiTaskCursor cursor = cursorStr == null ? null : AiTaskCursor.decode(cursorStr);

    int size = SearchParams.size(p.get("size"));
    return new AiTaskQuery(
        all, agentStates, csv(p.get("status")), csv(p.get("priority")), cursor, size);
  }
}
