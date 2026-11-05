package com.workplace.issue.service;

import com.workplace.issue.outbound.IssueRecurrenceSummaries;
import com.workplace.issue.outbound.dto.IssueRecurrenceSummary;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * {@link IssueRecurrenceSummaries} 구현(WP-1375) — 반복 행과 담당 AI·맡긴 사람 이름만 읽는다.
 *
 * <p>{@link IssueRecurrenceService} 와 따로 둔 까닭: 그 서비스는 결과 글을 남기려 챗 포스터(→ ChatMessageService)에 의존하는데,
 * ChatMessageService 가 이 포트를 부르므로 같은 빈에 두면 빈 순환이 생긴다. 저장소에만 의존한다.
 */
@Component
@RequiredArgsConstructor
public class IssueRecurrenceSummaryReader implements IssueRecurrenceSummaries {

  private final IssueRecurrenceRepository repository;
  private final UserRepository userRepository;

  @Override
  public Optional<IssueRecurrenceSummary> find(long issueId) {
    return repository
        .find(issueId)
        // 지운 반복(실행 중 묘비)은 반복 업무가 아니다 — 남은 결과만 받으려고 둔 행이다.
        .filter(r -> !r.deleted())
        .map(
            r -> {
              // 담당 AI·맡긴 사람 이름을 한 번의 조회로 읽는다.
              Map<Long, String> names =
                  userRepository.findByIds(List.of(r.agentUserId(), r.createdBy())).stream()
                      .collect(Collectors.toMap(UserResponse::id, UserResponse::name));
              return new IssueRecurrenceSummary(
                  r.rrule(),
                  IssueRecurrenceRules.formatTime(r.runTime()),
                  r.enabled(),
                  names.get(r.agentUserId()),
                  r.nextRunAt(),
                  names.get(r.createdBy()));
            });
  }
}
