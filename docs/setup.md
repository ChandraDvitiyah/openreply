# Kult setup

The live deployment and all new-device, SSH-key, backup, update, and recovery
procedures are documented in [OPERATIONS.md](OPERATIONS.md). The local and Meta
configuration background remains in [KULT_SETUP.md](KULT_SETUP.md).

The original PostgreSQL/Railway instructions no longer match this fork.

Use the canonical local setup guide: [KULT_SETUP.md](KULT_SETUP.md).

Kult now uses one Turso/libSQL database for all relational application data,
Upstash Redis over TLS for BullMQ, and Clerk for authentication. Nothing is
deployed automatically.
# Setup guide status

> The current deployment no longer uses Upstash or BullMQ. Follow
> `OPERATIONS.md` for the Turso-backed durable queue architecture. Older Redis
> references below are retained only as historical context.
