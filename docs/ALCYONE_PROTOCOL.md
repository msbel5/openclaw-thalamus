# Alcyone Protocol v1

Internal-only dense vocabulary for Captain, Builder, Inspector, Archivist,
and Liaison. Load once at session start. Do not use @-codes in Mami-facing
messages unless Mami explicitly asks for raw protocol.

## Ack
- `protocol_version`: `alcyone-v1`
- `ack`: `@ack:alcyone-v1`

## Core Codes
- `@p`: Thalamus packet id.
- `@r`: resolver key.
- `@v`: inline vector present.
- `@tb`: tensor bundle id.
- `@ns`: vector namespace.
- `@q`: query path (`vector`, `packet`, `text`).
- `@role`: agent role.
- `@intent`: task intent.
- `@crit`: acceptance criteria.
- `@risk`: known risk.
- `@proof`: proof/test artifact.
- `@rej`: Inspector rejection reason.
- `@retry`: rejection retry count.
- `@pr`: GitHub PR number.
- `@commit`: git commit sha.
- `@svc`: service status gate.

## Spawn Context Shape
```json
{
  "protocol_version": "alcyone-v1",
  "ack": "@ack:alcyone-v1",
  "@p": "pkt_...",
  "@r": "sha256:...",
  "@v": 1,
  "@tb": "tb_...",
  "@ns": "atoms.code",
  "@q": "vector",
  "@role": "builder",
  "@crit": "tests green; no fabrication"
}
```

## Rules
- Packet id + resolver key remain mandatory.
- Inline vector or tensor bundle should be included when available.
- Use @-codes only in inter-agent context and telemetry.
- Expand to natural language in user-facing summaries, reports, docs, and code comments.
- If a receiver does not acknowledge `@ack:alcyone-v1`, fall back to normal JSON fields.
