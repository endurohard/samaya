import nodemailer from 'nodemailer';
import { config } from './config';
import pino from 'pino';

const log = pino({ level: config.LOG_LEVEL });

const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: config.SMTP_USER
    ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
    : undefined,
});

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  await transporter.sendMail({
    from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  log.info({ to: opts.to, subject: opts.subject }, '[mailer] email sent');
}

function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07);">
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 100%);padding:24px 32px;text-align:center;">
            <div style="font-size:28px;margin-bottom:4px;">💅</div>
            <div style="color:#fff;font-size:20px;font-weight:700;">Samaya</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:12px;">
            Это автоматическое письмо — пожалуйста, не отвечайте на него.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function fmtDateTime(dt: string | Date, timezone = 'Europe/Moscow'): string {
  return new Date(dt).toLocaleString('ru-RU', {
    timeZone: timezone,
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtPrice(n: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n);
}

export function buildConfirmationEmail(opts: {
  clientName: string;
  masterName: string;
  services: string;
  startsAt: string | Date;
  totalPrice: number;
  timezone?: string;
}): { subject: string; html: string } {
  const subject = `Ваша запись подтверждена — ${fmtDateTime(opts.startsAt, opts.timezone)}`;
  const html = baseLayout('Запись подтверждена', `
    <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px;">Запись подтверждена ✅</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Здравствуйте, <strong>${opts.clientName}</strong>!<br>
      Ваша запись успешно создана.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Дата и время</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;font-weight:600;">${fmtDateTime(opts.startsAt, opts.timezone)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Мастер</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;">${opts.masterName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Услуги</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;">${opts.services}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Стоимость</td>
          <td style="padding:6px 0;color:#7c3aed;font-size:15px;font-weight:700;">${fmtPrice(opts.totalPrice)}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;margin:0;">
      Если вам нужно перенести или отменить запись — свяжитесь с нами заблаговременно. Ждём вас! 🌸
    </p>
  `);
  return { subject, html };
}

export function buildReminderEmail(opts: {
  clientName: string;
  masterName: string;
  services: string;
  startsAt: string | Date;
  hoursAhead: 24 | 2;
  timezone?: string;
}): { subject: string; html: string } {
  const when = opts.hoursAhead === 24 ? 'завтра' : 'через 2 часа';
  const subject = `Напоминание: запись ${when} в ${new Date(opts.startsAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: opts.timezone || 'Europe/Moscow' })}`;
  const html = baseLayout('Напоминание о записи', `
    <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px;">Напоминание о визите 🌸</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Здравствуйте, <strong>${opts.clientName}</strong>!<br>
      Напоминаем, что у вас запись <strong>${when}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Дата и время</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;font-weight:600;">${fmtDateTime(opts.startsAt, opts.timezone)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Мастер</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;">${opts.masterName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Услуги</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;">${opts.services}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;margin:0;">Ждём вас! Если что-то изменилось — сообщите нам. 💅</p>
  `);
  return { subject, html };
}

export function buildReviewEmail(opts: {
  clientName: string;
  masterName: string;
  bookingId: string;
  frontendUrl: string;
}): { subject: string; html: string } {
  const reviewUrl = `${opts.frontendUrl}/review.html?b=${opts.bookingId}`;
  const subject = 'Как прошёл ваш визит? Оставьте отзыв';
  const html = baseLayout('Оставьте отзыв', `
    <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px;">Спасибо за визит! 💖</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Здравствуйте, <strong>${opts.clientName}</strong>!<br>
      Надеемся, вы остались довольны работой мастера <strong>${opts.masterName}</strong>.
    </p>
    <p style="color:#374151;font-size:14px;margin:0 0 24px;">
      Ваш отзыв очень важен для нас — он помогает нам становиться лучше и помогает
      другим клиентам сделать правильный выбор.
    </p>
    <div style="text-align:center;margin-bottom:20px;">
      <a href="${reviewUrl}"
         style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;
                padding:14px 32px;border-radius:10px;font-size:15px;font-weight:600;">
        ⭐ Оставить отзыв
      </a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
      Или перейдите по ссылке: <a href="${reviewUrl}" style="color:#7c3aed;">${reviewUrl}</a>
    </p>
  `);
  return { subject, html };
}

export function buildMasterNotifyEmail(opts: {
  masterName: string;
  clientName: string;
  services: string;
  startsAt: string | Date;
  timezone?: string;
}): { subject: string; html: string } {
  const subject = `Новая запись: ${opts.clientName}, ${fmtDateTime(opts.startsAt, opts.timezone)}`;
  const html = baseLayout('Новая запись', `
    <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px;">Новая запись 📅</h2>
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">
      Здравствуйте, <strong>${opts.masterName}</strong>!<br>
      К вам записался новый клиент.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;">
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Клиент</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;font-weight:600;">${opts.clientName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Дата и время</td>
          <td style="padding:6px 0;color:#7c3aed;font-size:14px;font-weight:700;">${fmtDateTime(opts.startsAt, opts.timezone)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">Услуги</td>
          <td style="padding:6px 0;color:#1a1a2e;font-size:14px;">${opts.services}</td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px;margin:0;">Информация обновлена в вашем расписании. Удачного дня! 💅</p>
  `);
  return { subject, html };
}
