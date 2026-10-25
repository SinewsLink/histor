# goose crash test: at-least-once execution vs exactly-once approval

Durable runtimes such as Dapr Workflows (used by Diagrid's goose integration) redispatch a turn from scratch when the worker dies mid-turn. If a side-effecting tool call already ran before the crash, the retried turn can run it again. This test shows that with goose 1.56.0 and a scripted model, so it needs no API key and gives the same result every time.

Run `./run.sh` (goose CLI on PATH, Node 20+, `npm install` at the repo root). It plays the redispatch by resuming the same goose session in a fresh process, which is what the Dapr integration does; Dapr itself is not started.

Result on 2026-10-25:
- **goose alone:** the crash plus redispatch moved the same $500 twice.
- **goose + SL Histor:** the first call was blocked pending approval. A self-approval by the requester was refused. The ops lead's approval let the call run once. The redispatched retry was blocked as "approval already used", and both outcomes are signed receipts.

The scripted model always repeats the call after a redispatch, which is the worst case. A real model may or may not repeat it, which is the point: the outcome should not depend on the model's judgement.

Known limitation: goose sometimes ends an extension process before the proxy can write its closing receipt. The verifier reports such a stream as open rather than complete. Daily `histor seal` plus anchoring makes a truncated stream detectable regardless.
