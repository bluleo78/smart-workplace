package com.workplace.issue.service;

import static com.workplace.issue.service.SearchParams.csv;
import static com.workplace.issue.service.SearchParams.trimToNull;

import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AiTaskCounts;
import com.workplace.issue.dto.AiTaskCursor;
import com.workplace.issue.dto.AiTaskGroup;
import com.workplace.issue.dto.AiTaskProject;
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
import java.util.Objects;
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
  private final AgentWorkService agentWorkService;

  /**
   * 프로젝트 → 에픽 묶음 단위 급한 순 한 페이지(WP-375, WP-426). 마지막 행의 정렬 키 10개가 다음 커서, 에픽 묶음 행에는 aiGroup 을, 모든 행에는
   * 프로젝트 머리용 aiProject 를 싣는다.
   */
  public IssueSearchResponse search(long callerId, Map<String, String> params) {
    AiTaskQuery query = parse(params);
    List<AiTaskRow> rows = aiTaskRepository.search(callerId, query);
    List<IssueRow> issueRows = rows.stream().map(AiTaskRow::row).toList();
    // 횡단 조회라 projectId → key 를 한 번에 해석한다.
    List<Long> projectIds = issueRows.stream().map(IssueRow::projectId).distinct().toList();
    var keyById = projectRepository.keysByIds(projectIds);
    // 프로젝트 머리(WP-426)용 이름 — 키와 같은 id 목록으로 한 번에 해석한다.
    var nameById = projectRepository.namesByIds(projectIds);
    // assembleItems 는 입력 순서를 보존한다 — rows 와 같은 인덱스로 묶음 정보를 붙인다.
    var items =
        withEndedWork(
            issueSearchService.assembleItems(
                callerId, issueRows, pid -> keyById.getOrDefault(pid, "")),
            rows);

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
      // 이름이 없으면(이론상 없음 — 활성 프로젝트만 조회됨) 키로 대신한다(웹 밖 소비자도 빈 머리를 받지 않게). size 는 필터 후 그 프로젝트 행 수.
      String pName =
          nameById.getOrDefault(r.row().projectId(), keyById.getOrDefault(r.row().projectId(), ""));
      withGroups.add(
          items.get(i).withAiGroup(g).withAiProject(new AiTaskProject(pName, r.projectSize())));
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

  /**
   * 완료 보기 행(WP-396)에 목록 쿼리가 고른 대표 종료 작업을 싣는다 — 행 배지가 실제 결과(완료·실패·취소·반려)를 보이도록. 대표 id 는 종료 상태를 요청했을
   * 때만 오고, 행을 걸리게 한 것과 같은 조건(요청한 종료 상태·나와 관련 범위)으로 골라져 있다. 그 사이 새 작업이 시작돼 진행 중 작업이 실린 행은 그대로 둔다. 이슈
   * 공통 조립(assembleItems)은 진행 중 작업만 싣고 다른 화면도 쓰므로 이 보충은 이 화면에서만 한다. 입력 순서를 보존한다.
   */
  private List<IssueResponse> withEndedWork(List<IssueResponse> items, List<AiTaskRow> rows) {
    List<Long> workIds =
        rows.stream().map(AiTaskRow::endedWorkId).filter(Objects::nonNull).toList();
    if (workIds.isEmpty()) return items;
    var ended = agentWorkService.endedViewsByIds(workIds);
    return items.stream()
        .map(
            it -> {
              var w = ended.get(it.id());
              boolean idle = it.agentWork() == null || it.agentWork().isEmpty();
              return w == null || !idle ? it : it.withAgentWork(List.of(w));
            })
        .toList();
  }

  /** 빠른 필터 칩 건수. agentState·cursor·size 는 무시된다. */
  public AiTaskCounts counts(long callerId, Map<String, String> params) {
    return aiTaskRepository.counts(callerId, parse(params));
  }

  /**
   * 파라미터 정규화. scope 는 대소문자 무시 ALL 만 전체(그 외 "나와 관련"), size 기본 30·최대 100, CSV 는 trim·빈 값 제외,
   * agentState 는 진행 중·종료 상태만 남기고(종료 상태 = 완료 보기, WP-396) 모르는 값은 무시한다. 이슈 status·priority 는 이슈 검색과 같이
   * 없는 값이면 400(WP-661). 잘못된 cursor 는 InvalidCursorException(400).
   */
  AiTaskQuery parse(Map<String, String> p) {
    boolean all = "ALL".equalsIgnoreCase(trimToNull(p.get("scope")));
    List<String> agentStates =
        csv(p.get("agentState")).stream()
            .filter(s -> AgentWorkState.isActive(s) || AgentWorkState.isTerminal(s))
            .toList();

    String cursorStr = trimToNull(p.get("cursor"));
    AiTaskCursor cursor = cursorStr == null ? null : AiTaskCursor.decode(cursorStr);

    int size = SearchParams.size(p.get("size"));
    return new AiTaskQuery(
        all,
        agentStates,
        SearchParams.statuses(p.get("status")),
        SearchParams.priorities(p.get("priority")),
        cursor,
        size);
  }
}
