package com.workplace.mail.util;

import com.workplace.mail.repository.EmailMessageRepository;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 메일 분류 결정적 보정(WP-1340·1342) — LLM 이 낸 분류 뒤에 공유 분류 저장 경로(③ 원본 분석·분류 일괄·④ 보충)가 같은 규칙을 적용한다. ④ 개인 비서
 * 분류는 광고 규칙만 적용한다({@link #adjustForPersonal}).
 *
 * <p>모델 입력에도 같은 신호(사내 구성원·자동 발송)를 넣지만 모델은 틀릴 수 있어 이 보정이 최종 보증이다. 사용자가 직접 바꾼 분류에는 적용하지 않는다.
 *
 * <ol>
 *   <li>제목이 「(광고)」·「[광고]」로 시작하면(정보통신망법상 광고 표기 — 객관 신호라 공유 분류에 써도 안전) 프로모션·뉴스레터가 아닌 결과(빈 값 포함)를
 *       프로모션으로 바꾼다. 뉴스레터는 그대로 둔다(기대 동작이 「프로모션 또는 뉴스레터」).
 *   <li>그렇지 않고 보낸 사람이 사내 구성원이면 뉴스레터·프로모션을 업무로 바꾼다(정기 공유·브리프가 구독 소식으로 묻히지 않게). 알림·개인은 그대로다.
 * </ol>
 *
 * 광고 규칙이 먼저다 — 사내 구성원이 보낸 광고 메일도 광고다.
 */
public final class MailCategoryRules {

  /** 업무 분류 — 값은 저장소 상수 하나만 둔다. */
  static final String WORK = EmailMessageRepository.WORK_CATEGORY;

  static final String PROMOTION = "프로모션";

  static final String NEWSLETTER = "뉴스레터";

  /** 광고 표기 제목 — 앞 공백·괄호 안 공백 허용. V266 마이그레이션의 SQL 정규식과 같은 규칙이다. */
  static final Pattern AD_SUBJECT = Pattern.compile("^\\s*[(\\[]\\s*광고\\s*[)\\]]");

  /**
   * 허용 분류 5종(EmailMessageRepository.CATEGORIES — 웹 MAIL_CATEGORIES 와 같은 값). 모델이 낸 그 밖의 이름은 null 로
   * 버린다.
   */
  private static final Set<String> CATEGORIES = Set.copyOf(EmailMessageRepository.CATEGORIES);

  private MailCategoryRules() {}

  /**
   * 모델이 낸 원시 분류 → 공유 원본에 저장할 최종 분류(WP-1346). 허용 5종만 남기고(그 밖은 null) {@link #adjust} 보정을 거친다. 공유 분류를
   * 저장하는 네 경로(③ 원본 분석·강제 요약의 분류 보충·④ 보충·분류 일괄)가 이 하나만 부른다.
   *
   * @param rawCategory 모델 응답의 분류(미지 값·null 허용)
   * @param subject 메일 제목(null 허용)
   * @param senderIsMember 보낸 사람이 사내 구성원인지
   */
  public static String sharedCategory(String rawCategory, String subject, boolean senderIsMember) {
    return adjust(valid(rawCategory), subject, senderIsMember);
  }

  /** 모델이 낸 원시 개인 비서 분류 → 사본에 저장할 최종 분류 — 허용 5종 검증 뒤 광고 규칙만({@link #adjustForPersonal}). */
  public static String personalCategory(String rawCategory, String subject) {
    return adjustForPersonal(valid(rawCategory), subject);
  }

  /** 허용 5종만(미지 값·null → null). Set.copyOf 는 contains(null) 에서 NPE 를 던지므로 null 을 먼저 거른다. */
  public static String valid(String category) {
    return category != null && CATEGORIES.contains(category) ? category : null;
  }

  /**
   * 분류 결과를 보정한다.
   *
   * @param category 검증된 분류(허용 5종 또는 null)
   * @param subject 메일 제목(null 허용)
   * @param senderIsMember 보낸 사람이 이 워크스페이스 사내 구성원인지(MailPeopleRepository.findMemberAddresses 기준)
   * @return 보정한 분류(규칙에 걸리지 않으면 입력 그대로 — null 이면 null)
   */
  public static String adjust(String category, String subject, boolean senderIsMember) {
    if (isAd(subject)) {
      return adjustForPersonal(category, subject); // 광고 규칙 — 개인 비서 분류와 같은 1번 규칙
    }
    if (senderIsMember && (PROMOTION.equals(category) || NEWSLETTER.equals(category))) {
      return WORK;
    }
    return category;
  }

  /**
   * 개인 비서 분류(④, WP-1341) 보정 — 광고 규칙(1)만 적용한다.
   *
   * <p>사내 구성원 규칙(2)은 쓰지 않는다. 개인 비서 분류는 사용자가 학습시킨 메일 기억(예: 사내 주간 소식은 뉴스레터로)을 반영한 결과라, 구성원 규칙으로 업무로
   * 되돌리면 학습이 무의미해진다. 광고 표기는 법정 객관 신호라 개인 분류에도 그대로 쓴다.
   *
   * @param category 검증된 분류(허용 5종 또는 null)
   * @param subject 메일 제목(null 허용)
   * @return 보정한 분류(광고 제목이 아니면 입력 그대로)
   */
  public static String adjustForPersonal(String category, String subject) {
    if (isAd(subject)) {
      return PROMOTION.equals(category) || NEWSLETTER.equals(category) ? category : PROMOTION;
    }
    return category;
  }

  /** 제목이 광고 표기로 시작하는지. */
  public static boolean isAd(String subject) {
    return subject != null && AD_SUBJECT.matcher(subject).find();
  }
}
