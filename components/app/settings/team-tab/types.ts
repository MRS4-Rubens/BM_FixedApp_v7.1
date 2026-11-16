import type { getTeam } from '@/lib/actions/team/get-team';
import type { inviteTeamMember } from '@/lib/actions/team/invite-team-member';

/** Derived from the server actions so the UI can never drift from what the server returns. */
export type TeamData = Extract<Awaited<ReturnType<typeof getTeam>>, { success: true }>['data'];
export type TeamMember = TeamData['members'][number];
export type TeamInvite = TeamData['invites'][number];
export type TeamSeats = TeamData['seats'];
export type InviteLinkResult = Extract<Awaited<ReturnType<typeof inviteTeamMember>>, { success: true }>['data'];
