package com.workplace.action;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공용 확인 액션 실행 진입점. @Transactional 로 RLS GUC 를 주입한 뒤 ConfirmActionDispatcher 로 위임한다 (비-tx 호출 시 GUC
 * 미주입 → 권한 RLS 가 거짓 403 을 낼 수 있어 tx 경계가 필수).
 */
@Service
@RequiredArgsConstructor
public class ActionService {

  private final ConfirmActionDispatcher dispatcher;

  /** 확인 카드 승인 — callerId 권한 안에서 actionType 에 해당하는 도메인 액션을 실행하고 결과 객체를 반환한다. */
  @Transactional
  public Object confirm(long callerId, String actionType, JsonNode params) {
    return dispatcher.confirm(callerId, actionType, params);
  }

  /**
   * 확인 카드 사전검증(dry-run, #842) — 승인 시점과 같은 권한·매핑·도메인 검증만 수행한다.
   *
   * <p>@Transactional 은 confirm 과 같은 이유로 필수(RLS GUC 주입 — 없으면 거짓 403/404). readOnly 로 여는 이유는 dry-run
   * 이 어떤 흔적도 남기지 않아야 하기 때문이다: prepare 는 설계상 쓰기를 하지 않지만, 누군가 검증 경로에 쓰기를 섞으면 조용히 커밋되는 대신 DB 가 즉시
   * 거부한다. setRollbackOnly 는 쓰지 않는다 — 호출자가 이미 트랜잭션 안이면 그 트랜잭션까지 롤백 전용으로 오염시키기 때문.
   */
  @Transactional(readOnly = true)
  public void validate(long callerId, String actionType, JsonNode params) {
    dispatcher.validate(callerId, actionType, params);
  }
}
