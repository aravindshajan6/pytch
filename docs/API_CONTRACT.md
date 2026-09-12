# PYTCH — API Contract

**Shapes:** every request/response body referenced below is defined in
[`frontend/src/types/api.ts`](../frontend/src/types/api.ts). That file is canonical; backend
Pydantic schemas mirror it field-for-field (snake_case JSON on both sides).

- REST base: `/api/v1` · WebSocket: `/ws?token=<access_token>` · Static media: `/media/*`
- Auth: `Authorization: Bearer <access_token>` (JWT HS256, `type=access`, 60 min). Refresh token: `type=refresh`, 30 days.
- Errors: HTTP status + `{"error": {"code", "message", "details"}}`. Pydantic validation → `422 VALIDATION_ERROR`.
- Lists that paginate return `Page<T>` with `?limit=` (default 20, max 100) and `?offset=`.
- 🔒 = requires auth. 👑 = host only. 🧪 = only when `DEMO_MODE=true` (else `404 DEMO_DISABLED`).

---

## Meta
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` (no prefix too) | – | `{status:"ok", db:bool, redis:bool}` |
| GET | `/meta` | – | `AppMeta` |

## Auth (module `auth`)
| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/auth/otp/request` | `OtpRequest` | `OtpRequestResponse` | OTP (6 digits) in Redis 5 min; 5 requests / 10 min / phone → `429 RATE_LIMITED`. In demo mode `dev_code` is returned. |
| POST | `/auth/otp/verify` | `OtpVerify` | `AuthTokens` | Creates user (name = "Player XXXX") + `player_stats` row on first login → `is_new_user`. Wrong code → `400 INVALID_OTP`. |
| POST | `/auth/refresh` | `RefreshRequest` | `AuthTokens` | |

## Users (module `users`)
| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/users/me` | – | `UserMe` |
| PATCH 🔒 | `/users/me` | `UserUpdate` | `UserMe` |
| GET 🔒 | `/users/me/profile` | – | `PlayerProfile` |
| GET 🔒 | `/users/{user_id}` | – | `PlayerProfile` |

## Turfs, pitches, slots (modules `turfs`, `slots`)
| Method | Path | Query/Body | Response |
|---|---|---|---|
| GET | `/turfs` | `lat,lng,radius_km(=25),sport,indoor(bool),has_camera(bool),q,sort(distance\|price\|rating),limit,offset` | `Page<TurfSummary>` |
| GET | `/turfs/{slug}` | `lat,lng` optional (for distance) | `TurfDetail` |
| GET | `/pitches/{pitch_id}/slots` | `date=YYYY-MM-DD` (IST day, default today) | `Slot[]` (includes `weather` for outdoor pitches) |
| GET | `/slots/{slot_id}` | – | `SlotDetail` |

## Bookings & lobbies (modules `bookings`, `lobbies`)
| Method | Path | Body | Response | Errors |
|---|---|---|---|---|
| POST 🔒 | `/bookings` | `CreateBookingRequest` | `CreateBookingResponse` | `409 SLOT_LOCKED` (NOWAIT failed), `409 SLOT_UNAVAILABLE`, `422` |
| GET 🔒 | `/bookings/{id}` | – | `Booking` | |
| POST 🔒👑 | `/bookings/{id}/cancel` | – | `LobbyDetail` | `409 TOO_LATE` if confirmed and < 6 h to kickoff |
| GET 🔒 | `/lobbies` | `sport,lat,lng,radius_km(=15),date,include_ineligible(=false),limit,offset` | `Page<LobbySummary>` | public + joinable only |
| GET 🔒 | `/lobbies/quick-match` | `sport,lat,lng` | `QuickMatchResponse` | |
| GET 🔒 | `/lobbies/mine` | `scope=upcoming\|past` | `LobbySummary[]` | |
| GET 🔒 | `/lobbies/code/{code}` | – | `LobbyDetail` | |
| GET 🔒 | `/lobbies/{id}` | – | `LobbyDetail` | private lobbies visible to members or via code |
| POST 🔒 | `/lobbies/{id}/join` | – | `LobbyDetail` | `LOBBY_FULL`, `LOBBY_CLOSED`, `ALREADY_MEMBER`, `403 NOT_ELIGIBLE {details:{reasons}}` |
| POST 🔒 | `/lobbies/{id}/leave` | – | `LobbyDetail` | host can't leave (cancel instead) |
| POST 🔒 | `/lobbies/{id}/pay` | `PayRequest` | `PaymentIntent` | `ALREADY_PAID`, `PAYMENT_WINDOW_CLOSED`, `NOT_MEMBER` |
| POST 🔒👑 | `/lobbies/{id}/cover-remaining` | `PayRequest` | `PaymentIntent` | split + forming only |
| POST 🔒👑 | `/lobbies/{id}/balance-teams` | – | `LobbyDetail` | |
| DELETE 🔒👑 | `/lobbies/{id}/members/{user_id}` | – | `LobbyDetail` | unpaid members only |
| GET 🔒 | `/lobbies/{id}/messages` | `before(ISO),limit(=50)` | `LobbyMessage[]` (oldest→newest) | |
| POST 🔒 | `/lobbies/{id}/messages` | `{body: string(1..500)}` | `LobbyMessage` | members only |

## Payments & wallet (modules `payments`, `wallet`)
| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/payments/mine` | – | `Payment[]` |
| POST 🔒 | `/payments/{id}/mock/complete` | `MockCompleteRequest` | `Payment` (only when provider=mock) |
| POST 🔒 | `/payments/{id}/verify` | `RazorpayVerifyRequest` | `Payment` (`400 INVALID_SIGNATURE`) |
| POST | `/payments/webhooks/razorpay` | raw Razorpay event, header `X-Razorpay-Signature` | `{ok:true}` (idempotent via `webhook_events`) |
| GET 🔒 | `/wallet` | – | `Wallet` (last 50 txns) |

## Ratings (module `ratings`)
| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/ratings/pending` | – | `PendingRating[]` |
| POST 🔒 | `/ratings/lobbies/{lobby_id}` | `SubmitRatingsRequest` | `SubmitRatingsResponse` (`RATING_WINDOW_CLOSED`, `NOT_MEMBER`, `422`) |
| GET 🔒 | `/ratings/me` | – | `RatingSummary` |

## Bench / SOS (module `bench`)
| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/bench/me` | – | `BenchStatus` |
| PUT 🔒 | `/bench/me` | `BenchUpdate` | `BenchStatus` |
| GET 🔒 | `/bench/nearby` | `lat,lng,sport,radius_km(=5)` | `BenchNearby` |
| GET 🔒 | `/bench/sos` | – | `SOSRequest[]` (open, near my bench location, my sports) |
| POST 🔒👑 | `/bench/sos` | `CreateSOSRequest` | `SOSRequest` |
| POST 🔒 | `/bench/sos/{id}/accept` | – | `AcceptSOSResponse` — reserves a discounted `sub` seat for 5 min; client then pays via `POST /lobbies/{id}/pay` (`SOS_CLOSED`, `NOT_ELIGIBLE`, `ALREADY_MEMBER`) |
| POST 🔒 | `/bench/sos/{id}/decline` | – | `{ok:true}` |

## Highlights (module `highlights`)
| Method | Path | Body | Response |
|---|---|---|---|
| GET 🔒 | `/highlights/recordings` | – | `Recording[]` (matches I played) |
| GET 🔒 | `/highlights/recordings/{id}` | – | `Recording` |
| POST 🔒 | `/highlights/recordings/{id}/clips` | `CreateClipRequest` | `Clip` |
| DELETE 🔒 | `/highlights/clips/{id}` | – | `204` |
| GET 🔒 | `/highlights/feed` | `sort=trending\|recent,sport,limit,offset` | `Page<Clip>` |
| GET 🔒 | `/highlights/users/{user_id}/clips` | – | `Clip[]` |
| POST / DELETE 🔒 | `/highlights/clips/{id}/like` | – | `Clip` |
| POST / DELETE 🔒 | `/highlights/clips/{id}/pin` | – | `Clip` (`LIMIT_REACHED` > 3) |
| POST 🔒 | `/highlights/clips/{id}/view` | – | `{views:number}` |

## Weather (module `weather`)
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/weather/forecast` | `lat,lng,date` | `HourWeather[]` (24 entries, IST day) |
| GET 🔒 | `/weather/alerts` | – | `WeatherAlert[]` (open, lobbies I'm in) |
| GET 🔒 | `/weather/alerts/{id}` | – | `WeatherAlert` |
| GET 🔒👑 | `/weather/alerts/{id}/alternatives` | – | `TransferAlternative[]` |
| POST 🔒👑 | `/weather/alerts/{id}/transfer` | `TransferRequest` | `LobbyDetail` (`SLOT_LOCKED`, `SLOT_UNAVAILABLE`) |
| POST 🔒👑 | `/weather/alerts/{id}/rain-check` | – | `RainCheckResponse` |
| POST 🔒👑 | `/weather/alerts/{id}/dismiss` | – | `WeatherAlert` |

## Notifications (module `notifications`)
| Method | Path | Response |
|---|---|---|
| GET 🔒 | `/notifications?unread_only&limit&offset` | `NotificationPage` |
| POST 🔒 | `/notifications/{id}/read` | `Notification` |
| POST 🔒 | `/notifications/read-all` | `{updated:number}` |

## Gamification (module `gamification`)
| Method | Path | Response |
|---|---|---|
| GET 🔒 | `/gamification/me` | `GamificationMe` |
| GET 🔒 | `/leaderboard?metric=xp\|true_skill&period=week\|all` | `Leaderboard` (top 50 + me) |

## Demo controls 🧪 (module `dev`)
| Method | Path | Response | Effect |
|---|---|---|---|
| POST 🔒 | `/dev/lobbies/{id}/fill` | `{ok:true}` | Bots join and pay one by one (~1.5 s apart) — watch the split payment complete live. |
| POST 🔒 | `/dev/lobbies/{id}/complete` | `LobbyDetail` | Fast-forward: marks match completed now and runs the post-match pipeline (ratings window, recording, XP). |
| POST 🔒 | `/dev/lobbies/{id}/dropout` | `LobbyDetail` | A random paid non-host member drops → automatic SOS to the bench. |
| POST 🔒 | `/dev/lobbies/{id}/storm` | `WeatherAlert` | Creates a heavy-rain alert for the lobby (pitch treated as outdoor). |
| POST 🔒 | `/dev/sos-near-me` | `SOSRequest` | Spawns a bot-hosted match near the caller's bench location that needs a sub. |

---

## WebSocket protocol

Connect `ws(s)://<host>/ws?token=<access_token>`. The server auto-subscribes the socket to `user:<my_id>`.

Client → server (`ClientWsMessage`): `subscribe` / `unsubscribe` / `ping`.
Server → client (`ServerWsMessage`): `hello`, `pong`, `error`, and `event` envelopes:
```json
{"type":"event","channel":"lobby:9f..","event":"lobby.updated","data":{"lobby_id":"9f..","reason":"member_paid","actor":{...}},"ts":"2026-09-12T10:00:00Z"}
```

| Channel | Who may subscribe | Events |
|---|---|---|
| `user:<id>` | auto (self only) | `notification.new`, `sos.new`, `sos.closed`, `wallet.updated`, `badge.earned`, `level.up` |
| `lobby:<id>` | members, or anyone if lobby is public | `lobby.updated` (invalidate → refetch `GET /lobbies/{id}`), `lobby.message` |
| `pitch:<id>` | anyone authenticated | `slot.updated` |

Backplane: every API instance holds one Redis `PSUBSCRIBE pytch:ws:*` and fans out to its local sockets.
Publishers call `publish_on_commit(db, channel, event, data)` so events fire only after the transaction commits.

---

## Implementation notes (behaviour decided during the build)
- **Error statuses not pinned above:** `NOT_MEMBER` → 403 · `PAYMENT_FAILED` → 402 · host leaving / kicking a paid member → 409 `CONFLICT` · SOS on a non-confirmed lobby → 409 `LOBBY_CLOSED` · `POST /lobbies/{id}/messages` → 201.
- **Private lobbies** return 404 by id to non-members; they're reachable via invite code or an open SOS.
- **Dropout credit:** whoever pays for a seat reopened by a paid dropout (sub or regular joiner) triggers the credit to the earliest uncompensated dropout — exactly what the newcomer paid, capped at what the dropout paid. Otherwise the payment reimburses a host who fronted money (full mode / cover-remaining).
- **Refunds on cancel/expiry** net out any host reimbursements already paid, so credits out always equal money in.
- **Weather transfer** creates a new booking linked via `transferred_from_id`; the group keeps paying the original total (Pytch covers up to `rain_transfer_cover_paise`). Alternatives list one slot per pitch (closest kickoff).
- **No-show ratings:** when `showed_up=false`, skill and fair-play inputs are ignored (neutral); only reliability is penalised. Two no-show reports additionally count a no-show.
- **Quick-match `score`** is 0..100 (shown as "% match").
- **Refunds** always land as Pytch Credits (no gateway refunds in this version).
