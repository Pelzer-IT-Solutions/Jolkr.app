/**
 * Discriminated union over the WebSocket events the backend emits.
 *
 * Each variant fixes the `op` literal and shape of its `d` payload, so
 * `switch (event.op)` automatically narrows `event.d` for the consumer.
 *
 * The main `WsEvent` shape is generated from the BE `GatewayEvent` enum via
 * `ts-rs`; the only thing layered on top here is `Disconnected`, which is a
 * synthetic, client-only event emitted by the WS client after a reconnect
 * gives up. Backend events with an unknown `op` still fall through any
 * `switch` consumer (the dispatcher casts at runtime), so adding a new
 * event purely on the BE never breaks the FE build.
 */

import type { WsEvent as GeneratedWsEvent } from './generated/WsEvent';

/** Synthetic event emitted by the client after MAX_ATTEMPTS failed reconnects. */
interface DisconnectedEvent {
  op: 'Disconnected';
  d: { reason: string };
}

export type WsEvent = GeneratedWsEvent | DisconnectedEvent;

export type WsListenerEvent = WsEvent;
