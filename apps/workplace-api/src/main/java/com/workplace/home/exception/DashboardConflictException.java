package com.workplace.home.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * WP-1953 대시보드 레이아웃을 읽은 뒤 다른 창·기기의 저장이 먼저 반영됨 → 409. 클라이언트가 보낸 version 이 현재 version 과 다를 때 던진다
 * (IssueConflictException 과 같은 규칙). 호출자는 최신 레이아웃을 다시 불러온다. 문구는 서버가 정하고 화면이 그대로 보여 준다.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class DashboardConflictException extends RuntimeException {
  public DashboardConflictException() {
    super("다른 곳에서 대시보드 레이아웃이 바뀌었습니다. 최신 레이아웃을 불러왔으니 확인한 뒤 다시 저장해 주세요.");
  }
}
