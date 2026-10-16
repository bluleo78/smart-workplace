# 테스트 픽스처

공개·합성 문서만 둔다(개인 문서 금지).

| 파일 | 출처 | 라이선스 |
| --- | --- | --- |
| `sample.hwpx` | [edwardkim/rhwp](https://github.com/edwardkim/rhwp) `samples/hwpx/exam_social.hwpx` (https://github.com/edwardkim/rhwp/blob/main/samples/hwpx/exam_social.hwpx) — 원본 그대로 복사 | MIT (rhwp 저장소 라이선스) |
| `sample.doc` | 합성 — `make_office_fixtures.py` 가 python-docx 로 한글·영문 혼합 문단("AI 시대, 참가자 2,603명…")을 담은 docx 를 만들고 이미지 안 soffice 로 `.doc`(MS Word 97) 변환. 2026-10-16 1회 생성 후 커밋 | 자체 생성 |
| `sample.xls` | 합성 — `make_office_fixtures.py` 가 openpyxl 로 만든 xlsx(A1 셀 `변환 테스트`)를 이미지 안 soffice 로 `.xls`(MS Excel 97) 변환. 2026-10-16 1회 생성 후 커밋. `test_xls_to_text_contains_cell` 이 이 셀 값을 찾는다 | 자체 생성 |

`sample.doc`·`sample.xls` 가 없으면 해당 엔진 테스트는 건너뛴다(skip).

재생성(이미지 `base` 스테이지 안에서):

```bash
cd apps/workplace-converter
docker build --target base -t converter-base .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/tests/fixtures:/out" converter-base sh -c \
  'pip install -q --target /tmp/pkgs python-docx openpyxl && PYTHONPATH=/tmp/pkgs python /out/make_office_fixtures.py /out'
```
