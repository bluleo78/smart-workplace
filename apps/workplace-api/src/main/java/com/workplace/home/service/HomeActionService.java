package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.action.ConfirmActionDispatcher;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 홈 도크 확인 카드 실행기 — 실제 디스패치는 공용 {@link ConfirmActionDispatcher} 에 위임한다. (확인 카드 생성 로직을 채팅 L3 위임과 공유하기
 * 위해 #333 디스패치를 중립 패키지로 추출)
 */
@Service
@RequiredArgsConstructor
public class HomeActionService {

  private final ConfirmActionDispatcher dispatcher;

  /**
   * 확인 카드 승인 실행 — 공용 디스패처에 위임.
   *
   * <p>{@code @Transactional} 필수(#492): 디스패처의 권한 검사(PermissionChecker)는 RLS 가 걸린 role_permission /
   * user_role 을 읽으므로 테넌트 GUC 가 필요하다. 트랜잭션이 없으면 {@code TenantAwareTransactionManager.doBegin} 이 GUC
   * 를 주입하지 못해 권한 행이 모두 RLS 로 걸러져 거짓 AccessDenied(예: calendar:write)가 난다. 채팅 confirm 경로({@code
   * MessagingProposalService.confirmWithBody})와 동일하게 트랜잭션 경계 안에서 실행해 GUC 를 보장한다.
   */
  @Transactional
  public Object confirm(long callerId, String actionType, JsonNode params) {
    return dispatcher.confirm(callerId, actionType, params);
  }
}
