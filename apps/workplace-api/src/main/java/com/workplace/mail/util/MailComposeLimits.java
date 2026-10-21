package com.workplace.mail.util;

import com.workplace.mail.exception.MailValidationException;
import java.util.ArrayList;
import java.util.List;

/**
 * 메일 작성 상한(WP-577) — 임시저장(MailDraftService)과 발송(MailComposeService, AI 확인카드 포함)이 같은 검사를 불러 「저장은 거절,
 * 발송은 통과」처럼 어긋나지 않게 한다. AI 새 메일 초안 요청(MailComposeDraftRequest)의 Bean Validation 도 같은 상수를 쓴다. 문구는 웹
 * 저장 상태 줄에 그대로 보이므로 짧게 둔다.
 *
 * <p>본문 크기 상한은 여기 두지 않는다 — 임시저장 본문은 에디터 내용만이라 2MB 로 거르지만, 발송 본문은 인용한 원본 메일이 붙어 더 클 수 있다.
 */
public final class MailComposeLimits {

  /** 받는사람·참조·숨은참조 칸마다 주소 수 상한. */
  public static final int MAX_RECIPIENTS = 100;

  /** 주소 하나의 길이 상한(RFC 5321 경로 길이 기준). */
  public static final int MAX_ADDRESS_LENGTH = 320;

  /** 제목 길이 상한. */
  public static final int MAX_SUBJECT_LENGTH = 500;

  private MailComposeLimits() {}

  /** null·공백 주소를 빼고 앞뒤 공백을 지운다. 형식은 보지 않는다(발송 때 따로 검증). */
  public static List<String> clean(List<String> addrs) {
    List<String> out = new ArrayList<>();
    if (addrs == null) {
      return out;
    }
    for (String a : addrs) {
      if (a != null && !a.isBlank()) {
        out.add(a.trim());
      }
    }
    return out;
  }

  /**
   * 받는사람 수·주소 길이·제목 길이를 거른다(정리된 목록을 받는다).
   *
   * @throws MailValidationException 상한 초과(400) — 무엇이 넘쳤는지 짧은 한국어 문구
   */
  public static void requireWithin(
      List<String> to, List<String> cc, List<String> bcc, String subject) {
    requireCount(to, "받는사람이 너무 많아요");
    requireCount(cc, "참조가 너무 많아요");
    requireCount(bcc, "숨은참조가 너무 많아요");
    for (List<String> list : List.of(to, cc, bcc)) {
      for (String a : list) {
        if (a.length() > MAX_ADDRESS_LENGTH) {
          throw new MailValidationException("주소가 너무 길어요");
        }
      }
    }
    if (subject != null && subject.length() > MAX_SUBJECT_LENGTH) {
      throw new MailValidationException("제목이 너무 길어요");
    }
  }

  private static void requireCount(List<String> addrs, String message) {
    if (addrs.size() > MAX_RECIPIENTS) {
      throw new MailValidationException(message);
    }
  }
}
