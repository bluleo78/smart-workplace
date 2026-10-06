package com.workplace.home.service;

import com.workplace.chat.service.ChatMessageAttachmentStorage;
import com.workplace.file.storage.StorageDomain;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.home.dto.HomeUploadedFile;
import com.workplace.home.exception.HomeAttachmentInvalidException;
import com.workplace.home.repository.HomeAttachmentRepository;
import com.workplace.home.repository.HomeAttachmentRepository.Candidate;
import com.workplace.home.repository.HomeSessionRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 메인 AI 채팅 첨부(WP-234) — 호출자 단위 선업로드, 전송 시 연결·승격·추출 요청, 세션 첨부 조회·읽기.
 *
 * <p>업로드는 세션이 아니라 호출자 단위다(새 대화의 첫 메시지 전에는 세션이 없다). 모든 메서드는 트랜잭션 안에서 돈다 — file·정션이 RLS 대상이라 GUC 가
 * 필요하다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class HomeAttachmentService {

  /** 세션당 첨부 상한 — 매 턴 프롬프트에 싣는 목록 크기를 묶는다. */
  public static final int MAX_PER_SESSION = 30;

  static final String MSG_NO_FILES = "업로드할 파일이 없어요.";
  static final String MSG_TOO_LARGE = "파일 하나는 25MB 까지 첨부할 수 있어요.";

  /** 본문도 첨부도 없는 전송 — 컨트롤러와 서비스가 같은 문구를 쓴다. */
  public static final String MSG_EMPTY = "메시지를 입력하거나 파일을 첨부해 주세요.";

  static final String MSG_DUPLICATE = "같은 파일이 두 번 첨부됐어요.";
  static final String MSG_INVALID_FILE = "첨부 파일을 사용할 수 없어요. 파일을 다시 올려 주세요.";
  static final String MSG_SESSION_LIMIT =
      "이 대화에는 파일을 최대 " + MAX_PER_SESSION + "개까지 첨부할 수 있어요. 새 대화를 열어 주세요.";

  /** 이슈 챗과 같은 임시 저장 구현 — 도메인만 HOME 으로 지정해 경로를 분리한다. */
  private final ChatMessageAttachmentStorage storage;

  /** 홈 첨부 정션·바인딩 후보 조회. */
  private final HomeAttachmentRepository repo;

  /** 세션 행 잠금(세션당 상한 검사 직렬화). */
  private final HomeSessionRepository sessionRepo;

  /** 소유 검증·USER 메시지 저장(제목 갱신 포함). */
  private final HomeSessionService sessionService;

  /** 추출 요청 이벤트 발행(fileai). */
  private final ApplicationEventPublisher eventPublisher;

  /** 파일 1개당 최대 크기(바이트) — 이슈 챗과 같은 설정. */
  @Value("${workplace.storage.attachment.max-file-size-bytes:26214400}")
  private long maxFileSize;

  /** 요청(메시지)당 최대 첨부 수 — 이슈 챗과 같은 설정. */
  @Value("${workplace.storage.attachment.max-per-message:10}")
  private int maxPerMessage;

  /**
   * 선업로드 — 개수·크기를 먼저 모두 검사한 뒤 저장한다(일부만 저장되고 400 이 나는 일이 없게). 반환한 fileId 를 전송(fileIds)에 쓴다.
   *
   * @throws HomeAttachmentInvalidException 파일 없음·개수 초과·크기 초과
   */
  public List<HomeUploadedFile> upload(long callerId, List<MultipartFile> files) {
    if (files == null || files.isEmpty()) throw new HomeAttachmentInvalidException(MSG_NO_FILES);
    if (files.size() > maxPerMessage) throw new HomeAttachmentInvalidException(tooManyMessage());
    for (MultipartFile mf : files) {
      if (mf.getSize() > maxFileSize) throw new HomeAttachmentInvalidException(MSG_TOO_LARGE);
    }
    List<HomeUploadedFile> out = new ArrayList<>();
    for (MultipartFile mf : files) {
      // 저장소와 같은 규칙으로 표시 이름을 정한다(null → "file").
      String name = mf.getOriginalFilename() != null ? mf.getOriginalFilename() : "file";
      ChatMessageAttachmentStorage.Stored stored;
      try {
        stored = storage.storeTemporary(mf, callerId, StorageDomain.HOME);
      } catch (IOException e) {
        throw new UncheckedIOException("첨부 저장 실패", e);
      }
      out.add(new HomeUploadedFile(stored.fileId(), name, stored.mimeType(), mf.getSize()));
    }
    return out;
  }

  /**
   * 전송 전 사전 검증(잠금 없음) — 세션을 만들기 전에 불러, 잘못된 fileId 로 빈 새 세션이 남지 않게 한다. 실제 연결은 appendUserMessage 가
   * 잠금을 잡고 다시 검증한다.
   */
  @Transactional(readOnly = true)
  public void precheck(long callerId, String query, List<Long> fileIds) {
    List<Long> ids = fileIds == null ? List.of() : fileIds;
    if ((query == null || query.isBlank()) && ids.isEmpty()) {
      throw new HomeAttachmentInvalidException(MSG_EMPTY);
    }
    validateIds(ids);
    checkBindable(callerId, ids, repo.findCandidates(ids));
  }

  /**
   * USER 메시지 저장 + 첨부 연결을 한 트랜잭션으로 한다(WP-234).
   *
   * <ol>
   *   <li>세션 행 잠금 → 세션 첨부 수 + 이번 개수 ≤ 30 확인(동시 전송은 잠금에서 줄 선다)
   *   <li>file 행 잠금 후 각 파일이 호출자 소유·임시·미만료·미연결 ATTACHMENT 인지 확인
   *   <li>USER 메시지 저장 → 정션 INSERT → 영구 승격 → 추출 요청 이벤트(TEXT_ONLY, 트랜잭션 안 — fileai 리스너가 같은 트랜잭션에서 행을
   *       만든다)
   * </ol>
   *
   * @param query 본문(null·공백이면 ""로 저장)
   * @return 저장된 USER 메시지 id
   */
  public long appendUserMessage(long callerId, UUID sessionId, String query, List<Long> fileIds) {
    String content = query == null || query.isBlank() ? "" : query;
    List<Long> ids = fileIds == null ? List.of() : fileIds;
    if (ids.isEmpty()) {
      if (content.isEmpty()) throw new HomeAttachmentInvalidException(MSG_EMPTY);
      return sessionService.appendUserMessage(callerId, sessionId, content, null);
    }
    validateIds(ids);
    sessionService.ensureOwner(callerId, sessionId);
    // 잠금 → 개수 확인 순서가 중요하다 — 거꾸로면 두 전송이 같은 개수를 보고 둘 다 통과한다.
    sessionRepo.lockForUpdate(sessionId);
    if (repo.countBySession(sessionId) + ids.size() > MAX_PER_SESSION) {
      throw new HomeAttachmentInvalidException(MSG_SESSION_LIMIT);
    }
    Map<Long, Candidate> byId = checkBindable(callerId, ids, repo.lockCandidates(ids));
    long messageId =
        sessionService.appendUserMessage(
            callerId, sessionId, content, byId.get(ids.get(0)).originalName());
    for (Long id : ids) repo.bind(id, messageId, callerId);
    // 승격은 반드시 이 트랜잭션 안에 둔다 — 같은 파일을 동시에 붙이려는 뒤 요청은 잠금 대기 후 file 행의 expires_at(NULL)을 보고 거절된다.
    // 승격을 커밋 뒤로 미루면 뒤 요청이 "임시"로 보고 정션 INSERT 에서 PK 위반(500)이 난다.
    repo.promoteToPermanent(ids);
    // 메시지에 붙어 영구가 된 시점에 텍스트 추출을 요청한다(이슈 챗 bindToMessage 와 같은 흐름). 이미지는 리스너가 SKIPPED 로 남긴다.
    for (Long id : ids) {
      eventPublisher.publishEvent(
          FileExtractionRequestedEvent.of(
              id, byId.get(id).mimeType(), ExtractionProfile.TEXT_ONLY));
    }
    return messageId;
  }

  /** 입력 형태 검사 — 개수 상한·null 요소·중복. 존재·소유 판정은 checkBindable. */
  private void validateIds(List<Long> ids) {
    if (ids.size() > maxPerMessage) throw new HomeAttachmentInvalidException(tooManyMessage());
    if (ids.stream().anyMatch(Objects::isNull)) {
      throw new HomeAttachmentInvalidException(MSG_INVALID_FILE);
    }
    if (new HashSet<>(ids).size() != ids.size()) {
      throw new HomeAttachmentInvalidException(MSG_DUPLICATE);
    }
  }

  /**
   * 각 fileId 가 붙일 수 있는 파일인지 판정한다 — 호출자 업로드·ATTACHMENT·아직 임시(expires_at 있음)·미만료·홈 미연결. 임시 조건으로 다른
   * 기능에 붙어 영구가 된 파일을 거른다. 없는·남의·만료된 파일은 같은 문구로 거절해 존재를 드러내지 않는다.
   *
   * @return fileId → 후보
   */
  private Map<Long, Candidate> checkBindable(long callerId, List<Long> ids, List<Candidate> found) {
    Map<Long, Candidate> byId = found.stream().collect(Collectors.toMap(Candidate::fileId, c -> c));
    OffsetDateTime now = OffsetDateTime.now();
    for (Long id : ids) {
      Candidate c = byId.get(id);
      boolean usable =
          c != null
              && c.uploadedBy() != null
              && c.uploadedBy() == callerId
              && "ATTACHMENT".equals(c.category())
              && c.expiresAt() != null
              && c.expiresAt().isAfter(now)
              && !c.bound();
      if (!usable) throw new HomeAttachmentInvalidException(MSG_INVALID_FILE);
    }
    return byId;
  }

  /** 개수 초과 문구 — 설정값을 그대로 보여 준다. */
  String tooManyMessage() {
    return "한 번에 첨부할 수 있는 파일은 최대 " + maxPerMessage + "개예요.";
  }
}
