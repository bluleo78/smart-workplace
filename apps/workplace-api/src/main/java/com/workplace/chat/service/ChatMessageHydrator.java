package com.workplace.chat.service;

import com.workplace.chat.dto.ChatMessageAttachmentResponse;
import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.repository.ChatMessageAttachmentRepository;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.fileai.service.ExtractedTextService;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 채팅 메시지에 첨부(추출 상태 포함)·드라이브 링크를 채운다 — 메시지를 내려주는 모든 경로(단건·페이지·스레드 최근 메시지)가 같은 규칙을 쓰게 한 곳에 둔다.
 *
 * <p>왜: 저장소는 메시지 행만 읽고 첨부·링크는 비워 돌려준다. 스레드 응답의 최근 메시지가 이 단계를 빠뜨려, 챗을 다시 열면 보냈던 이미지가 화면에서
 * 사라졌다(WP-102). RLS 트랜잭션 안에서 호출해야 첨부가 보인다.
 */
@Component
@RequiredArgsConstructor
public class ChatMessageHydrator {

  /** 드라이브 링크(drive_file_ref)의 채팅 메시지 소스 타입 — 링크 생성·조회가 같은 값을 쓴다. */
  static final String SOURCE_TYPE = "CHAT_MESSAGE";

  private final ChatMessageAttachmentRepository attachmentRepo;
  private final DriveLinkService driveLinkService;
  // WP-242: 첨부 추출 상태 하이드레이션.
  private final ExtractedTextService extractedText;

  /**
   * 메시지 목록에 첨부·드라이브 링크를 배치로 채운다(N+1 회피). 순서는 그대로 둔다.
   *
   * <p>삭제된 메시지는 채우지 않는다 — 소프트 삭제라 첨부·링크 행이 남아 있어, 채우면 "(삭제됨)" 메시지로 지운 파일 정보가 내려간다.
   */
  public List<ChatMessageResponse> hydrate(List<ChatMessageResponse> messages) {
    List<Long> ids =
        messages.stream().filter(m -> !m.deleted()).map(ChatMessageResponse::id).toList();
    if (ids.isEmpty()) return messages;
    var amap = attachmentsWithExtraction(ids);
    var dmap = driveLinkService.listLinksBatch(SOURCE_TYPE, ids);
    return messages.stream()
        .map(
            m ->
                m.withAttachments(amap.getOrDefault(m.id(), List.of()))
                    .withDriveLinks(dmap.getOrDefault(m.id(), List.of())))
        .toList();
  }

  /** 메시지 페이지의 항목을 채운다 — 페이징 정보(커서·더 있음)는 그대로 둔다. 목록 API 와 스레드 첫 페이지가 같이 쓴다(WP-365). */
  public ChatMessagePage hydrate(ChatMessagePage page) {
    return new ChatMessagePage(
        hydrate(page.items()), page.nextCursor(), page.hasMore(), page.truncated());
  }

  /** 단건 메시지에 첨부·드라이브 링크를 채운다. */
  public ChatMessageResponse hydrate(ChatMessageResponse message) {
    return hydrate(List.of(message)).get(0);
  }

  /**
   * 메시지들의 첨부를 읽고 추출 상태를 일괄로 붙인다(WP-242).
   *
   * <p>전체 첨부를 한 리스트로 펴서 attach 를 한 번만 호출(조회 1회)한 뒤 messageId 로 다시 묶는다. 스트림 순서가 유지돼 메시지별 첨부 순서는
   * 그대로다.
   */
  private Map<Long, List<ChatMessageAttachmentResponse>> attachmentsWithExtraction(
      List<Long> messageIds) {
    List<ChatMessageAttachmentResponse> all =
        attachmentRepo.findByMessageIds(messageIds).values().stream()
            .flatMap(List::stream)
            .toList();
    return extractedText
        .attach(
            all,
            ChatMessageAttachmentResponse::fileId,
            ChatMessageAttachmentResponse::withExtraction)
        .stream()
        .collect(Collectors.groupingBy(ChatMessageAttachmentResponse::messageId));
  }
}
