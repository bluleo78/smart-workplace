package com.workplace.chat.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 메시지 작성 요청. body 최대 4000 자. 첨부(fileIds)나 드라이브 링크(driveFileIds)가 있으면 body 는 비어도 된다 — 빈-본문 검증은 서비스에서
 * 수행(EmptyChatMessageException).
 */
public record CreateChatMessageRequest(
    @Size(max = 4000) String body,
    List<Long> fileIds,
    // 원소 null 은 400 — 드라이브 링크 조회에서 500 이 났다(WP-743). fileIds 는 첨부 claim 이 한국어 400 으로 따로 막는다.
    // 같은 id 를 수만 번 넣으면 요청 하나가 수십 초 걸렸다(WP-794) — 개수 상한 + 중복 제거(driveFileIds()).
    @Size(max = 50, message = "드라이브 파일은 한 메시지에 50개까지 연결할 수 있습니다")
        List<@NotNull Long> driveFileIds) {

  /** 본문만 있는 편의 생성자 — 기존 테스트 및 단순 호출부 호환용. */
  public CreateChatMessageRequest(String body) {
    this(body, List.of(), List.of());
  }

  /** null 안전 접근자 — 미전달 시 빈 리스트. */
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }

  public List<Long> driveFileIds() {
    // 같은 파일을 여러 번 넣어도 링크는 하나 — 중복을 미리 걸러 반복 검사를 없앤다(WP-794).
    return driveFileIds == null ? List.of() : driveFileIds.stream().distinct().toList();
  }
}
