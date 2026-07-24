import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  Timestamp,
  FieldValue,
  deleteField,
} from 'firebase/firestore';
import { BusinessProfile, BusinessCategory } from '../types/business';
import { auth as sharedAuth, db as sharedDb, firebaseEnabled } from './firebase';

const db = sharedDb as any;
const auth = sharedAuth as any;

/**
 * Types for business platform operations
 */
export interface CreateBusinessInput {
  businessName: string;
  category: BusinessCategory;
  email: string;
  phone?: string;
  website?: string;
  description?: string;
  location: {
    address: string;
    city: string;
    country: string;
    lat?: number;
    lng?: number;
  };
  socialLinks?: {
    instagram?: string;
    facebook?: string;
  };
}

export interface UpdateBusinessInput extends Partial<CreateBusinessInput> {
  tagline?: string;
  about?: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  joinedAt: Timestamp;
  invitedBy?: string;
}

/**
 * Create a new business profile
 * - Links to authenticated user as owner
 * - Sets verification status to 'pending'
 * - Initializes empty metrics
 *
 * @param ownerId - The user ID who owns this business
 * @param input - Business creation data
 * @returns The created BusinessProfile with generated ID
 */
export const createBusinessProfile = async (
  ownerId: string,
  input: CreateBusinessInput
): Promise<BusinessProfile> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const user = auth.currentUser;
  if (!user || user.uid !== ownerId) {
    throw new Error('Only authenticated users can create a business profile');
  }

  // Validate required fields
  if (!input.businessName?.trim()) {
    throw new Error('Business name is required');
  }
  if (!input.email?.trim()) {
    throw new Error('Email is required');
  }
  if (!input.location?.address || !input.location?.city || !input.location?.country) {
    throw new Error('Complete location (address, city, country) is required');
  }

  const businessId = `biz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const businessData: BusinessProfile = {
    id: businessId,
    userId: ownerId,
    ownerId,
    businessName: input.businessName.trim(),
    category: input.category,
    email: input.email.trim(),
    phone: input.phone?.trim() || '',
    website: input.website?.trim() || '',
    description: input.description?.trim() || '',
    location: {
      address: input.location.address.trim(),
      city: input.location.city.trim(),
      country: input.location.country.trim(),
      lat: input.location.lat || 0,
      lng: input.location.lng || 0,
    },
    socialLinks: {
      instagram: input.socialLinks?.instagram?.trim() || '',
      facebook: input.socialLinks?.facebook?.trim() || '',
    },
    logo: undefined,
    verificationStatus: 'pending' as const,
    verificationBadge: false,
    createdAt: now,
    updatedAt: now,
    onboardingComplete: true,
    teamMembers: {
      [ownerId]: 'owner',
    },
  };

  try {
    const docRef = doc(db, 'businesses', businessId);
    await setDoc(docRef, businessData);
    return businessData;
  } catch (error) {
    console.error('Error creating business profile:', error);
    throw new Error(`Failed to create business profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Get a business profile by ID
 * - Recovers all profile information
 * - Includes team members and metrics
 *
 * @param businessId - ID of the business
 * @returns BusinessProfile or null if not found
 */
export const getBusinessProfile = async (businessId: string): Promise<BusinessProfile | null> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      return null;
    }

    return snap.data() as BusinessProfile;
  } catch (error) {
    console.error(`Error fetching business profile ${businessId}:`, error);
    throw new Error(`Failed to fetch business profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Get all businesses owned by a user
 *
 * @param userId - User ID to query
 * @returns Array of BusinessProfiles
 */
export const getBusinessesByOwner = async (userId: string): Promise<BusinessProfile[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(collection(db, 'businesses'), where('ownerId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as BusinessProfile);
  } catch (error) {
    console.error(`Error fetching businesses for user ${userId}:`, error);
    throw new Error(`Failed to fetch user businesses: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Get businesses by verification status (admin only via rules)
 *
 * @param status - Verification status to filter
 * @param limit - Max results to return
 * @returns Array of BusinessProfiles
 */
export const getBusinessesByStatus = async (
  status: 'pending' | 'verified' | 'rejected',
  limit: number = 50
): Promise<BusinessProfile[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses'),
      where('verificationStatus', '==', status)
    );
    const snap = await getDocs(q);
    return snap.docs.slice(0, limit).map((doc) => doc.data() as BusinessProfile);
  } catch (error) {
    console.error(`Error fetching ${status} businesses:`, error);
    throw new Error(`Failed to fetch businesses: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Update a business profile
 * - Preserves immutable fields (id, ownerId, createdAt)
 * - Updates timestamp automatically
 *
 * @param businessId - ID of the business to update
 * @param updates - Partial updates to apply
 */
export const updateBusinessProfile = async (
  businessId: string,
  updates: UpdateBusinessInput
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId);

    // Build update payload - sanitize inputs
    const updatePayload: Record<string, any> = {
      updatedAt: Timestamp.now(),
    };

    if (updates.businessName) {
      updatePayload.businessName = updates.businessName.trim();
    }
    if (updates.category) {
      updatePayload.category = updates.category;
    }
    if (updates.email) {
      updatePayload.email = updates.email.trim();
    }
    if (updates.phone !== undefined) {
      updatePayload.phone = updates.phone.trim();
    }
    if (updates.website !== undefined) {
      updatePayload.website = updates.website.trim();
    }
    if (updates.description !== undefined) {
      updatePayload.description = updates.description.trim();
    }
    if (updates.location) {
      updatePayload.location = {
        address: updates.location.address?.trim() || '',
        city: updates.location.city?.trim() || '',
        country: updates.location.country?.trim() || '',
        lat: updates.location.lat || 0,
        lng: updates.location.lng || 0,
      };
    }
    if (updates.socialLinks) {
      updatePayload.socialLinks = {
        instagram: updates.socialLinks.instagram?.trim() || '',
        facebook: updates.socialLinks.facebook?.trim() || '',
      };
    }

    await updateDoc(docRef, updatePayload);
  } catch (error) {
    console.error(`Error updating business ${businessId}:`, error);
    throw new Error(`Failed to update business profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Update business logo (stores reference to Storage URL)
 *
 * @param businessId - Business ID
 * @param logoUrl - Signed URL or reference to logo in Storage
 */
export const updateBusinessLogo = async (businessId: string, logoUrl: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId);
    await updateDoc(docRef, {
      logo: logoUrl,
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error(`Error updating logo for business ${businessId}:`, error);
    throw new Error(`Failed to update logo: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Add a team member to a business
 * - Validates role
 * - Records invitation timestamp
 *
 * @param businessId - Business ID
 * @param userId - User to add
 * @param email - User's email
 * @param role - Member role ('admin', 'editor', 'viewer')
 * @param invitedBy - User who sent invitation
 */
export const addTeamMember = async (
  businessId: string,
  userId: string,
  email: string,
  role: 'admin' | 'editor' | 'viewer',
  invitedBy: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  if (!['admin', 'editor', 'viewer'].includes(role)) {
    throw new Error('Invalid role. Must be admin, editor, or viewer');
  }

  try {
    const businessRef = doc(db, 'businesses', businessId);
    const teamMemberRef = doc(db, 'businesses', businessId, 'team_members', userId);

    const batch = writeBatch(db);

    // Update business teamMembers map
    batch.update(businessRef, {
      [`teamMembers.${userId}`]: role,
      updatedAt: Timestamp.now(),
    });

    // Create team member document
    batch.set(teamMemberRef, {
      userId,
      email: email.trim(),
      role,
      joinedAt: Timestamp.now(),
      invitedBy,
    });

    await batch.commit();
  } catch (error) {
    console.error(`Error adding team member to business ${businessId}:`, error);
    throw new Error(
      `Failed to add team member: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Remove a team member from a business
 *
 * @param businessId - Business ID
 * @param userId - User to remove
 */
export const removeTeamMember = async (businessId: string, userId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const businessRef = doc(db, 'businesses', businessId);
    const teamMemberRef = doc(db, 'businesses', businessId, 'team_members', userId);

    const batch = writeBatch(db);

    // Remove from teamMembers map
    batch.update(businessRef, {
      [`teamMembers.${userId}`]: deleteField(),
      updatedAt: Timestamp.now(),
    });

    // Delete team member document
    batch.delete(teamMemberRef);

    await batch.commit();
  } catch (error) {
    console.error(`Error removing team member from business ${businessId}:`, error);
    throw new Error(
      `Failed to remove team member: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Update a team member's role
 *
 * @param businessId - Business ID
 * @param userId - User to update
 * @param newRole - New role
 */
export const updateTeamMemberRole = async (
  businessId: string,
  userId: string,
  newRole: 'admin' | 'editor' | 'viewer'
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  if (!['admin', 'editor', 'viewer'].includes(newRole)) {
    throw new Error('Invalid role');
  }

  try {
    const businessRef = doc(db, 'businesses', businessId);
    const teamMemberRef = doc(db, 'businesses', businessId, 'team_members', userId);

    const batch = writeBatch(db);

    batch.update(businessRef, {
      [`teamMembers.${userId}`]: newRole,
      updatedAt: Timestamp.now(),
    });

    batch.update(teamMemberRef, {
      role: newRole,
      updatedAt: Timestamp.now(),
    });

    await batch.commit();
  } catch (error) {
    console.error(`Error updating team member role:`, error);
    throw new Error(
      `Failed to update team member: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Verify a business (admin action)
 * - Updates verification status
 * - Sets verification badge
 *
 * @param businessId - Business ID
 * @param approved - Whether to approve or reject
 * @param reason - Optional reason for rejection
 */
export const verifyBusiness = async (
  businessId: string,
  approved: boolean,
  reason?: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId);

    const updates: Record<string, any> = {
      verificationStatus: approved ? 'verified' : 'rejected',
      verificationBadge: approved,
      updatedAt: Timestamp.now(),
    };

    if (!approved && reason) {
      updates.rejectionReason = reason;
    }

    await updateDoc(docRef, updates);
  } catch (error) {
    console.error(`Error verifying business ${businessId}:`, error);
    throw new Error(
      `Failed to verify business: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Delete a business profile (soft delete by marking as rejected)
 * - Does not actually delete for audit purposes
 * - Marks as rejected and disables
 *
 * @param businessId - Business ID
 */
export const deleteBusinessProfile = async (businessId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId);
    await updateDoc(docRef, {
      verificationStatus: 'rejected',
      verificationBadge: false,
      updatedAt: Timestamp.now(),
      deletedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error(`Error deleting business ${businessId}:`, error);
    throw new Error(
      `Failed to delete business profile: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Update business metrics (called by Cloud Functions after aggregation)
 * - Increments counters based on campaign performance
 *
 * @param businessId - Business ID
 * @param updates - Metric updates to apply
 */
export const updateBusinessMetrics = async (
  businessId: string,
  updates: {
    campaignsCount?: number;
    totalImpressions?: number;
    totalClicks?: number;
    totalConversions?: number;
    totalSpent?: number;
  }
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId);
    const metricsUpdates: Record<string, any> = {};

    if (updates.campaignsCount !== undefined) {
      metricsUpdates['metrics.campaignsCount'] = updates.campaignsCount;
    }
    if (updates.totalImpressions !== undefined) {
      metricsUpdates['metrics.totalImpressions'] = updates.totalImpressions;
    }
    if (updates.totalClicks !== undefined) {
      metricsUpdates['metrics.totalClicks'] = updates.totalClicks;
    }
    if (updates.totalConversions !== undefined) {
      metricsUpdates['metrics.totalConversions'] = updates.totalConversions;
    }
    if (updates.totalSpent !== undefined) {
      metricsUpdates['metrics.totalSpent'] = updates.totalSpent;
    }

    metricsUpdates.updatedAt = Timestamp.now();

    await updateDoc(docRef, metricsUpdates);
  } catch (error) {
    console.error(`Error updating metrics for business ${businessId}:`, error);
    throw new Error(
      `Failed to update metrics: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Check if user has access to business
 * - Owner: full access
 * - Team member: role-based access
 *
 * @param businessId - Business ID
 * @param userId - User ID to check
 * @returns true if user has any access to business
 */
export const userHasBusinessAccess = async (businessId: string, userId: string): Promise<boolean> => {
  try {
    const business = await getBusinessProfile(businessId);
    if (!business) {
      return false;
    }

    return business.ownerId === userId || !!business.teamMembers?.[userId];
  } catch (error) {
    console.error('Error checking business access:', error);
    return false;
  }
};

/**
 * Get user's role in a business
 *
 * @param businessId - Business ID
 * @param userId - User ID
 * @returns Role or null if user doesn't have access
 */
export const getUserRoleInBusiness = async (
  businessId: string,
  userId: string
): Promise<'owner' | 'admin' | 'editor' | 'viewer' | null> => {
  try {
    const business = await getBusinessProfile(businessId);
    if (!business) {
      return null;
    }

    if (business.ownerId === userId) {
      return 'owner';
    }

    return business.teamMembers?.[userId] || null;
  } catch (error) {
    console.error('Error getting user role:', error);
    return null;
  }
};
