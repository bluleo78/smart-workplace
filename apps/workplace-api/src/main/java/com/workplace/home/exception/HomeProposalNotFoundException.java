package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 확인카드가 없거나 호출자 소유가 아님(존재 노출 방지 위해 404 통일). */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class HomeProposalNotFoundException extends RuntimeException {
  public HomeProposalNotFoundException(long id) {
    super("확인 카드를 찾을 수 없습니다: " + id);
  }
}
