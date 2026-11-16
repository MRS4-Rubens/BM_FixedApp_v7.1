import { z } from 'zod';
import { INVITABLE_ROLES } from '@/lib/db/domain-values';
import { isWellFormedInviteToken, normaliseInviteEmail } from '@/lib/team/invite-format';

export const inviteTeamMemberSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Please enter an e-mail address.')
    .max(254, 'That e-mail address is too long.')
    .email('Please enter a valid e-mail address.')
    .transform(normaliseInviteEmail),
  role: z.enum(INVITABLE_ROLES).default('staff'),
});

export const teamInvitationIdSchema = z.object({
  invitation_id: z.string().uuid('Invalid invitation.'),
});

export const removeTeamMemberSchema = z.object({
  user_id: z.string().uuid('Invalid team member.'),
});

export const acceptTeamInviteSchema = z.object({
  token: z.string().refine(isWellFormedInviteToken, 'This invite link is not valid.'),
});

export const changeTeamMemberRoleSchema = z.object({
  user_id: z.string().uuid('Invalid team member.'),
  role: z.enum(INVITABLE_ROLES),
});
