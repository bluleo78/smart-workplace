package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 확인카드가 없거나 호출자 소유가 아님(존재 노출 방지 위해 404 통일). */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class HomeProposalNotFoundException extends RuntimeException {
  public HomeProposalNotFoundException(long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("확인 카드를 찾을 수 없습니다");
  }
}
