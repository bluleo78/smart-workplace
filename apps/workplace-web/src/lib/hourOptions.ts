// 정시 시각 보기 — 「00:00」 ~ 「23:00」 24개(24시간제). 보고 실행 시각처럼 서버가 「HH:00」 만 받는 곳이 함께 쓴다
// (프로젝트 보고 설정 ReportSettings·개인 보고 설정 meReportModel — 목록이 어긋나지 않게 한 곳에서 만든다).

/** 정시 「HH:00」 24개 — 0시부터 23시 순. */
export const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
