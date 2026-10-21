package com.workplace.messaging.exception;

/**
 * 이 워크스페이스에서 비활성(정지)인 구성원과 대화를 시작하거나, 채널에 초대하거나, 1:1 DM 으로 메시지를 보내려 함 → 409(WP-723). 「멤버가 아닌
 * 사용자」·「권한이 없습니다」 같은 엉뚱한 이유 대신 실제 이유를 알린다. 이슈 담당 지정의 「비활성화된 구성원은 담당자로 지정할 수 없습니다」와 같은 말투다.
 */
public class InactiveMemberException extends RuntimeException {
  public InactiveMemberException(String message) {
    super(message);
  }
}
