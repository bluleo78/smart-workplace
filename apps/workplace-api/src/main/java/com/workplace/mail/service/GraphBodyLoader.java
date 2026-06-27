package com.workplace.mail.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Microsoft Graph 공급자용 {@link MailBodyLoader} 구현.
 *
 * <p>Graph API에서 메시지 본문(body.contentType/body.content)과 첨부 메타를 조회해 DB에 캐시한다. 멱등
 * 가드(body_fetched_at)와 AI 분류 트리거는 {@link MailBodyFetcher} 디스패처가 처리하므로 이 loader는 순수 적재만 담당한다.
 *
 * <p>Graph API 특성:
 *
 * <ul>
 *   <li>body.contentType: "html" 또는 "text" — 각각 bodyHtml/bodyText 에 저장.
 *   <li>bodyPreview: 스니펫(최대 255자, Graph 응답 그대로 사용).
 *   <li>첨부 메타: GET /me/messages/{id}/attachments?$select=name,contentType,size.
 *   <li>네트워크/파싱 오류는 best-effort 로 삼킨다(로그만, 토큰 평문 미출력).
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GraphBodyLoader implements MailBodyLoader {

  private final EmailMessageRepository messageRepo;

  /** Task5: 본문·스니펫을 email_content 에 기록한다. */
  private final EmailContentRepository contentRepo;

  private final EmailAttachmentRepository attachmentRepo;
  private final GraphTokenService graphTokenService;
  private final GraphApiClient graphApiClient;

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * Graph API에서 단건 메시지 본문을 적재한다.
   *
   * <p>providerMessageId 가 null 이면 Graph 메시지 조회가 불가하므로 false 반환한다. body.contentType="html" 이면
   * bodyHtml 에, "text" 이면 bodyText 에 저장한다. 첨부 메타는 hasAttachments=true 일 때만 추가 조회한다.
   *
   * <p>Task5: 본문·스니펫은 email_content 에 기록(contentRepo.updateBody). has_attachment 만 envelope 에 남긴다.
   * contentId=0 이면 content 미연결 — false 반환.
   *
   * @return true: 적재 성공(contentRepo.updateBody 호출 완료). false: providerMessageId
   *     없음·contentId=0·네트워크/파싱 실패(재시도 가능). 적재 실패 시 분류 skip — 빈 스니펫 기반 영구 오분류 방지(I1 수정).
   */
  @Override
  public boolean loadBody(long userId, BodyTarget target, EmailAccountResponse account) {
    String providerMessageId = target.providerMessageId();
    if (providerMessageId == null) {
      // Graph 계정이지만 provider_message_id 없음 — 적재 불가, 분류도 skip
      log.warn("GraphBodyLoader: provider_message_id 없음 (messageId={})", target.messageId());
      return false;
    }
    // contentId=0: content 행이 연결되지 않은 legacy envelope — 본문 저장 불가
    if (target.contentId() == 0L) {
      log.warn("GraphBodyLoader: content_id 없음 — 적재 skip (messageId={})", target.messageId());
      return false;
    }

    try {
      String accessToken = graphTokenService.getAccessToken(userId, target.accountId());

      // 본문·스니펫·첨부플래그 조회
      String msgUrl =
          "/me/messages/" + providerMessageId + "?$select=body,bodyPreview,hasAttachments";
      GraphMessageBody msgResp = graphApiClient.get(accessToken, msgUrl, GraphMessageBody.class);

      String bodyHtml = null;
      String bodyText = null;
      if (msgResp.body() != null) {
        // body.contentType: "html" | "text" (대소문자 무관)
        String ct = msgResp.body().contentType();
        if ("html".equalsIgnoreCase(ct)) {
          bodyHtml = msgResp.body().content();
        } else {
          bodyText = msgResp.body().content();
        }
      }

      String snippet = msgResp.bodyPreview();
      boolean hasAttachment = Boolean.TRUE.equals(msgResp.hasAttachments());

      // 본문·스니펫은 공유 content 에 기록 — 같은 message_id 를 수신한 다른 envelope 도 즉시 본문 보유
      contentRepo.updateBody(target.contentId(), bodyText, bodyHtml, snippet);
      // has_attachment 는 envelope 속성(첨부 존재 표시)으로 유지
      messageRepo.markHasAttachment(target.messageId(), hasAttachment);

      // 첨부 메타 적재 — hasAttachments=true 일 때만 추가 Graph 호출
      if (hasAttachment) {
        loadAttachmentMeta(accessToken, providerMessageId, target.messageId(), target.contentId());
      }
      // V97: per-envelope 마커 — 이 envelope 의 본문/첨부 적재가 완료됐음을 기록
      messageRepo.markFetched(target.messageId());
      return true;
    } catch (Exception e) {
      // 토큰·민감정보 노출 방지 — messageId 와 예외 요약만 기록
      // false 반환 — 적재 실패 시 분류 skip(빈 스니펫 기반 영구 오분류 방지).
      log.warn("Graph 본문 적재 실패 (messageId={}): {}", target.messageId(), e.toString());
      return false;
    }
  }

  /**
   * Graph 첨부 메타 조회 후 DB 에 삽입한다.
   *
   * <p>GET /me/messages/{id}/attachments?$select=id,name,contentType,size — 바이너리(contentBytes) 는
   * 요청하지 않는다(메타만). id 를 provider_attachment_id 로 저장해 다운로드 시 ordinal 의존 없이 직접 조회할 수 있도록 한다. ordinal
   * 은 Graph 응답 배열 인덱스(0-based)로 할당해 content_attachment manifest 의 안정 좌표로 사용한다.
   */
  private void loadAttachmentMeta(
      String accessToken, String providerMessageId, long messageId, long contentId) {
    try {
      String url =
          "/me/messages/" + providerMessageId + "/attachments?$select=id,name,contentType,size";
      GraphAttachmentList listResp =
          graphApiClient.get(accessToken, url, GraphAttachmentList.class);

      if (listResp == null || listResp.value() == null) {
        return;
      }
      List<GraphAttachmentItem> items = listResp.value();
      for (int i = 0; i < items.size(); i++) {
        GraphAttachmentItem item = items.get(i);
        ParsedAttachment parsed =
            new ParsedAttachment(
                item.name(),
                item.contentType(),
                item.size() != null ? item.size() : 0L,
                null, // Graph 첨부는 contentId 없음(인라인 img 는 별도 처리 대상)
                item.id() // Graph 첨부 안정 id — 다운로드 경로에서 사용
                );
        // ordinal = Graph 응답 배열 인덱스(0-based). content_attachment find-or-create 로 manifest 공유.
        attachmentRepo.insert(messageId, contentId, i, parsed);
      }
    } catch (Exception e) {
      // 첨부 메타 적재 실패는 best-effort — 본문 적재는 이미 완료
      log.warn("Graph 첨부 메타 적재 실패 (messageId={}): {}", messageId, e.toString());
    }
  }

  // ---- Graph API 응답 역직렬화 DTO (내부 전용) ----

  /** GET /me/messages/{id}?$select=body,bodyPreview,hasAttachments 응답. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GraphMessageBody(ItemBody body, String bodyPreview, Boolean hasAttachments) {}

  /** Graph body 객체. contentType: "html"|"text", content: 본문 문자열. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record ItemBody(String contentType, String content) {}

  /** GET /me/messages/{id}/attachments 응답(value 배열). */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GraphAttachmentList(List<GraphAttachmentItem> value) {}

  /** 단일 첨부 메타 항목. id 는 Graph 첨부 안정 식별자 — 다운로드 직접 조회에 사용. */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GraphAttachmentItem(
      String id, String name, String contentType, @JsonProperty("size") Long size) {}
}
