package com.workplace.chat.dto;

import com.workplace.global.util.PersonNames;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 이슈 챗 메시지 수정 요청.
 *
 * <p>{@code keepFileIds}(WP-1680, 선택): 수정 뒤에도 남길 첨부 file id 목록. 값이 있으면 그 메시지에 지금 붙은 첨부 중 목록에 없는 것을
 * 뺀다 — 지금 붙은 첨부의 부분집합이어야 한다(아니면 400). 없으면({@code null}) 지금처럼 본문만 고친다. 채널·DM 의 {@code
 * UpdateMessageRequest}(WP-1679)와 같은 규칙이다.
 *
 * <p>본문 제약: keep 이 없으면 작성과 같이 보이는 글자가 필요하다. keep 이 있으면 본문을 비울 수 있다 — 첨부만 남은 메시지가 되기 때문이다. 본문·남길
 * 첨부·드라이브 링크가 모두 비는지는 메시지 상태를 봐야 해서 서비스가 판정한다.
 */
public record UpdateChatMessageRequest(
    @Size(max = 4000) String body,
    // 원소 null 은 400. 한 메시지 첨부 상한(10)보다 넉넉한 50 — 그 이상은 잘못된 요청.
    @Size(max = 50) List<@NotNull Long> keepFileIds) {

  /** 본문만 고치는 보조 생성자 — keepFileIds 없음(첨부 그대로). */
  public UpdateChatMessageRequest(String body) {
    this(body, null);
  }

  /**
   * 본문만 고치는 수정(keep 없음)은 보이는 글자가 있어야 한다(이전의 {@code @NotBlank @VisibleText} 와 같은 판정). keep 이 있으면
   * 여기서는 통과시키고 빈 결과 판정은 서비스에 맡긴다.
   */
  // 문구는 이전 @VisibleText 기본 문구와 같게 — 웹 토스트가 바뀌지 않게(WP-1680).
  @AssertTrue(message = "내용을 입력해 주세요")
  public boolean isTextOnlyEditBodyVisible() {
    return keepFileIds != null || PersonNames.hasVisibleChar(body);
  }

  /** 남길 첨부 id — 같은 id 가 여러 번 와도 한 번으로 본다. keep 이 없으면 null(본문만 수정). */
  public List<Long> keepFileIdsDistinct() {
    return keepFileIds == null ? null : keepFileIds.stream().distinct().toList();
  }
}
