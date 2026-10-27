package com.workplace.wiki.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.workplace.global.time.SupportedDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 공유 만들기·바꾸기 요청(WP-579) — 웹 {@code WikiPageShareRequest}. PUT 은 공유가 없으면 만들고 있으면 덮어쓴다(토큰은 유지).
 *
 * @param audience WORKSPACE | PEOPLE | PUBLIC
 * @param permission VIEW | EDIT (PUBLIC 은 VIEW 만)
 * @param userIds audience=PEOPLE 일 때 지정한 사람 전체(이전 목록과의 차이로 추가·제외를 기록한다). 다른 대상에서는 무시한다
 * @param groupIds audience=PEOPLE 일 때 지정한 조직도 부서(SHARED) 전체(WP-1023) — 그 부서와 하위 부서의 구성원이 열 수 있다.
 *     null 이면 지금 부서를 그대로 둔다(부서를 모르는 이전 클라이언트가 사람만 고쳐도 부서가 지워지지 않게), 빈 목록이면 모두 뺀다. 개인 그룹·다른 워크스페이스의
 *     그룹은 400
 * @param expiresAt 만료 시각(null 이면 무기한) — 지난 시각은 400
 * @param notification JSON {@code notify} — 새로 추가한 사람에게 알림을 보낼지와 메시지(null 이면 보내지 않음). 켜면 새로 추가된
 *     사람에게만 {@code WikiSharedWithPeopleEvent} 가 발행된다. 자바 레코드는 {@code notify} 를 구성 요소 이름으로 쓸 수
 *     없어(Object.notify) 이름만 바꿔 받는다
 */
public record WikiPageShareRequest(
    String audience,
    String permission,
    boolean includeChildren,
    List<Long> userIds,
    List<Long> groupIds,
    @SupportedDateTime OffsetDateTime expiresAt,
    @Valid @JsonProperty("notify") Notify notification) {

  /**
   * 알림 메시지 상한(글자) — 채팅 메시지 본문({@code CreateChatMessageRequest})과 같은 4000자. 웹 입력의 maxLength 도 같은
   * 값이다.
   */
  public static final int MESSAGE_MAX = 4000;

  /** 사람을 추가할 때 함께 보낼 알림 — message 는 선택. 받는 사람마다 알림 행에 복사되므로 길이를 막는다. */
  public record Notify(
      @Size(max = MESSAGE_MAX, message = "알림 메시지는 4000자 이하여야 합니다") String message) {}
}
