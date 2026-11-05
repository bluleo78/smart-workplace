package com.workplace.issue.outbound;

import com.workplace.issue.outbound.dto.IssueRecurrenceSummary;
import java.util.Optional;

/**
 * 이슈의 반복 업무 요약을 읽는 포트(WP-1375). chat 모듈이 이슈 챗 생성 이벤트를 만들 때 부른다(chat→issue 는 기존 의존 — {@link
 * RecurringQuestionAnswers} 와 같은 방향). issue 모듈이 소유·구현하고 chat 은 이 인터페이스만 안다.
 */
public interface IssueRecurrenceSummaries {

  /** 이슈에 반복 설정이 있으면 그 요약, 없거나 지운 반복(묘비)이면 빈 값. 호출자의 테넌트 트랜잭션 안에서 읽는다. */
  Optional<IssueRecurrenceSummary> find(long issueId);
}
