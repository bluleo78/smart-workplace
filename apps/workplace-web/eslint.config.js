import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', 'src/components/ui', 'e2e', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // 신규 권장 규칙이지만 강제는 부담 — 페이지/훅 패턴 정리 시점에 점진 해결
      'react-hooks/set-state-in-effect': 'warn',
      // 날짜/시간 표시는 공용 포매터(src/lib/formatters.ts)로만 — 화면마다 toLocale* 직접 호출이
      // 난립해 표기 불일치(#617)가 반복됐다. 문서만으로는 재발을 못 막아 린트로 강제한다(#632).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
          message:
            '날짜/시간 표시는 toLocale*String 직접 호출 대신 공용 포매터(src/lib/formatters.ts)를 사용하세요. 필요한 포맷이 없으면 포매터를 추가하세요. (docs/CODING_CONVENTION.md "날짜/시간 표시 포맷" 참조)',
        },
      ],
    },
  },
  {
    // 공용 포매터 구현부만 toLocale* 직접 호출 허용 — 규칙의 유일한 예외.
    files: ['src/lib/formatters.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // 서비스워커 — clients·registration 등 SW 전역 사용. React 규칙 무관.
  {
    files: ['src/sw.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
])
