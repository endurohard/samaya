// Фиксация согласия на обработку персональных данных (152-ФЗ).
// Галочка в форме — это то, что видит клиент; доказательством служит строка
// в clients.pd_consents. Пишем её везде, где публичная форма принимает имя и
// телефон: онлайн-запись, виджет, лендинги акций. См. 048_pd_consent.sql.

import { normalizePhone } from './client-link';

// Редакция политики, на которую соглашается клиент. Меняется вместе с текстом
// в services/frontend/src/privacy.html — по этой метке потом видно, кто на что
// соглашался, и кого нужно переспросить после правки политики.
export const PD_POLICY_VERSION = '2026-08-27';

export type PdConsentSource = 'public_booking' | 'public_widget' | 'promo' | 'admin';

// И pool, и pool-клиент внутри транзакции: клейм купона пишет пулом, запись —
// в той же транзакции, что и саму бронь.
interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface PdConsentInput {
  companyId: string;
  clientId: string | null;
  phone: string;
  fullName?: string | null;
  source: PdConsentSource;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordPdConsent(db: Queryable, input: PdConsentInput): Promise<void> {
  const phone = normalizePhone(input.phone);
  if (!phone || phone === '+') return;

  await db.query(
    `INSERT INTO clients.pd_consents
       (company_id, client_id, phone, full_name, source, policy_version, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.companyId,
      input.clientId,
      phone,
      input.fullName?.trim() || null,
      input.source,
      PD_POLICY_VERSION,
      // Пустая строка развалила бы каст к INET — только валидный адрес или NULL.
      input.ip || null,
      input.userAgent?.slice(0, 500) || null,
    ],
  );

  if (input.clientId) {
    await db.query(
      `UPDATE clients.clients SET pd_consent_at = NOW() WHERE id = $1`,
      [input.clientId],
    );
  }
}
