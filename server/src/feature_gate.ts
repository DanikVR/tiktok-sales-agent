/** Self-hosted edition: every feature is on; there are no plans or tiers. */
export type UserRole = 'owner';
export interface FeatureAccess { commerce: boolean; tier: string | null; superadmin: boolean }
export async function getFeatureAccess(_tenantId: string, _role?: UserRole): Promise<FeatureAccess> {
  return { commerce: true, tier: 'self-hosted', superadmin: true };
}
