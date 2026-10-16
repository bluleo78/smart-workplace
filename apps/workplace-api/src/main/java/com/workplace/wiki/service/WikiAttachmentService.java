package com.workplace.wiki.service;

import com.workplace.drive.service.DriveQuotaService;
import com.workplace.file.api.ImageSniffer;
import com.workplace.file.api.StagedFile;
import com.workplace.file.api.StagedFileClaimer;
import com.workplace.file.exception.StagedFileUnusableException;
import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.util.UnicodeNames;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.exception.WikiAttachmentLimitException;
import com.workplace.wiki.exception.WikiAttachmentNotFoundException;
import com.workplace.wiki.exception.WikiAttachmentRejectedException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.WikiChangeNotifier;
import com.workplace.wiki.repository.WikiAttachmentRepository;
import com.workplace.wiki.repository.WikiPageRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
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

  private static final Logger log = LoggerFactory.getLogger(WikiAttachmentService.class);

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
  // #759 (B) 테넌트 쿼터 — 드라이브 모듈의 쿼터 계산·잠금을 그대로 쓴다(chat/messaging/issue 도 drive 서비스를 직접 쓰는 선례).
  private final DriveQuotaService quota;
  // WP-64: 첨부 변경 resource.changed 발행기.
  private final WikiChangeNotifier notifier;
  // WP-358: 업로드 시 텍스트 추출 요청 발행 + 추출 텍스트 구간 읽기(공용 fileai).
  private final ApplicationEventPublisher eventPublisher;
  private final ExtractedTextService extractedText;
  // WP-424: 스테이징 파일 클레임(소유·만료·중복 바인딩 검사와 파일 잠금).
  private final StagedFileClaimer stagedFileClaimer;

  @Value("${workplace.storage.wiki.max-image-size-bytes:10485760}")
  private long maxImageSizeBytes;

  @Value("${workplace.storage.wiki.max-per-page:50}")
  private int maxPerPage;

  /**
   * #759 (A) 페이지당 매핑 총개수 하드 실링. maxPerPage(해소 가능한 상한)보다 훨씬 높다 — 정상 사용자는 닿지 않고, 강등 유예 창 안에서 "지우고 다시
   * 올리기" 를 반복하는 폭주만 막는다.
   */
  @Value("${workplace.storage.wiki.max-mappings-per-page:500}")
  private int maxMappingsPerPage;

  /** #759 참조가 빠진 첨부를 몇 시간 뒤 만료로 재무장할지. autosave·undo·페이지 간 이동이 이 창 안에서 왕복하면 원상 복구된다. */
  @Value("${workplace.storage.wiki.demote-grace-hours:168}")
  private int demoteGraceHours;

  /** 스테이징 클레임으로 묶은 임시 이미지의 수명(시) — 업로드(storeTemporary)와 같은 설정을 쓴다. */
  @Value("${workplace.storage.attachment.temp-expiry-hours:24}")
  private int tempExpiryHours;

  /** 업로드 — EDITOR 이상. 매직바이트로 이미지 판별하고 임시 파일로 저장한다. */
  public WikiAttachmentResponse upload(long callerId, long pageId, MultipartFile file) {
    var detail = pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    long spaceId = detail.spaceId();
    perms.requireRole(spaceId, callerId, "EDITOR");

    if (file.isEmpty()) {
      throw new WikiAttachmentRejectedException("빈 파일입니다.");
    }
    if (file.getSize() > maxImageSizeBytes) {
      throw new WikiAttachmentRejectedException(
          "파일 크기가 한도를 초과했습니다: " + file.getSize() + " > " + maxImageSizeBytes);
    }

    // 브라우저 Content-Type 은 위조 가능하므로 신뢰하지 않고 앞부분 매직바이트로 판정한다(별도 스트림이라 본 저장 스트림을 소비하지 않음).
    String detectedMime =
        ImageSniffer.detectUpload(file)
            .orElseThrow(() -> new WikiAttachmentRejectedException("지원하지 않는 이미지 형식입니다."));

    guardNewAttachments(pageId, detail.body(), 1, file.getSize());

    Long fileId = storage.storeTemporary(file, callerId, detectedMime);
    attachments.bind(fileId, pageId, callerId);
    // WP-358: 다른 첨부(이슈·챗·드라이브)와 같은 공용 추출 파이프라인에 태운다 — 같은 트랜잭션에서 추출 행이 생긴다.
    // 지금 업로드는 매직바이트로 이미지만 받으므로 실제로는 SKIPPED(IMAGE) 행이 되고 워커로 디스패치되지 않는다. 형식이 넓어지면
    // 그대로 PENDING → 추출로 이어진다. 임시 파일이 만료 수거되면 file_extraction 도 FK CASCADE 로 함께 지워진다.
    eventPublisher.publishEvent(
        FileExtractionRequestedEvent.of(fileId, detectedMime, ExtractionProfile.TEXT_ONLY));
    notifier.attachmentChanged(ResourceChangedEvent.OP_CREATED, spaceId, pageId, callerId);

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

  /**
   * 새 첨부 {@code count}개(합계 {@code totalBytes})를 이 페이지에 더해도 되는지 상한을 본다 — 업로드(1개)와 스테이징 클레임(WP-424,
   * 여러 개)이 같은 판정을 쓴다. 묶음으로 보므로 현재 + count 가 상한을 넘으면 거절한다(count=1 이면 "현재 >= 상한" 과 같다). 쿼터는 드라이브+노트
   * 매핑 바이트만 세므로 아직 안 묶인 새 바이트를 이 시점에 더해 본다.
   */
  private void guardNewAttachments(long pageId, String body, int count, long totalBytes) {
    guardNewAttachments(
        pageId, body, new HashSet<>(attachments.fileIdsOfPage(pageId)), count, totalBytes);
  }

  /**
   * {@link #guardNewAttachments(long, String, int, long)} — 이 페이지에 묶인 파일 id({@code bound})를 이미 읽어 둔
   * 호출자용.
   */
  private void guardNewAttachments(
      long pageId, String body, Set<Long> bound, int count, long totalBytes) {
    // #759 (A) 매핑 총개수 하드 실링 — 아래의 해소 가능한 상한과 직교한다. 참조를 지우면 아래 상한은 풀리지만
    // 매핑과 blob 은 강등 유예(demote-grace-hours)가 끝날 때까지 남으므로, 그 창 안에서의 폭주를 막을
    // 상한이 따로 필요하다. 정상 사용자는 닿지 않는 값이다.
    if (attachments.countByPage(pageId) + count > maxMappingsPerPage) {
      throw WikiAttachmentLimitException.ceiling(pageId, maxMappingsPerPage);
    }

    // 상한은 "이 페이지가 실제로 붙잡고 있는 첨부" 를 센다 — 저장된 본문에 아직 참조가 남아 있는 것과,
    // 아직 임시라 본문에 실릴 기회조차 없었던 것의 합집합이다. 단순 countByPage 는 본문에서 지운 뒤에도
    // 매핑이 남아 카운트가 줄지 않아 사용자가 풀 방법이 없는 409 를 만든다(#757).
    // 두 집합은 겹칠 수 있으므로 반드시 합집합 — 더하면 이중 계산된다.
    // "본문" 은 저장된 본문이라 autosave 디바운스(800ms) 창에서 일시적으로 과다 계산될 수 있으나
    // 저장되면 자연 해소된다.
    // 강등된 첨부(demoted_at NOT NULL)는 tempFileIdsOfPage 가 제외하므로 여기 안 잡힌다 — #757 이 만든
    // "본문에서 지우고 저장하면 다시 올릴 수 있다" 를 만료 재무장이 되돌리지 않게 하는 지점이다(V127).
    Set<Long> held = new HashSet<>(referencedFileIds(pageId, body));
    held.retainAll(bound);
    held.addAll(attachments.tempFileIdsOfPage(pageId));
    if (held.size() + count > maxPerPage) {
      throw WikiAttachmentLimitException.resolvable(pageId, maxPerPage);
    }

    // #759 (B) 테넌트 쿼터 — 위키 첨부도 이제 집계에 포함된다. 드라이브 업로드와 같은 advisory lock 을
    // 공유해야 한다(다른 클래스를 쓰면 위키·드라이브 업로드가 같은 한도를 나란히 통과한다) — 락+검사가
    // 한 메서드로 묶여 있어 순서를 조립할 여지가 없다.
    quota.assertWithinQuotaLocked(totalBytes);
  }

  /**
   * 먼저 올려 둔 스테이징 이미지(WP-421)를 이 페이지의 첨부로 가져온다(WP-424) — EDITOR 이상. 외부 MCP 가 파일을 올려 두고 노트 본문에 넣는
   * 경로다.
   *
   * <p>순서: ① 이미 이 페이지에 묶인 id 는 호출자가 올린 것이면 성공으로 건너뛰고(재시도 멱등 — 응답을 못 받고 다시 보내도 안전) 남이 올린 것이면 거절한다.
   * 클레임은 어느 도메인에든 묶인 파일을 거절하므로 이 구분을 먼저 해야 한다. ② 나머지를 KEEP_TEMPORARY 로 클레임 — 노트는 본문 참조로 수명을 관리하므로
   * 만료를 그대로 둔다. ③ 파일마다 크기·이미지 여부(매직바이트)를 모두 확인한 뒤 ④ 상한({@link #guardNewAttachments})을 보고 ⑤ MIME 을
   * 판정값으로 고치고 만료를 새로 세워 정션에 묶는다. ⑤는 클레임과 같은 트랜잭션이라 동시 클레임이 정션 행을 보고 거절된다. 묶인 파일은 임시로 남고 본문 저장의
   * {@link #syncReferences} 가 참조된 것만 영구화한다 — 참조하지 않으면 만료로 지워진다.
   *
   * @return 입력 순서대로의 응답. url 은 본문에 쓸 정본 경로
   * @throws com.workplace.file.exception.StagedFileUnusableException 남의 파일·만료·이미 다른 곳에 묶인 파일 등(400)
   */
  public List<WikiAttachmentResponse> claimStaged(long callerId, long pageId, List<Long> fileIds) {
    var detail = pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    long spaceId = detail.spaceId();
    perms.requireRole(spaceId, callerId, "EDITOR");

    Set<Long> onPage = new HashSet<>(attachments.fileIdsOfPage(pageId));
    List<Long> retried = new ArrayList<>();
    List<Long> toClaim = new ArrayList<>();
    for (Long id : fileIds) {
      if (id != null && onPage.contains(id)) {
        retried.add(id);
      } else {
        toClaim.add(id);
      }
    }

    // 입력 id → 응답. 이미 묶여 있던 파일(재시도)과 새로 묶은 파일을 같은 모양으로 모아 입력 순서로 돌려준다.
    Map<Long, WikiAttachmentResponse> byId = new HashMap<>();
    Map<Long, WikiAttachmentRepository.FileMeta> already = attachments.metaOf(retried);
    for (Long id : retried) {
      var meta = already.get(id);
      if (meta == null || meta.uploadedBy() == null || meta.uploadedBy() != callerId) {
        throw new StagedFileUnusableException(id);
      }
      byId.put(
          id,
          claimResponse(
              pageId, meta.fileId(), meta.originalName(), meta.mimeType(), meta.sizeBytes()));
    }

    if (!toClaim.isEmpty()) {
      List<StagedFile> staged =
          stagedFileClaimer.claim(callerId, toClaim, StagedFileClaimer.Retention.KEEP_TEMPORARY);
      long totalBytes = 0;
      Map<Long, String> sniffed = new HashMap<>();
      for (StagedFile f : staged) {
        if (f.sizeBytes() > maxImageSizeBytes) {
          throw new WikiAttachmentRejectedException(
              "파일 크기가 한도를 초과했습니다: " + f.sizeBytes() + " > " + maxImageSizeBytes);
        }
        byte[] head = storage.readHead(f.fileId(), f.storagePath(), ImageSniffer.HEAD_BYTES);
        sniffed.put(
            f.fileId(),
            ImageSniffer.detect(head)
                .orElseThrow(
                    () ->
                        new WikiAttachmentRejectedException(
                            "이미지 파일(PNG·JPEG·GIF·WebP)만 노트에 넣을 수 있습니다: " + f.originalName())));
        totalBytes += f.sizeBytes();
      }
      // 이 페이지에 묶인 파일은 위에서 읽은 그대로다(새 파일은 아래에서야 묶는다) — 다시 조회하지 않는다.
      guardNewAttachments(pageId, detail.body(), onPage, staged.size(), totalBytes);

      OffsetDateTime expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plusHours(tempExpiryHours);
      for (StagedFile f : staged) {
        String mime = sniffed.get(f.fileId());
        attachments.updateMimeAndExpiry(f.fileId(), mime, expiresAt);
        attachments.bind(f.fileId(), pageId, callerId);
        // 업로드와 같이 바인딩한 쪽이 공용 추출 파이프라인에 태운다(클레임은 추출 이벤트를 내지 않는다).
        eventPublisher.publishEvent(
            FileExtractionRequestedEvent.of(f.fileId(), mime, ExtractionProfile.TEXT_ONLY));
        byId.put(
            f.fileId(),
            claimResponse(
                pageId, f.fileId(), UnicodeNames.toNfc(f.originalName()), mime, f.sizeBytes()));
      }
      notifier.attachmentChanged(ResourceChangedEvent.OP_CREATED, spaceId, pageId, callerId);
    }

    return fileIds.stream().map(byId::get).toList();
  }

  /** 클레임 응답 한 건 — url 은 본문에 쓸 정본 경로. 새로 묶은 파일과 이미 묶여 있던 파일(재시도)이 같은 모양으로 돌려준다. */
  private static WikiAttachmentResponse claimResponse(
      long pageId, long fileId, String name, String mimeType, long sizeBytes) {
    return new WikiAttachmentResponse(
        fileId, WikiAttachmentResponse.urlOf(pageId, fileId), name, mimeType, sizeBytes);
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
   * 첨부 추출 텍스트 구간 읽기(WP-358). 권한·소속 판정은 {@link #download} 와 같다 — 공간 VIEWER 이상(비멤버는 공간 존재 은닉 404), 이
   * 페이지에 바인딩되지 않은 fileId·없는 fileId 는 404. 상태·사유·자르기는 fileai 공용 서비스가 맡는다.
   */
  @Transactional(readOnly = true)
  public ExtractedTextSlice readText(
      long callerId, long pageId, long fileId, int offset, int limit) {
    // 권한 규칙은 resolveViewFileId 한 곳에 — /text 와 /view 가 같은 가드를 쓴다(같은 readOnly 트랜잭션 안에서 실행).
    return extractedText.read(resolveViewFileId(callerId, pageId, fileId), offset, limit);
  }

  /**
   * 이미지 보기용 파일 id 확인(WP-250, R5) — {@link #readText} 와 같은 가드(공간 VIEWER 이상 + 이 페이지에 바인딩된 첨부)를 거쳐
   * core file.id 만 돌려준다.
   */
  @Transactional(readOnly = true)
  public long resolveViewFileId(long callerId, long pageId, long fileId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "VIEWER");
    requireBound(pageId, fileId);
    return fileId;
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
    notifier.attachmentChanged(ResourceChangedEvent.OP_DELETED, spaceId, pageId, callerId);
    storage
        .deleteFileRow(fileId)
        .ifPresent(
            paths ->
                TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {
                      @Override
                      public void afterCommit() {
                        storage.deleteBinary(paths);
                      }
                    }));
  }

  /**
   * 페이지 서브트리의 첨부를 전부 회수한다 — 페이지 삭제 직전에 호출한다.
   *
   * <p>호출자 계약: 인가를 하지 않는다. 호출자가 pageId 에 대해 EDITOR 검증을 마친 뒤 호출해야 한다.
   *
   * <p>demote 가 아니다 — 페이지 자체가 사라지므로 어떤 본문도 이 파일들을 참조할 수 없다. delete(...) 와 동일하게 DB(file 행)는 이 트랜잭션
   * 안에서 지우고 디스크 unlink 는 커밋 후에만 수행한다 — 트랜잭션이 롤백되면 file 행은 되살아나야 하는데 blob 을 먼저 지워버리면 "살아있는 첨부가 사라진
   * blob 을 가리키는" 상태가 영구히 남는다.
   */
  public void reclaimPageTree(long rootPageId) {
    var attached = attachments.attachedFilesOfPageTree(rootPageId);
    if (attached.isEmpty()) return;
    List<Long> fileIds =
        attached.stream().map(WikiAttachmentRepository.AttachedFile::fileId).toList();
    int deleted = attachments.deleteFileRows(fileIds);
    // deleteFileRows 는 동작을 바꾸지 않고(unlink 등록은 여전히 조회된 모든 경로에 대해 무조건 수행) 실제
    // 삭제 건수만 대조해 로그를 남긴다 — 건수가 어긋나면 "살아있는 file 행인데 blob 은 이미 사라진" 상태(이
    // 클래스 전체가 막으려는 것의 정확한 역상)가 만들어졌다는 신호이기 때문이다. 같은 커넥션·같은 RLS GUC
    // 라 정상적으로는 발산하지 않아야 한다.
    if (deleted != fileIds.size()) {
      log.warn(
          "reclaimPageTree: 삭제 대상 file 행 수({})와 실제 삭제된 행 수({})가 다릅니다. rootPageId={}",
          fileIds.size(),
          deleted,
          rootPageId);
    }
    // 원본뿐 아니라 썸네일·이미지 보기 캐시(WP-250)도 커밋 후 함께 지운다.
    List<WikiAttachmentStorage.StoredPaths> paths =
        attached.stream()
            .map(a -> new WikiAttachmentStorage.StoredPaths(a.storagePath(), a.thumbnailPath()))
            .toList();
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCommit() {
            paths.forEach(storage::deleteBinary);
          }
        });
  }

  /**
   * 저장된 본문과 첨부 상태를 동기화한다 — 참조된 것은 승격(만료 해제), 참조가 빠진 것은 <b>강등(만료 재무장)</b>.
   *
   * <p>#759 이전에는 promote-only 였고, 그래서 승격된 blob 은 페이지를 지우기 전까지 영원히 남았다(스토리지 무제한 증가). 참조 해제 시 <b>즉시
   * 삭제</b>는 #751 에서 기각됐는데 — autosave 디바운스 중간 상태·undo·잘라내기 붙여넣기에서 실데이터가 사라지기 때문 — 기각의 근거는 "판정이 틀렸다"
   * 가 아니라 "되돌릴 수 없다" 였다. 그래서 판정과 삭제를 분리해, 강등은 {@code file.expires_at} 을 유예 후로 다시 세우기만 하고 실제 삭제는 기존
   * {@code FileCleanupService} 스윕에 맡긴다. 유예 안에 참조가 돌아오면 승격 경로가 원상 복구한다.
   *
   * <p>호출자 계약: 이 메서드 자체는 인가를 하지 않는다 — 호출자가 pageId 에 대해 EDITOR 검증을 마친 뒤 호출해야
   * 한다(fileIdsOfPage(pageId) 교집합이라 다른 페이지 파일에는 손대지 않지만, 권한 체크가 없다는 사실 자체는 호출자 책임임을 명시한다).
   */
  public void syncReferences(long pageId, String body) {
    Set<Long> referenced = referencedFileIds(pageId, body);
    List<Long> bound = attachments.fileIdsOfPage(pageId);
    // 이 페이지에 실제로 바인딩된 파일만 승격 — 본문에 남의 fileId 를 적어 만료를 푸는 것을 막는다.
    attachments.promoteToPermanent(bound.stream().filter(referenced::contains).toList());
    // 참조가 빠진 것 = 강등 후보. 아직 승격된 적 없는 임시 파일은 repository 가 걸러낸다(만료가 늘어나면 안 된다).
    attachments.demote(
        bound.stream().filter(id -> !referenced.contains(id)).toList(),
        OffsetDateTime.now(ZoneOffset.UTC).plusHours(demoteGraceHours));
  }

  /**
   * 본문 텍스트에서 이 pageId 소유로 표기된 첨부 URL 을 파싱해 fileId 집합으로 반환한다. {@link #syncReferences} 와 업로드 상한
   * 계산(#757) 이 공유한다 — 정규식을 두 곳에 복제하면 {@link WikiAttachmentResponse#urlOf(long, long)} 와의 계약 드리프트
   * 지점이 하나 더 생긴다.
   */
  private Set<Long> referencedFileIds(long pageId, String body) {
    Set<Long> referenced = new LinkedHashSet<>();
    if (body == null || body.isBlank()) return referenced;
    Matcher m = ATTACHMENT_URL.matcher(body);
    while (m.find()) {
      // \d{1,19} 는 19자리까지 매칭하므로 Long.MAX_VALUE 를 넘는 값(예: 19개 9)이 들어오면 parseLong 이
      // overflow 로 예외를 던진다 — 본문은 사용자가 자유롭게 편집하는 텍스트라 이런 값이 얼마든지 섞일 수 있다.
      // 저장(syncReferences 호출부)이 이 때문에 실패하면 안 되므로 파싱 불가 매치는 그냥 건너뛴다.
      Long pageIdInBody = tryParseLong(m.group(1));
      Long fileIdInBody = tryParseLong(m.group(2));
      if (pageIdInBody == null || fileIdInBody == null) continue;
      // 다른 페이지의 첨부 URL 이 본문에 있어도 이 페이지 소유가 아니면 대상에 넣지 않는다.
      // longValue() 로 명시 비교 — pageIdInBody 는 Long(boxed), pageId 는 long(primitive) 이라 지금은
      // 자동 언박싱돼 값 비교가 맞지만, 이 메서드 파라미터가 나중에 Long 으로 바뀌면 == 가 조용히 참조 비교(캐시 범위
      // -128~127 밖에서 항상 false)로 변질된다(리뷰 지적). longValue() 는 그 위험을 코드 형태로 없앤다.
      if (pageIdInBody.longValue() == pageId) {
        referenced.add(fileIdInBody);
      }
    }
    return referenced;
  }

  /** overflow(19자리 중 Long.MAX_VALUE 초과)면 예외 대신 null — syncReferences 가 그 매치만 건너뛰도록. */
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
