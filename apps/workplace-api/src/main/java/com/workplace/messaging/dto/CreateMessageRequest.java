package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 메시지 작성 요청. body 는 최대 4000 자(빈 본문 허용 — 첨부만 있는 메시지 가능). parentMessageId 있으면 스레드 답글(없으면 채널 최상위).
 * fileIds 는 선업로드된 첨부 파일 ID 목록. driveFileIds 는 드라이브 파일 교차링크 ID 목록.
 */
public record CreateMessageRequest(
    @Size(max = 4000) String body,
    Long parentMessageId,
    List<Long> fileIds,
    // 원소 null 은 400 — 드라이브 링크 조회에서 500 이 났다(WP-743). fileIds 는 첨부 claim 이 한국어 400 으로 따로 막는다.
    // 같은 id 를 수만 번 넣으면 요청 하나가 수십 초 걸렸다(WP-794) — 개수 상한 + 중복 제거(driveFileIds()).
    @Size(max = 50, message = "드라이브 파일은 한 메시지에 50개까지 연결할 수 있습니다")
        List<@NotNull Long> driveFileIds) {

  /** 스레드가 아닌 일반 메시지용 보조 생성자 — parentMessageId = null, 첨부 없음, 드라이브 링크 없음. */
  public CreateMessageRequest(String body) {
    this(body, null, List.of(), List.of());
  }

  /** 스레드 답글용 보조 생성자 — 첨부 없음, 드라이브 링크 없음. */
  public CreateMessageRequest(String body, Long parentMessageId) {
    this(body, parentMessageId, List.of(), List.of());
  }

  /** 기존 3-인자 보조 생성자 — 드라이브 링크 없음(하위 호환). */
  public CreateMessageRequest(String body, Long parentMessageId, List<Long> fileIds) {
    this(body, parentMessageId, fileIds, List.of());
  }

  /** null 방어: fileIds 가 null 이면 빈 리스트. */
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }

  /** null 방어: driveFileIds 가 null 이면 빈 리스트. 중복 id 는 한 번만. */
  public List<Long> driveFileIds() {
    // 같은 파일을 여러 번 넣어도 링크는 하나 — 중복을 미리 걸러 반복 검사를 없앤다(WP-794).
    return driveFileIds == null ? List.of() : driveFileIds.stream().distinct().toList();
  }
}
