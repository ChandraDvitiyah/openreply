# Kult setup

The original PostgreSQL/Railway instructions no longer match this fork.

Use the canonical, current guide: [KULT_SETUP.md](KULT_SETUP.md).

Kult now uses one Turso/libSQL database for all relational application data,
Upstash Redis over TLS for BullMQ, and Clerk for authentication. Nothing is
deployed automatically.
