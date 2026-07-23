import { renderEmailVerificationTemplate, renderPasswordResetTemplate } from './mail.templates';

describe('mail templates', () => {
  it('escapes user-provided names in HTML', () => {
    const template = renderEmailVerificationTemplate({
      fullName: '<script>alert("xss")</script>',
      actionUrl: 'https://shop.example/auth/verify-email?token=secret',
    });

    expect(template.html).not.toContain('<script>');
    expect(template.html).toContain('&lt;script&gt;');
    expect(template.text).toContain('<script>alert("xss")</script>');
  });

  it('documents the correct token lifetime for each flow', () => {
    const data = {
      fullName: 'Nguyen Van A',
      actionUrl: 'https://shop.example/action?token=secret',
    };

    expect(renderEmailVerificationTemplate(data).text).toContain('24 giờ');
    expect(renderPasswordResetTemplate(data).text).toContain('30 phút');
  });
});
