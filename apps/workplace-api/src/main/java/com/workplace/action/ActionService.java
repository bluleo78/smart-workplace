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
}
