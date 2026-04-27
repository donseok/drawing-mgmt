-- =============================================================================
-- 0012_r38_sms_kakao — N-2 SMS + Kakao 알림톡 channel toggles
--
-- Adds three columns to "User":
--   - phoneNumber    TEXT             — nullable, E.164-ish (the app side
--                                       enforces format via zod). Used by both
--                                       SMS and KakaoTalk push fanouts.
--   - notifyBySms    BOOLEAN NOT NULL — default FALSE. Read by
--                                       `enqueueNotification` when deciding
--                                       whether to push onto the BullMQ `sms`
--                                       queue. Default FALSE because external
--                                       SMS API calls cost real money — opt-in.
--   - notifyByKakao  BOOLEAN NOT NULL — default FALSE. Same shape as above
--                                       but for the `kakao` queue (NCP SENS /
--                                       generic HTTP).
--
-- The global `SMS_ENABLED` / `KAKAO_ENABLED` env gates (lib/sms.ts,
-- lib/kakao.ts) still win — these columns are the user-facing opt-in.
-- Default FALSE preserves regression parity with R37: the upgrade does not
-- start sending SMS/Kakao to anyone unless they (a) populate `phoneNumber`,
-- (b) toggle the matching channel on in /settings, AND (c) the operator
-- enables the channel via env.
--
-- Idempotent + transactional. Safe to re-run on partially-applied DBs.
-- =============================================================================

BEGIN;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "phoneNumber"   TEXT;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "notifyBySms"   BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "notifyByKakao" BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
