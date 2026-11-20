# Identity map key: escrow, recovery and rotation

Status: operational runbook, Round 4 (21 Nov 2026). No rotation has been performed. This document does not change any setting.

## 1. What the key protects

Baton replaces every known participant name with a `[PERSON_n]` placeholder before anything is stored or sent to an AI provider. The real display labels are kept in `public.handover_people.sealed_label`, encrypted on the application server.

- **Variable:** `IDENTITY_MAP_KEY` (server only, never `NEXT_PUBLIC_`). Optional `IDENTITY_MAP_KEY_VERSION`, default `k1`, currently the only accepted version.
- **Format:** exactly 32 random bytes, written as 64 hex characters or as base64 (44 characters with padding). Constant keys (for example all zeros) are refused.
- **Derivation:** HKDF-SHA256 (salt `baton-identity-vault`) derives two independent subkeys from the master key:
  - `enc:k1`, the AES-256-GCM key for `sealed_label` (random 96-bit nonce; the AAD binds handover id, person key and key version);
  - `person:k1`, the HMAC key that computes `person_key` (scoped to one handover).
- **Code:** `lib/privacy/identity-vault.ts` is the only reader of the variable.
- **Database:** the database never sees the key or a plaintext label. `handover_people` has no table privileges for any API role; it is reached only through SECURITY DEFINER functions.

## 2. What happens if the key is lost or wrong

The system fails closed:

- **Viewing:** `resolveHandoverPeople` returns no labels, so every screen shows "Person n" instead of a name. Nothing else breaks.
- **Processing:** the parse, extract and verify stages stop with a retryable failure (`identity_map_key_unverified`). No source is stored half pseudonymised and nothing is sent to the AI in clear.
- **Data:** stored content keeps its `[PERSON_n]` placeholders.

If the key is **lost for good**, the names behind every existing `[PERSON_n]` are lost for good. The person keys of existing handovers can no longer be computed either, so a re-upload into an existing handover registers the same people again as new ordinals. There is no recovery without the key. That is why escrow matters.

If the key **leaks**, an attacker who also holds a copy of `handover_people` can decrypt the labels. The key alone reveals nothing.

## 3. Escrow (owner action, do once)

1. Generate the key offline: `openssl rand -hex 32`. Never reuse a key from another environment.
2. Store it in Vercel as a **sensitive** environment variable for Production (and a different key for Preview, if Preview processes real data).
3. Keep **two** offline escrow copies, held by different people or places, for example:
   - a password manager vault entry owned by the account owner, shared with exactly one trusted backup person;
   - a sealed paper or hardware-token copy in a separate physical location.
4. Record in the escrow entry: environment, key version (`k1`), date created, who created it. Never record the key in Git, tickets, chat, logs, screenshots or documents.
5. Check every quarter that an escrow copy can be read. Compare a fingerprint (for example the first 8 hex characters of `sha256(key)`), never the key itself.

## 4. Recovery

When the deployed value is missing or wrong (symptom: every name shows as "Person n", and processing fails with `identity_map_key_unverified`):

1. Retrieve the escrowed key for the affected environment.
2. Restore it as `IDENTITY_MAP_KEY` (and `IDENTITY_MAP_KEY_VERSION=k1`) in Vercel, then redeploy.
3. Verify on one handover the owner can see: names appear again; start a test run on synthetic data and confirm the parse stage succeeds.
4. Jobs that failed with `identity_map_key_unverified` were retryable. Start processing again for affected handovers.

## 5. Rotation (designed, NOT implemented, NOT performed)

`key_version` exists on every row (only `k1` is accepted today) so a rotation can be added without a schema change. A rotation needs code that does not exist yet:

1. Accept a second version (`k2`) in `IDENTITY_MAP_KEY_VERSIONS`, and read both keys during the transition (for example `IDENTITY_MAP_KEY_K1` and `IDENTITY_MAP_KEY_K2`).
2. **Labels:** a service-role re-seal job decrypts each `sealed_label` with `k1` and re-encrypts it with `k2`, in one transaction per handover, writing `key_version = 'k2'`.
3. **Person keys:** they are HMACs under the `k1` person subkey. Either keep the `k1` person subkey for existing handovers (simplest, since person keys are not secret on their own) or recompute every `person_key` under `k2` from the stored identity hashes in the same transaction.
4. After every row is `k2`, remove `k1` from the environment, then destroy the `k1` escrow copies.
5. Rotate immediately (once this code exists) if the key or a database dump that contains `handover_people` may have leaked.

Until rotation exists, a suspected leak is handled by restricting access to database backups and the Vercel project, and by recording the incident. Do not change the key without the re-seal job: every existing name would become unreadable (section 2).

## 6. Related settings

- `BATON_ALLOW_LEGACY_IDENTITY_SOURCES` must stay **unset** in production. Legacy sources (parsed before pseudonymisation) hold plain-text names, and extraction refuses them unless this override is set. The owner should confirm it is unset.
- Account deletion removes a creator's handovers, and with them their `handover_people` rows (cascade). Participant erasure (D27) stays disabled.
