export interface MailTemplateContent {
  subject: string;
  text: string;
  html: string;
}

interface TemplateData {
  fullName: string;
  actionUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function greetingName(fullName: string): string {
  const normalizedName = fullName.trim();
  return normalizedName.length > 0 ? normalizedName : 'bạn';
}

function renderLayout(content: {
  preheader: string;
  greeting: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  expiry: string;
}): string {
  const preheader = escapeHtml(content.preheader);
  const greeting = escapeHtml(content.greeting);
  const body = escapeHtml(content.body);
  const actionLabel = escapeHtml(content.actionLabel);
  const actionUrl = escapeHtml(content.actionUrl);
  const expiry = escapeHtml(content.expiry);

  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${preheader}</title>
  </head>
  <body style="margin:0;background:#f5f5f5;color:#171717;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px">
            <tr><td style="font-size:24px;font-weight:700;padding-bottom:24px">HICAS Commerce</td></tr>
            <tr><td style="font-size:16px;line-height:24px;padding-bottom:12px">Xin chào ${greeting},</td></tr>
            <tr><td style="font-size:16px;line-height:24px;padding-bottom:24px">${body}</td></tr>
            <tr>
              <td style="padding-bottom:24px">
                <a href="${actionUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;padding:12px 20px">${actionLabel}</a>
              </td>
            </tr>
            <tr><td style="font-size:14px;line-height:21px;color:#525252;padding-bottom:12px">${expiry}</td></tr>
            <tr><td style="font-size:14px;line-height:21px;color:#525252">Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderEmailVerificationTemplate(data: TemplateData): MailTemplateContent {
  const name = greetingName(data.fullName);

  return {
    subject: 'Xác minh địa chỉ email HICAS Commerce',
    text: [
      `Xin chào ${name},`,
      '',
      'Hãy xác minh địa chỉ email để kích hoạt tài khoản HICAS Commerce:',
      data.actionUrl,
      '',
      'Liên kết này có hiệu lực trong 24 giờ và chỉ sử dụng được một lần.',
      'Nếu bạn không tạo tài khoản này, hãy bỏ qua email.',
    ].join('\n'),
    html: renderLayout({
      preheader: 'Xác minh địa chỉ email HICAS Commerce',
      greeting: name,
      body: 'Hãy xác minh địa chỉ email để kích hoạt tài khoản HICAS Commerce.',
      actionLabel: 'Xác minh email',
      actionUrl: data.actionUrl,
      expiry: 'Liên kết này có hiệu lực trong 24 giờ và chỉ sử dụng được một lần.',
    }),
  };
}

export function renderPasswordResetTemplate(data: TemplateData): MailTemplateContent {
  const name = greetingName(data.fullName);

  return {
    subject: 'Đặt lại mật khẩu HICAS Commerce',
    text: [
      `Xin chào ${name},`,
      '',
      'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản HICAS Commerce của bạn:',
      data.actionUrl,
      '',
      'Liên kết này có hiệu lực trong 30 phút và chỉ sử dụng được một lần.',
      'Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.',
    ].join('\n'),
    html: renderLayout({
      preheader: 'Đặt lại mật khẩu HICAS Commerce',
      greeting: name,
      body: 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản HICAS Commerce của bạn.',
      actionLabel: 'Đặt lại mật khẩu',
      actionUrl: data.actionUrl,
      expiry: 'Liên kết này có hiệu lực trong 30 phút và chỉ sử dụng được một lần.',
    }),
  };
}
