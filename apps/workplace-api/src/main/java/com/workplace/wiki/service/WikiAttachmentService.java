package com.workplace.wiki.service;

import com.workplace.global.util.UnicodeNames;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.exception.WikiAttachmentLimitException;
import com.workplace.wiki.exception.WikiAttachmentNotFoundException;
import com.workplace.wiki.exception.WikiAttachmentRejectedException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiAttachmentRepository;
import com.workplace.wiki.repository.WikiPageRepository;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

/** 노트 본문 이미지 첨부 — 업로드/조회/삭제와 저장 시 영구화(promote). */
@Service
@Transactional
@RequiredArgsConstructor
public class WikiAttachmentService {

  /**
   * 본문에서 첨부 참조를 찾는 패턴. {@link WikiAttachmentResponse#urlOf(long, long)} 와 짝을 이룬다 — 한쪽만 바꾸면 업로드는
   * 성공하는데 promote 가 안 돼 몇 시간 뒤 blob 이 무음으로 만료 수거된다.
   */
  // \d{1,19} — Long.MAX_VALUE 가 19자리다. 18자리로 좁히면 19자리 id 가 매칭 실패해 promote 가 조용히 스킵되고
  // 몇 시간 뒤 blob 이 만료 수거되는 무음 실패로 이어진다(리뷰 지적).
  private static final Pattern ATTACHMENT_URL =
      Pattern.compile("/api/v1/wiki/pages/(\\d{1,19})/attachments/(\\d{1,19})/content");

  private final WikiAttachmentStorage storage;
  private final WikiAttachmentRepository attachments;
  private final WikiPageRepository pages;
  private final WikiPermissions perms;

  @Value("${workplace.storage.wiki.max-image-size-bytes:10485760}")
  private long maxImageSizeBytes;

  @Value("${workplace.storage.wiki.max-per-page:50}")
  private int maxPerPage;

  /** 업로드 — EDITOR 이상. 매직바이트로 이미지 판별하고 임시 파일로 저장한다. */
  public WikiAttachmentResponse upload(long callerId, long pageId, MultipartFile file) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");

    if (file.isEmpty()) {
      throw new WikiAttachmentRejectedException("빈 파일입니다.");
    }
    if (file.getSize() > maxImageSizeBytes) {
      throw new WikiAttachmentRejectedException(
          "파일 크기가 한도를 초과했습니다: " + file.getSize() + " > " + maxImageSizeBytes);
    }

    // 브라우저 Content-Type 은 위조 가능하므로 신뢰하지 않고 앞 HEAD_BYTES 만 별도 스트림으로 읽어
    // 매직바이트로 판정한다(MultipartFile.getInputStream() 은 호출마다 새 스트림이라 본 저장 스트림을 소비하지 않음).
    byte[] head;
    try (InputStream in = file.getInputStream()) {
      head = in.readNBytes(WikiImageSniffer.HEAD_BYTES);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    String detectedMime =
        WikiImageSniffer.detect(head)
            .orElseThrow(() -> new WikiAttachmentRejectedException("지원하지 않는 이미지 형식입니다."));

    if (attachments.countByPage(pageId) >= maxPerPage) {
      throw new WikiAttachmentLimitException(pageId, maxPerPage);
    }

    Long fileId = storage.storeTemporary(file, callerId, detectedMime);
    attachments.bind(fileId, pageId, callerId);

    String originalName =
        file.getOriginalFilename() != null && !file.getOriginalFilename().isBlank()
            ? UnicodeNames.toNfc(file.getOriginalFilename())
            : "image";
    return new WikiAttachmentResponse(
        fileId,
        WikiAttachmentResponse.urlOf(pageId, fileId),
        originalName,
        detectedMime,
        file.getSize());
  }

  /** 본문 표시용 조회 — 페이지를 읽을 수 있으면(VIEWER) 이미지도 보여야 한다. */
  @Transactional(readOnly = true)
  public WikiAttachmentStorage.StoredFile download(long callerId, long pageId, long fileId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "VIEWER");
    requireBound(pageId, fileId);
    return storage.load(fileId);
  }

  /**
   * 삭제 — EDITOR 이상.
   *
   * <p>DB(매핑+file row)는 이 트랜잭션 안에서 지우지만, 디스크 바이너리는 커밋 후({@code afterCommit})에만 지운다. 트랜잭션 안에서 즉시
   * unlink 하면, 이후 같은 트랜잭션이 다른 이유로 롤백될 때 DB row 는 되살아나는데 blob 은 이미 사라져 "살아있는 첨부가 깨진 이미지를 가리키는" 상태가
   * 영구히 남는다(리뷰 지적 — Task 4 가 이 서비스를 페이지 저장 트랜잭션에 엮으면서 현실적인 시나리오가 됨).
   */
  public void delete(long callerId, long pageId, long fileId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    requireBound(pageId, fileId);
    attachments.deleteMapping(fileId);
    storage
        .deleteFileRow(fileId)
        .ifPresent(
            relativePath ->
                TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {
                      @Override
                      public void afterCommit() {
                        storage.deleteBinary(relativePath);
                      }
                    }));
  }

  /**
   * 본문에서 참조된 첨부만 영구화한다. 참조가 사라진 것은 건드리지 않는다(promote-only — expires_at 을 재설정하는 곳은 여기뿐이고, NULL 로만
   * 바꾼다. 참조가 지워졌다고 되돌리지 않는다).
   *
   * <p>호출자 계약: 이 메서드 자체는 인가를 하지 않는다 — 호출자가 pageId 에 대해 EDITOR 검증을 마친 뒤 호출해야 한다(현재
   * fileIdsOfPage(pageId) 교집합으로 다른 페이지 파일 승격은 막혀 있어 악용은 불가능하지만, 권한 체크가 없다는 사실 자체는 호출자 책임임을 명시한다).
   */
  public void promoteReferenced(long pageId, String body) {
    if (body == null || body.isBlank()) return;
    Set<Long> referenced = new LinkedHashSet<>();
    Matcher m = ATTACHMENT_URL.matcher(body);
    while (m.find()) {
      // \d{1,19} 는 19자리까지 매칭하므로 Long.MAX_VALUE 를 넘는 값(예: 19개 9)이 들어오면 parseLong 이
      // overflow 로 예외를 던진다 — 본문은 사용자가 자유롭게 편집하는 텍스트라 이런 값이 얼마든지 섞일 수 있다.
      // 저장(promoteReferenced 호출부)이 이 때문에 실패하면 안 되므로 파싱 불가 매치는 그냥 건너뛴다.
      Long pageIdInBody = tryParseLong(m.group(1));
      Long fileIdInBody = tryParseLong(m.group(2));
      if (pageIdInBody == null || fileIdInBody == null) continue;
      // 다른 페이지의 첨부 URL 이 본문에 있어도 이 페이지 소유가 아니면 승격하지 않는다.
      // longValue() 로 명시 비교 — pageIdInBody 는 Long(boxed), pageId 는 long(primitive) 이라 지금은
      // 자동 언박싱돼 값 비교가 맞지만, 이 메서드 파라미터가 나중에 Long 으로 바뀌면 == 가 조용히 참조 비교(캐시 범위
      // -128~127 밖에서 항상 false)로 변질된다(리뷰 지적). longValue() 는 그 위험을 코드 형태로 없앤다.
      if (pageIdInBody.longValue() == pageId) {
        referenced.add(fileIdInBody);
      }
    }
    if (referenced.isEmpty()) return;
    // 이 페이지에 실제로 바인딩된 파일만 승격 — 본문에 남의 fileId 를 적어 만료를 푸는 것을 막는다.
    List<Long> owned =
        attachments.fileIdsOfPage(pageId).stream().filter(referenced::contains).toList();
    attachments.promoteToPermanent(owned);
  }

  /** overflow(19자리 중 Long.MAX_VALUE 초과)면 예외 대신 null — promoteReferenced 가 그 매치만 건너뛰도록. */
  private static Long tryParseLong(String s) {
    try {
      return Long.parseLong(s);
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /** fileId 가 이 pageId 에 바인딩돼 있는지 검증. 매핑이 없거나 다른 페이지 소유면 존재를 은닉하기 위해 항상 404(403 아님). */
  private void requireBound(long pageId, long fileId) {
    Long boundPageId = attachments.findPageId(fileId).orElse(null);
    if (boundPageId == null || boundPageId != pageId) {
      throw new WikiAttachmentNotFoundException(fileId);
    }
  }
}
