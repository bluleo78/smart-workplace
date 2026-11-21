// 공용 FormError·FormField 가 오류를 role=alert 로 그리고 id·testid·클래스를 그대로 전하는지 본다.
// 제출·검증 실패 안내가 나타나는 순간 스크린리더가 읽게 하려는 것(WP-1901).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormError, FormField } from './form-field';

describe('FormError', () => {
  it('FormError 는 내용이 있으면 role=alert 문단으로 그린다', () => {
    render(
      <FormError id="x-error" data-testid="t" className="font-medium">
        실패했습니다
      </FormError>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('실패했습니다');
    expect(alert.id).toBe('x-error');
    expect(alert.getAttribute('data-testid')).toBe('t');
    expect(alert.className).toContain('text-sm');
    expect(alert.className).toContain('text-destructive');
    expect(alert.className).toContain('font-medium');
  });

  it.each([
    ['빈 문자열', ''],
    ['undefined', undefined],
    ['null', null],
    ['false', false],
  ])('FormError 는 내용이 비면(%s) 아무것도 그리지 않는다', (_name, value) => {
    const { container } = render(<FormError>{value}</FormError>);
    expect(container.firstChild).toBeNull();
  });
});

describe('FormField', () => {
  it('FormField 오류는 하나의 alert 로 읽힌다', () => {
    render(
      <FormField label="이름" htmlFor="n" error="필수입니다">
        <input id="n" />
      </FormField>,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('n-error');
    expect(screen.getByLabelText('이름').getAttribute('aria-describedby')).toBe('n-error');
  });
});
