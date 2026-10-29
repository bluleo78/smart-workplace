package com.workplace.home.service;

import static com.workplace.home.dto.PriorityItemRow.ISSUE_DUE;

import com.workplace.home.dto.PriorityItemResponse;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.service.IssueSearchService;
import java.time.Clock;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 저장된 우선순위 항목 조회 — importanceScore+urgencyScore 내림차순(SynthesisLayer 정렬과 동일 기준).
 *
 * <p>저장된 결과는 다음 배치(15분)까지, AI 응답이 비거나 ai-agent 장애면 그보다 오래 남는다. 그동안 끝나거나 지워진 이슈가 「긴급」에 남지 않도록 「이슈
 * 마감」 행은 읽을 때 이슈를 다시 본다(WP-1104) — 같은 홈의 SynthesisLayer(isClosedDue)와 같은 결과가 되게.
 */
@Service
public class PriorityItemQueryService {

  private final PriorityItemRepository repo;
  private final IssueSearchService issueSearchService;

  /** 「오늘」을 정하는 시계 — 테스트가 KST 이른 아침을 고정할 수 있게 바꿀 수 있다. */
  private Clock clock = Clock.systemUTC();

  public PriorityItemQueryService(
      PriorityItemRepository repo, IssueSearchService issueSearchService) {
    this.repo = repo;
    this.issueSearchService = issueSearchService;
  }

  /** 테스트 전용 — 「오늘」을 고정한다. */
  void useClock(Clock clock) {
    this.clock = clock;
  }

  @Transactional(readOnly = true)
  public List<PriorityItemResponse> listForUser(long userId) {
    List<PriorityItemRow> rows = repo.findForUser(userId);
    List<Long> dueIssueIds =
        rows.stream()
            .filter(r -> ISSUE_DUE.equals(r.sourceType()))
            .map(r -> parseId(r.sourceId()))
            .filter(Objects::nonNull)
            .toList();
    Set<Long> stillDue =
        issueSearchService.findStillDueAssignedIds(
            userId, dueIssueIds, IssueDueWindow.today(clock));
    return rows.stream()
        // 이슈 마감 행은 지금도 마감 후보인 이슈만 — id 를 읽지 못한 행(null)은 이슈를 찾을 수 없으니 빠진다.
        .filter(
            r -> {
              if (!ISSUE_DUE.equals(r.sourceType())) return true;
              Long id = parseId(r.sourceId());
              return id != null && stillDue.contains(id);
            })
        .sorted(
            Comparator.comparingInt((PriorityItemRow r) -> r.importanceScore() + r.urgencyScore())
                .reversed())
        .map(PriorityItemResponse::from)
        .toList();
  }

  /** 이슈 id 문자열 → 숫자. 숫자가 아니면 null — 그 행은 이슈를 찾을 수 없으니 빠진다. */
  private static Long parseId(String sourceId) {
    try {
      return Long.valueOf(sourceId);
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
