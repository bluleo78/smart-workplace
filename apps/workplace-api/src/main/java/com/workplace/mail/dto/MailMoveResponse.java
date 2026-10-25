package com.workplace.mail.dto;

import java.util.List;

/**
 * WP-962 메일 옮기기 결과 — 메일별 성공 여부. 실패한 메일은 로컬에서도 그대로다(웹이 목록에 되돌린다). 옮긴 메일은 같은 id 로 새 메일함에 남거나(새 위치를 알
 * 때) 로컬에서 지워진 뒤 다음 동기화로 다시 들어온다(휴지통·새 위치를 모를 때).
 */
public record MailMoveResponse(List<Result> results) {

  /**
   * 메일 한 통 결과.
   *
   * @param messageId 요청한 메일 id
   * @param ok 서버에서 옮겼는지(이미 그 메일함에 있던 것도 true)
   * @param error 실패 사유(성공이면 null)
   */
  public record Result(long messageId, boolean ok, String error) {}
}
