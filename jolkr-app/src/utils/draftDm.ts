import type { DmChannel } from '../api/types'

/**
 * Local-only DM channels that haven't been materialised on the server yet.
 *
 * When a user opens a "New Message" with someone they've never messaged before,
 * we add a draft entry to their sidebar instead of creating the DM in the
 * database. The DM only becomes real (and visible to the recipient) once the
 * sender hits Send for the first time. If they close or abandon the draft, no
 * DB row is ever written and the recipient never sees a phantom conversation.
 */
const DRAFT_PREFIX = 'draft:'

export function isDraftDmId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(DRAFT_PREFIX)
}

/**
 * Build a deterministic id for a draft DM keyed on its member set so the
 * same group of users always maps to the same draft slot. Includes the
 * caller in the member list to guard against collisions across users.
 */
export function makeDraftDmId(memberIds: string[]): string {
  const sorted = [...memberIds].sort()
  return `${DRAFT_PREFIX}${sorted.join(',')}`
}

/** Build a session-only DmChannel that lives in the sidebar until first send. */
export function buildDraftDm(memberIds: string[], name?: string | null): DmChannel {
  const sorted = [...memberIds].sort()
  return {
    id: makeDraftDmId(sorted),
    is_group: sorted.length > 2,
    name: name ?? null,
    members: sorted,
    created_at: new Date().toISOString(),
  }
}

/** True if `dm` is a 1-on-1 draft whose other participant matches `userId`. */
export function isDraftMatching1on1(dm: DmChannel, currentUserId: string, otherUserId: string): boolean {
  if (!isDraftDmId(dm.id) || dm.is_group) return false
  const others = dm.members.filter(id => id !== currentUserId)
  return others.length === 1 && others[0] === otherUserId
}

/** Find a draft already in the list that matches the desired member set. */
export function findDraftForMembers(list: DmChannel[], memberIds: string[]): DmChannel | undefined {
  const target = makeDraftDmId(memberIds)
  return list.find(d => d.id === target)
}
