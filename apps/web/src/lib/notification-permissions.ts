import type { UserProfile } from '../types';

export function canReceiveNotifications(profile: UserProfile | null): boolean {
  return !!profile && (profile.canManageCalendar === true || profile.role === 'admin'
    || (profile.role === 'pos' && profile.storeAccess === 'all'));
}
