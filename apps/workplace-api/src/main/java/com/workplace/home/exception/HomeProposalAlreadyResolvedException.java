package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 이미 처리(승인·실패·거절·만료)된 확인카드에 다시 승인/거부를 시도(중복 클릭·다른 탭 동시 처리). */
@ResponseStatus(HttpStatus.CONFLICT)
public class HomeProposalAlreadyResolvedException extends RuntimeException {
  public HomeProposalAlreadyResolvedException(long id) {
    // 문구에 id·영문 값을 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-672, WP-619 후속)
    super("이미 처리된 확인 카드입니다");
  }
}
