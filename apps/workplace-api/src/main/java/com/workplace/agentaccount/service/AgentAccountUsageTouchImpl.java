package com.workplace.agentaccount.service;

import com.workplace.agentaccount.usage.AgentAccountUsageRepository;
import com.workplace.agentruntime.service.AgentAccountUsageTouch;
import java.time.Instant;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AgentAccountUsageTouch} 구현(WP-1449) — runner {@code /observed} 가 RUNNING 으로 보고한 AI 가
 * 묶인(폐기되지 않은) 계정의 마지막 사용 시각을 올린다. 사용량을 조회하지 않는 Gen:iA·OpenAI 호환 계정은 이 값으로 「쓰이고 있음」을 보인다(모든 종류 공통으로
 * 갱신).
 *
 * <p>NESTED(세이브포인트)로 돈다 — 관찰 보고 트랜잭션 안에서 불리는데, 기본값 REQUIRED 로 바깥에 참여하면 여기서 난 예외를 바깥이 잡아도 Spring 이
 * 참여 트랜잭션 전체를 rollback-only 로 표시해 관찰 저장까지 커밋 때 UnexpectedRollbackException 으로 되돌려진다. 세이브포인트는 실패를 이
 * 범위에 가둔다. 새 커넥션을 잡지 않으므로(REQUIRES_NEW 와 달리) 풀 포화 때 요청끼리 기다리지 않고, 바깥이 이미 맞춘 테넌트 GUC 를 그대로 쓴다.
 */
@Component
@RequiredArgsConstructor
public class AgentAccountUsageTouchImpl implements AgentAccountUsageTouch {

  private final AgentAccountUsageRepository usageRepository;

  @Override
  // NESTED 인 까닭은 클래스 Javadoc 참조.
  @Transactional(propagation = Propagation.NESTED)
  public void touchRunning(Collection<Long> agentUserIds) {
    usageRepository.touchLastUsed(agentUserIds, Instant.now());
  }
}
