package com.workplace.mail.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.workplace.mail.outbound.GraphApiClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Graph 인라인 첨부의 MIME Content-ID 조회(WP-68).
 *
 * <p>본문 HTML 은 {@code <img src="cid:...">} 로 첨부를 참조하는데, contentId 는 파생 타입(fileAttachment) 속성이라 첨부
 * 목록 {@code $select} 에 안전하게 넣을 수 없다(타입캐스트 select 는 미검증 — 실패 시 첨부 목록 전체 적재가 깨진다). 그래서 문서화된 단건 조회
 * {@code GET /me/messages/{id}/attachments/{aid}} 응답의 contentId 를 읽는다. 단건 응답엔 contentBytes 가 포함되므로
 * 호출처가 인라인·소용량 후보로 한정해 호출해야 한다.
 */
@Component
@RequiredArgsConstructor
public class GraphInlineContentIdResolver {

  /** 단건 조회 후보 크기 상한 — contentBytes 전송 비용을 인라인 이미지 수준으로 제한. */
  public static final long MAX_INLINE_BYTES = 5L * 1024 * 1024;

  private final GraphApiClient graphApiClient;

  /**
   * 단건 첨부 조회로 Content-ID 를 얻는다.
   *
   * <p>"값 없음"과 "조회 실패"를 구분한다 — 실패(네트워크·429·5xx)는 예외로 전파해 호출처가 재시도 가능 상태로 남기게 하고, null 은 Graph 가
   * Content-ID 를 주지 않은 경우만 뜻한다(지연 백필이 일시 장애를 "없음"으로 영구 기록하지 않도록).
   *
   * @return 꺾쇠를 제거한 Content-ID, 값이 없으면 null
   * @throws RuntimeException Graph 호출 실패
   */
  public String fetchContentId(
      String accessToken, String providerMessageId, String providerAttachmentId) {
    GraphAttachmentContentId resp =
        graphApiClient.get(
            accessToken,
            "/me/messages/" + providerMessageId + "/attachments/" + providerAttachmentId,
            GraphAttachmentContentId.class);
    return resp == null ? null : InlineImageSupport.normalizeContentId(resp.contentId());
  }

  /** 단건 첨부 응답 중 contentId 만 역직렬화(contentBytes 등은 무시). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GraphAttachmentContentId(String contentId) {}
}
