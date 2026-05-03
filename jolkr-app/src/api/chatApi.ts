/** Strategy facade over the channel-vs-DM API split.
 *
 *  The backend exposes parallel endpoints for server channels and DM channels
 *  (`addReaction` / `addDmReaction`, `pinMessage` / `pinDmMessage`, …). The
 *  app code historically picked the right one with a `dmActive ? api.X : api.Y`
 *  ternary at every callsite, which made it easy to forget the conditional
 *  and add a regression. Centralising it here keeps the choice in one file:
 *  `chatApi(isDm).addReaction(id, emoji)` and the caller is none the wiser.
 *
 *  The functions are intentionally kept as method-shaped lookups (object) so
 *  callers can also write `chatApi(isDm).pinMessage(channelId, msgId)` without
 *  needing to remember per-method names.
 */
import * as api from './client';
import type { Message } from './types';

export interface ChatApi {
  /** Toggle / add a reaction. */
  addReaction: (messageId: string, emoji: string) => Promise<unknown>;
  removeReaction: (messageId: string, emoji: string) => Promise<unknown>;
  /** Pin / unpin operations.  `channelId` is the surrounding container id —
   *  channel id for server messages, DM id for DM messages. Backend returns
   *  the updated message; callers normally ignore it. */
  pinMessage: (channelId: string, messageId: string) => Promise<Message>;
  unpinMessage: (channelId: string, messageId: string) => Promise<Message>;
  /** Pinned-message list. */
  getPinnedMessages: (channelId: string) => Promise<Message[]>;
}

const SERVER_CHANNEL_API: ChatApi = {
  addReaction: api.addReaction,
  removeReaction: api.removeReaction,
  pinMessage: api.pinMessage,
  unpinMessage: api.unpinMessage,
  getPinnedMessages: api.getPinnedMessages,
};

const DM_API: ChatApi = {
  addReaction: api.addDmReaction,
  removeReaction: api.removeDmReaction,
  pinMessage: api.pinDmMessage,
  unpinMessage: api.unpinDmMessage,
  getPinnedMessages: api.getDmPinnedMessages,
};

/** Return the right API surface for the current chat context. */
export function chatApi(isDm: boolean): ChatApi {
  return isDm ? DM_API : SERVER_CHANNEL_API;
}
