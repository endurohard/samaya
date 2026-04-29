# Samaya — Architecture Analysis

_Generated: 2026-04-29_

---

## Service Map

| Service | Port (internal) | Schema (Postgres) | Owns |
|---|---|---|---|
| **user-service** | 3001 | `users` | companies, users, refresh_tokens |
| **salon-service** | 3002 | `salons` | service_categories, services, masters, master_schedules, schedule_templates, company_profile |
| **booking-service** | 3003 | `bookings` | bookings, booking_services, booking_events_outbox, promotions |
| **client-service** | 3004 | `clients` | clients |
| **inventory-service** | 3005 | `inventory` | products, warehouses, suppliers, receipts, movements, tech_cards |
| **finance-service** | 3006 | `finance` | accounts, categories, counterparties, operations |
| **salary-service** | 3007 | `salary` | schemes, accruals, payouts, settlements |
| **frontend (nginx)** | 3010 | — | Static SPA (index.html + app.js + style.css) |
| **Kong (proxy)** | 8010 | — | Routes all `/api/*` traffic to microservices |

### Kong Route Prefixes → Service
| API prefix | Service |
|---|---|
| `/api/auth/*` | user-service |
| `/api/salons/*` | salon-service |
| `/api/bookings/*` | booking-service |
| `/api/bookings/promos/*` | booking-service |
| `/api/bookings/sales*` | booking-service |
| `/api/bookings/analytics*` | booking-service |
| `/api/bookings/slots*` | booking-service (no auth required) |
| `/api/clients/*` | client-service |
| `/api/inventory/*` | inventory-service |
| `/api/finance/*` | finance-service |
| `/api/salary/*` | salary-service |

---

## Auth Flow

### Tokens
- **Access token**: short-lived JWT (15 min), signed with `JWT_SECRET`, contains `sub`, `company_id`, `role`, `type: "access"`, `exp`.
- **Refresh token**: long-lived opaque token (30 days) stored server-side as SHA256 hash in `users.refresh_tokens`. The raw token is sent over the wire.

### Login sequence
1. `POST /api/auth/login` with `{ email|phone, password, company_id? }` (company defaults to `DEFAULT_COMPANY_ID`).
2. On success: `{ access_token, refresh_token, user }`.
3. Frontend stores all three in `localStorage` (`access_token`, `refresh_token`, `user`).

### Request auth
- All API calls add `Authorization: Bearer {access_token}`.
- On 401: transparent refresh via `POST /api/auth/refresh { refresh_token }`, retry original request.
- If refresh fails: clear localStorage, redirect to profile/login view.

### Registration
- `POST /api/auth/register` with `{ email|phone, password, full_name?, role?, company_id? }`.
- Self-registration is allowed for any role including `owner` — **no invite code gate**.

### Roles
`owner` > `admin` > `master` > `client`. Read operations require any authenticated user; mutations (`POST`/`PATCH`/`DELETE`) typically require `owner|admin` or `owner|admin|master`.

---

## Key Business Logic Flows

### Booking Creation
1. Admin/master calls `POST /api/bookings` with `{ master_id, service_ids[], starts_at, client_phone|client_id, notes? }`.
2. booking-service fetches service snapshots (name, price, duration) from `salons.services`.
3. Computes `ends_at = starts_at + sum(duration_minutes)`, `total_price = sum(prices)`.
4. Inserts booking (`status = 'confirmed'`) and `booking_services` snapshot rows in one transaction.
5. Writes `booking.created` event to `booking_events_outbox` (transactional outbox pattern).
6. Constraint `23P01` (exclusion constraint on time range) returns 409 `SLOT_TAKEN` if overlap.

### Booking Completion (Sale)
1. `POST /api/bookings/:id/complete` with `{ payment_method, discount_pct?, promo_code? }`.
2. If `promo_code` provided: validates promotion record (active, within dates, not exhausted), increments `used_count`, picks the better discount (`max(manual, promo)`).
3. Sets `status = 'completed'`, `completed_at = NOW()`, stores `discount_amount = ROUND(total_price * discount_pct / 100, 2)`.
4. `paid_amount = total_price - discount_amount` is computed in SQL (not stored separately in bookings table — only in the SELECT).
5. Writes `booking.completed` outbox event.

### Promo Code Apply
- Frontend first calls `GET /api/bookings/promos/check?code=XXX` to validate and display discount before completing the sale.
- On complete, backend re-validates independently — safe double-check.
- Validation checks: `is_active`, `valid_from/valid_to`, `used_count < max_uses`.
- Code is normalised to UPPERCASE both client-side and server-side.

### Client History Tab
- Client modal opens with tab "Данные" active; "История" tab is initially disabled.
- When editing an existing client (not creating new), "История" tab is enabled.
- Clicking "История" loads `GET /api/bookings?client_id={id}&from=2020-01-01&to={today}` (approximate — check actual params in app.js clientHistoryTab handler).
- Renders booking list sorted by `starts_at`.

---

## Potential Issues & Inconsistencies

### 1. `paid_amount` stored inconsistently
In `bookings.bookings`, `total_price`, `discount_pct`, and `discount_amount` are persisted columns. But `paid_amount` is not a stored column — it is computed as `(total_price - discount_amount)` in every SELECT query. This is fine at query time but means the sales view's `totals.revenue` (summed in JS) must also subtract discounts. The SQL already does this correctly in `/sales` route.

### 2. Login only accepts `email` OR `phone`, not a unified `identifier`
The `auth.routes.ts` schema uses separate `email` / `phone` fields, but the frontend sends them as `identifier` and decides which field to use based on whether the string contains `@`. This works, but if a phone-based user enters their phone in the email field it will fail silently (field won't match). The frontend comment even shows the placeholder `owner@samaya.test или +79604080333`.

### 3. Self-registration allows `owner` role
`POST /api/auth/register` accepts `role: "owner"` without any company ownership check or invite code. In production this should be gated.

### 4. `discount_amount` uses old value in RETURNING clause
In `POST /:id/complete`:
```sql
UPDATE bookings SET discount_amount = ROUND(total_price * $4 / 100, 2), ...
RETURNING ..., (total_price - discount_amount)::float8 AS paid_amount
```
PostgreSQL `RETURNING` sees the **new** value of `discount_amount` (post-update), so `paid_amount` is correct. However this is non-obvious and could break if query is refactored.

### 5. No conflict guard on promo `used_count` increment
The promo `used_count` update and the booking `completed` update are in the same transaction, but `used_count` is incremented with `used_count + 1` without a row-level lock. Under concurrent completions with the same promo code, `max_uses` could be slightly exceeded. A `SELECT ... FOR UPDATE` on the promo row would prevent this.

### 6. Slots endpoint uses `config.DEFAULT_COMPANY_ID` fallback
`GET /api/bookings/slots` accepts an optional `company_id` param and falls back to env `DEFAULT_COMPANY_ID`. This works for single-tenant, but is a multi-tenant footgun.

### 7. Frontend caches masters globally
`cachedMasters` is a module-level array. If a user navigates away and back, stale masters are rendered before the async reload completes. The analytics view has `if (cachedMasters.length === 0) void loadMasters()` which means it only fetches if cache is empty — stale data is never reloaded unless the page refreshes.

### 8. Client history tab uses hardcoded date range
Looking at the app.js code pattern, the history endpoint is called with a very wide `from/to` range. The booking service `GET /` requires both `from` and `to` query params (validated by `listSchema` — missing either causes a 400). Any frontend code that omits these params will get an error.
