package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.action.ConfirmActionDispatcher;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 홈 도크 확인 카드 실행기 — 실제 디스패치는 공용 {@link ConfirmActionDispatcher} 에 위임한다. (확인 카드 생성 로직을 채팅 L3 위임과 공유하기
 * 위해 #333 디스패치를 중립 패키지로 추출)
 */
@Service
@RequiredArgsConstructor
public class HomeActionService {

  private final ConfirmActionDispatcher dispatcher;

  /** 확인 카드 승인 실행 — 공용 디스패처에 위임. */
  public Object confirm(long callerId, String actionType, JsonNode params) {
    return dispatcher.confirm(callerId, actionType, params);
  }
}
