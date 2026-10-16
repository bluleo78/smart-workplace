package com.workplace.mail.service;

import com.workplace.file.service.MimeNormalizer;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.ContentAttachmentRepository.ExtractTarget;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 메일 첨부 텍스트(/text, WP-358)·보기(/view, WP-388)가 원본을 받기 전에 같이 하는 일 — 소유 확인(아니면 404), 판정용 mime,
 * manifest 의 추출 사본 링크·크기 — 을 한 곳에 둔다. 두 경로의 404·mime 보정·사전 크기 판정이 어긋나지 않게 하려는 것이다.
 *
 * <p>트랜잭션은 호출자가 연다(RLS GUC — 없으면 소유 조회가 빈 결과로 거짓 404).
 */
@Component
@RequiredArgsConstructor
class MailAttachmentResolver {

  private final EmailAttachmentRepository attachmentRepo;
  private final ContentAttachmentRepository contentAttachmentRepo;

  /**
   * 소유를 확인한 첨부.
   *
   * @param ctx 다운로드 컨텍스트 — 그대로 {@link MailAttachmentService#download(long,
   *     AttachmentDownloadContext)} 에 넘겨 소유 조회를 되풀이하지 않는다
   * @param mime 파일명으로 보정한 판정용 mime
   * @param target manifest 의 추출 사본 링크·크기 — manifest 없는 레거시 행(V100 이전 동기화)이거나 행이 없으면 null
   */
  record Resolved(AttachmentDownloadContext ctx, String mime, ExtractTarget target) {

    /** 원본을 받기 전 크기 판정 — {@link #exceedsBeforeFetch} 참조. 크기를 모르면 false(받은 뒤 판정). */
    boolean exceedsBeforeFetch(long maxBytes) {
      return target != null
          && MailAttachmentResolver.exceedsBeforeFetch(
              target.sizeBytes(), "M365_GRAPH".equals(ctx.provider()), maxBytes);
    }
  }

  /**
   * 본인 소유(활성 계정) 첨부를 찾는다. 없거나 타인 소유면 404(존재 은닉).
   *
   * @throws EmailAttachmentNotFoundException 없거나 타인 소유일 때
   */
  Resolved resolve(long userId, long attachmentId) {
    AttachmentDownloadContext ctx =
        attachmentRepo
            .findContextForDownload(userId, attachmentId)
            .orElseThrow(() -> new EmailAttachmentNotFoundException(attachmentId));
    ExtractTarget target =
        ctx.contentAttachmentId() == 0L
            ? null
            : contentAttachmentRepo.findExtractTarget(ctx.contentAttachmentId()).orElse(null);
    return new Resolved(ctx, normalizeMime(ctx.filename(), ctx.contentType()), target);
  }

  /**
   * 원본을 받기 전에 크기만으로 상한 초과를 판정한다(provider 왕복을 아끼려는 사전 차단 — 정확한 판정은 받은 바이트로 한다).
   *
   * <p>IMAP 의 size_bytes 는 전송 인코딩(base64) 기준이라 실제보다 약 4/3 크다 — 그만큼 여유를 둬 실제로는 상한 안인 첨부를 막지 않는다.
   * Graph 의 size 는 실제 바이트라 상한 그대로 본다.
   *
   * @param sizeBytes manifest 크기(모르면 null → 판정하지 않음)
   * @param graph M365 Graph 계정인지
   * @param maxBytes 실제 바이트 상한
   */
  static boolean exceedsBeforeFetch(Long sizeBytes, boolean graph, long maxBytes) {
    if (sizeBytes == null) return false;
    long limit = graph ? maxBytes : maxBytes / 3 * 4 + 4096;
    return sizeBytes > limit;
  }

  /**
   * 메일 파트 Content-Type 을 판정용 mime 으로 정규화한다. 파라미터(; name=…)를 떼고 소문자로 맞춘 뒤, 비었거나 octet-stream 이면 파일명
   * 확장자로 보정한다(이슈·챗 업로드와 같은 MimeNormalizer). 추출 대상 판정(ExtractableTypes)은 정확 일치라 이 정규화가 없으면 PDF 가
   * SKIPPED 로 굳고, 보기는 HEIC·PDF 를 형식 미지원으로 거절한다.
   */
  static String normalizeMime(String filename, String contentType) {
    // 기본형이 빈 값(Content-Type 없음)이면 normalize 가 null 과 같이 확장자로 보정한다.
    return MimeNormalizer.normalize(filename, MimeNormalizer.baseMime(contentType));
  }
}
