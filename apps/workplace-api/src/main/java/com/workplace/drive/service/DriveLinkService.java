package com.workplace.drive.service;

import com.workplace.drive.api.AttachmentSourceProvider;
import com.workplace.drive.api.DriveLinkSourceResolver;
import com.workplace.drive.dto.BacklinkResponse;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.drive.dto.VirtualAttachmentPage;
import com.workplace.drive.dto.VirtualAttachmentResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.repository.DriveFileRefRepository;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.file.service.FileUploadService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 교차링크 오케스트레이션. 컨텍스트(이슈/채널) 멤버십은 호출 도메인이 검사하고, 여기서는 파일 측 권한(≥VIEWER)·ref 영속·콘텐츠 서빙만 책임진다. Task
 * 10: backlinks, virtualAttachments, importAttachment 추가.
 */
@Service
@Transactional
public class DriveLinkService {

  private final DriveFileRefRepository refRepo;
  private final DriveFileRepository fileRepo;
  private final DrivePermissions perms;
  private final FileUploadService fileUpload;

  /** sourceType → resolver 인덱스 (백링크 해석용). */
  private final Map<String, DriveLinkSourceResolver> resolvers;

  /** sourceType → provider 인덱스 (가상 첨부·import 인가용). */
  private final Map<String, AttachmentSourceProvider> providers;

  public DriveLinkService(
      DriveFileRefRepository refRepo,
      DriveFileRepository fileRepo,
      DrivePermissions perms,
      FileUploadService fileUpload,
      List<DriveLinkSourceResolver> resolverList,
      List<AttachmentSourceProvider> providerList) {
    this.refRepo = refRepo;
    this.fileRepo = fileRepo;
    this.perms = perms;
    this.fileUpload = fileUpload;
    this.resolvers =
        resolverList.stream()
            .collect(Collectors.toMap(DriveLinkSourceResolver::sourceType, Function.identity()));
    this.providers =
        providerList.stream()
            .collect(Collectors.toMap(AttachmentSourceProvider::sourceType, Function.identity()));
  }

  /** 링크 생성: 요청자가 파일에 ≥VIEWER 여야 함. 중복은 무시(멱등). */
  public void createLink(long callerId, long driveFileId, String sourceType, long sourceId) {
    var meta =
        fileRepo
            .findLinkMeta(driveFileId)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(meta.spaceId(), callerId, "VIEWER");
    refRepo.insertIgnore(driveFileId, sourceType, sourceId, callerId);
  }

  /** 링크 제거: 생성자 본인이거나 컨텍스트 관리권(callerCanManageContext)일 때만. */
  public void removeLink(
      long callerId,
      long driveFileId,
      String sourceType,
      long sourceId,
      boolean callerCanManageContext) {
    var creator = refRepo.findCreatedBy(driveFileId, sourceType, sourceId);
    if (creator.isEmpty()) {
      return; // 이미 없음 — 멱등
    }
    boolean isCreator = creator.get() == callerId;
    if (!isCreator && !callerCanManageContext) {
      throw new DriveForbiddenException("링크를 제거할 권한이 없습니다");
    }
    refRepo.delete(driveFileId, sourceType, sourceId);
  }

  /** 소스(이슈/메시지)에 걸린 링크 목록 + 가용성(ACTIVE|TRASHED). */
  @Transactional(readOnly = true)
  public List<DriveLinkResponse> listLinks(String sourceType, long sourceId) {
    List<DriveLinkResponse> out = new ArrayList<>();
    for (var ref : refRepo.findBySource(sourceType, sourceId)) {
      var metaOpt = fileRepo.findLinkMeta(ref.driveFileId());
      if (metaOpt.isEmpty()) {
        // drive_file 삭제됨(CASCADE 전 레이스) — 방어적 스킵
        continue;
      }
      var m = metaOpt.get();
      out.add(
          new DriveLinkResponse(
              m.driveFileId(),
              m.fileId(),
              m.name(),
              m.mimeType(),
              m.sizeBytes(),
              m.hasThumbnail(),
              m.spaceId(),
              m.spaceName(),
              m.trashed() ? "TRASHED" : "ACTIVE",
              ref.createdBy(),
              ref.createdAt().toInstant()));
    }
    return out;
  }

  /**
   * 여러 소스에 연결된 드라이브 링크를 배치 조회(N+1 방지). sourceId → DriveLinkResponse 목록 맵 반환. ref 배치 조회 후 drive_file
   * 메타는 개별 조회(드라이브 파일 수가 ref 수보다 적을 수 있어 중복 제거 효과는 제한적 — 추가 최적화는 별도 epic).
   */
  @Transactional(readOnly = true)
  public Map<Long, List<DriveLinkResponse>> listLinksBatch(
      String sourceType, List<Long> sourceIds) {
    if (sourceIds.isEmpty()) return Map.of();
    var refsBySource = refRepo.findBySourceIds(sourceType, sourceIds);
    Map<Long, List<DriveLinkResponse>> result = new HashMap<>();
    for (var entry : refsBySource.entrySet()) {
      long sid = entry.getKey();
      List<DriveLinkResponse> links = new ArrayList<>();
      for (var ref : entry.getValue()) {
        var metaOpt = fileRepo.findLinkMeta(ref.driveFileId());
        if (metaOpt.isEmpty()) continue; // drive_file 삭제됨 — 방어적 스킵
        var m = metaOpt.get();
        links.add(
            new DriveLinkResponse(
                m.driveFileId(),
                m.fileId(),
                m.name(),
                m.mimeType(),
                m.sizeBytes(),
                m.hasThumbnail(),
                m.spaceId(),
                m.spaceName(),
                m.trashed() ? "TRASHED" : "ACTIVE",
                ref.createdBy(),
                ref.createdAt().toInstant()));
      }
      result.put(sid, links);
    }
    return result;
  }

  /** 링크된 파일 바이트. ref 존재(=이 소스에 실제 링크됨)를 검증해 임의 파일 접근 차단. */
  @Transactional(readOnly = true)
  public FileUploadService.FileContentResult getLinkContent(
      String sourceType, long sourceId, long driveFileId) throws java.io.IOException {
    if (!refRepo.linkExists(driveFileId, sourceType, sourceId)) {
      throw new DriveFileNotFoundException(driveFileId);
    }
    var meta =
        fileRepo
            .findLinkMeta(driveFileId)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    return fileUpload.getFileContentTrusted(meta.fileId());
  }

  /** 소스 삭제 시 모든 ref 정리. */
  public void purgeSource(String sourceType, long sourceId) {
    refRepo.deleteAllForSource(sourceType, sourceId);
  }

  /** 여러 소스 삭제 시 ref 배치 정리 (N+1 방지). 빈 리스트 입력 시 no-op. */
  public void purgeSources(String sourceType, List<Long> sourceIds) {
    refRepo.deleteAllForSources(sourceType, sourceIds);
  }

  /** 백링크 조회: 파일에 연결된 소스(이슈/메시지)를 해석하여 접근 가능한 것만 반환. 파일에 ≥VIEWER 권한 필요. */
  @Transactional(readOnly = true)
  public List<BacklinkResponse> backlinks(long callerId, long driveFileId) {
    var meta =
        fileRepo
            .findLinkMeta(driveFileId)
            .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
    perms.requireRole(meta.spaceId(), callerId, "VIEWER");

    // sourceType 별로 묶어 resolver 에 배치 조회
    Map<String, List<Long>> byType = new HashMap<>();
    for (var ref : refRepo.findByFile(driveFileId)) {
      byType.computeIfAbsent(ref.sourceType(), k -> new ArrayList<>()).add(ref.sourceId());
    }
    List<BacklinkResponse> out = new ArrayList<>();
    for (var entry : byType.entrySet()) {
      DriveLinkSourceResolver resolver = resolvers.get(entry.getKey());
      if (resolver == null) continue;
      var resolved = resolver.resolve(callerId, entry.getValue());
      for (var e : resolved.entrySet()) {
        if (!e.getValue().accessible()) continue; // 접근 불가 소스 숨김
        out.add(
            new BacklinkResponse(
                entry.getKey(), e.getKey(), e.getValue().label(), e.getValue().deepLink()));
      }
    }
    return out;
  }

  /**
   * 가상 첨부 뷰: caller 가 접근 가능한 이슈/메시지의 첨부를 attachedAt DESC 로 병합해 커서 페이지네이션 반환.
   *
   * @param source "ALL"|"ISSUE"|"MESSAGE"
   * @param cursor ISO-8601 Instant 문자열(null=최신부터)
   */
  @Transactional(readOnly = true)
  public VirtualAttachmentPage virtualAttachments(
      long callerId, String source, String q, String cursor, int limit) {
    // limit 방어: 0 이하는 1 로, 100 초과는 100 으로 클램프
    int safeLimit = Math.max(1, Math.min(limit, 100));
    Instant beforeAt = cursor != null ? Instant.parse(cursor) : null;

    // 선택된 provider 목록
    List<AttachmentSourceProvider> selected;
    if ("ALL".equalsIgnoreCase(source)) {
      selected = new ArrayList<>(providers.values());
    } else {
      AttachmentSourceProvider p = providers.get(source.toUpperCase());
      selected = p != null ? List.of(p) : List.of();
    }

    // 각 provider 에서 limit 개(내부에서 +1 이미 처리됨) 수집 후 VirtualAttachmentResponse 로 변환
    List<VirtualAttachmentResponse> merged = new ArrayList<>();
    for (var provider : selected) {
      String sourceType = provider.sourceType();
      for (var entry : provider.list(callerId, q, beforeAt, safeLimit)) {
        merged.add(
            new VirtualAttachmentResponse(
                entry.fileId(),
                entry.name(),
                entry.mimeType(),
                entry.sizeBytes(),
                entry.hasThumbnail(),
                sourceType,
                entry.sourceLabel(),
                entry.deepLink(),
                entry.downloadUrl(),
                entry.attachedAt()));
      }
    }

    // attachedAt DESC 정렬
    merged.sort(Comparator.comparing(VirtualAttachmentResponse::attachedAt).reversed());

    // 다음 페이지 커서 계산: merged > limit 이면 더 있음
    String nextCursor = null;
    if (merged.size() > safeLimit) {
      nextCursor = merged.get(safeLimit - 1).attachedAt().toString();
    }
    List<VirtualAttachmentResponse> items =
        merged.stream().limit(safeLimit).collect(Collectors.toList());
    return new VirtualAttachmentPage(items, nextCursor);
  }

  /** 첨부 import: 스페이스 EDITOR + 원본 첨부 접근 권한 확인 후, 동일 file.id 를 가리키는 drive_file 생성 + 영구화. */
  public DriveFileResponse importAttachment(
      long callerId, long spaceId, Long folderId, long fileId) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // provider 중 하나라도 fileId 에 접근 가능해야 함
    boolean accessible =
        providers.values().stream().anyMatch(p -> p.canAccessFile(callerId, fileId));
    if (!accessible) {
      throw new DriveForbiddenException("첨부에 접근할 수 없습니다");
    }
    // 동일 file.id 로 drive_file 생성(바이트 공유, 복사 없음)
    String name = fileRepo.findFileOriginalName(fileId);
    long driveFileId = fileRepo.insert(spaceId, folderId, fileId, name);
    fileRepo.promoteFile(fileId); // expires_at = NULL(영구화)
    return fileRepo
        .findResponse(driveFileId)
        .orElseThrow(() -> new DriveFileNotFoundException(driveFileId));
  }
}
