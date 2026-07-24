import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  DocumentReference,
  Timestamp,
} from 'firebase/firestore';
import { BusinessProfile, BusinessCategory, Campaign } from '../types/business';
import { db as sharedDb, firebaseEnabled } from './firebase';
import { ensureAuth } from './firebase';

const db = sharedDb as any;

const normalizeCampaignFromFirestore = (raw: any): Campaign => {
  const ctaObject = raw?.cta && typeof raw.cta === 'object'
    ? raw.cta
    : raw?.ctaPayload && typeof raw.ctaPayload === 'object'
      ? raw.ctaPayload
      : {
          text: typeof raw?.cta === 'string' && raw.cta.trim().length > 0 ? raw.cta : 'Learn More',
          action: 'url' as const,
          value: '',
        };

  return {
    ...(raw as Campaign),
    cta: {
      text: ctaObject.text ?? 'Learn More',
      action: ctaObject.action ?? 'url',
      value: ctaObject.value ?? '',
    },
  };
};

const toRuleCompatibleTargeting = (targeting?: Campaign['targeting']) => ({
  moods: targeting?.moods ?? [],
  weatherConditions: targeting?.weatherConditions ?? [],
  locationRadius: (targeting as any)?.locationRadius ?? 5,
  interests: targeting?.interests ?? [],
  ...(targeting ?? {}),
});

/**
 * Create a new business profile for a user
 */
export const createBusinessProfile = async (
  userId: string,
  profile: Partial<BusinessProfile>
): Promise<BusinessProfile> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  const docRef = doc(db, 'businesses', userId);
  const now = new Date().toISOString();

  const businessData: BusinessProfile = {
    id: userId,
    userId,
    // Firestore rules expect `ownerId` field
    ownerId: userId,
    businessName: profile.businessName || '',
    category: profile.category || 'other',
    description: profile.description,
    // Ensure website is a string to satisfy hasValidBusinessData() in security rules
    website: profile.website || '',
    phone: profile.phone,
    email: profile.email || '',
    location: profile.location || {
      address: '',
      city: '',
      country: '',
      lat: 0,
      lng: 0,
    },
    // Initialize teamMembers map with creator as owner to satisfy security rules
    teamMembers: {
      [userId]: 'owner',
    },
    // Optional fields: only include if provided to avoid Firestore rejecting `undefined`
    ...(profile.logo !== undefined ? { logo: profile.logo } : {}),
    ...(profile.socialLinks !== undefined ? { socialLinks: profile.socialLinks } : {}),
    verificationStatus: 'pending',
    verificationBadge: false,
    createdAt: now,
    updatedAt: now,
    onboardingComplete: true,
  };

  await setDoc(docRef, businessData);
  return businessData;
};

/**
 * Get a business profile by user ID
 */
export const getBusinessProfile = async (userId: string): Promise<BusinessProfile | null> => {
  if (!firebaseEnabled) {
    return null;
  }

  try {
    const docRef = doc(db, 'businesses', userId);
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as BusinessProfile) : null;
  } catch (error) {
    console.error('Error fetching business profile:', error);
    return null;
  }
};

/**
 * Update a business profile
 */
export const updateBusinessProfile = async (
  userId: string,
  updates: Partial<BusinessProfile>
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', userId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating business profile:', error);
    throw error;
  }
};

/**
 * Check if user already has a business profile
 */
export const hasBusinessProfile = async (userId: string): Promise<boolean> => {
  if (!firebaseEnabled) {
    return false;
  }

  try {
    const profile = await getBusinessProfile(userId);
    return !!profile;
  } catch (error) {
    console.error('Error checking business profile:', error);
    return false;
  }
};

/**
 * Get all businesses (for admin purposes)
 */
export const getAllBusinesses = async (
  limit: number = 100
): Promise<BusinessProfile[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(collection(db, 'businesses'));
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as BusinessProfile).slice(0, limit);
  } catch (error) {
    console.error('Error fetching all businesses:', error);
    return [];
  }
};

/**
 * Get businesses by verification status
 */
export const getBusinessesByStatus = async (
  status: 'pending' | 'verified' | 'rejected',
  limit: number = 100
): Promise<BusinessProfile[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(
      collection(db, 'businesses'),
      where('verificationStatus', '==', status)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as BusinessProfile).slice(0, limit);
  } catch (error) {
    console.error(`Error fetching ${status} businesses:`, error);
    return [];
  }
};

/**
 * Verify a business (admin action)
 */
export const verifyBusiness = async (userId: string, approved: boolean): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', userId);
    await updateDoc(docRef, {
      verificationStatus: approved ? 'verified' : 'rejected',
      verificationBadge: approved,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error verifying business:', error);
    throw error;
  }
};

/**
 * Delete a business profile
 */
export const deleteBusinessProfile = async (userId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    // In Firestore, we typically just update the status or mark as deleted
    // rather than actually deleting the document for audit purposes
    const docRef = doc(db, 'businesses', userId);
    await updateDoc(docRef, {
      verificationStatus: 'rejected',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error deleting business profile:', error);
    throw error;
  }
};

/**
 * Update business location
 */
export const updateBusinessLocation = async (
  userId: string,
  location: BusinessProfile['location']
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', userId);
    await updateDoc(docRef, {
      location,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating business location:', error);
    throw error;
  }
};

/**
 * Update business logo
 */
export const updateBusinessLogo = async (
  userId: string,
  logoUrl: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', userId);
    await updateDoc(docRef, {
      logo: {
        url: logoUrl,
        uploadedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating business logo:', error);
    throw error;
  }
};

/**
 * Update business social links
 */
export const updateBusinessSocialLinks = async (
  userId: string,
  socialLinks: BusinessProfile['socialLinks']
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', userId);
    await updateDoc(docRef, {
      socialLinks,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating social links:', error);
    throw error;
  }
};

/* ── CAMPAIGNS ────────────────────────────────────────────── */

/**
 * Create a new campaign for a business
 */
export const createCampaign = async (
  businessId: string,
  campaign: Partial<Campaign>
): Promise<Campaign> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  const uid = await ensureAuth();
  if (!uid) {
    throw new Error('You must be signed in to create campaigns');
  }

  const campaignId = `campaign_${Date.now()}`;
  const now = new Date().toISOString();
  const sanitizedBudget = campaign.budget
    ? (Object.fromEntries(
        Object.entries(campaign.budget).filter(([, value]) => value !== undefined),
      ) as NonNullable<Campaign['budget']>)
    : undefined;

  const campaignDataForWrite = {
    id: campaignId,
    businessId,
    createdBy: uid,
    title: campaign.title || 'Untitled Campaign',
    hook: campaign.hook || '',
    description: campaign.description || '',
    logoUrl: campaign.logoUrl,
    emojis: campaign.emojis || [],
    retrieveOffer: campaign.retrieveOffer,
    // Some deployed Firestore rules expect cta to be a string.
    cta: campaign.cta?.text || 'Learn More',
    ctaPayload: campaign.cta || {
      text: 'Learn More',
      action: 'url',
      value: '',
    },
    category: campaign.category || 'other',
    media: campaign.media || [],
    targeting: toRuleCompatibleTargeting(campaign.targeting),
    dateRange: campaign.dateRange || {
      startDate: now,
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    ...(sanitizedBudget && Object.keys(sanitizedBudget).length > 0 ? { budget: sanitizedBudget } : {}),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    metrics: {
      impressions: 0,
      clicks: 0,
      engagements: 0,
      activityStarts: 0,
      calendarAdds: 0,
      conversions: 0,
      uniqueUsers: 0,
      ctr: 0,
      conversionRate: 0,
      lastUpdated: now,
    },
  };

  const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
  try {
    await setDoc(docRef, campaignDataForWrite);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'permission-denied') {
      throw new Error('Campaign creation blocked by Firestore permissions. Ensure your account is owner/editor for this business.');
    }
    throw error;
  }
  return normalizeCampaignFromFirestore(campaignDataForWrite);
};

/**
 * Get a single campaign
 */
export const getCampaign = async (
  businessId: string,
  campaignId: string
): Promise<Campaign | null> => {
  if (!firebaseEnabled) {
    return null;
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    const snap = await getDoc(docRef);
    return snap.exists() ? normalizeCampaignFromFirestore(snap.data()) : null;
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return null;
  }
};

/**
 * Get all campaigns for a business
 */
export const getCampaignsByBusiness = async (businessId: string): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(collection(db, 'businesses', businessId, 'campaigns'));
    const snap = await getDocs(q);
    return snap.docs.map((doc) => normalizeCampaignFromFirestore(doc.data()));
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return [];
  }
};

/**
 * Get campaigns by status for a business
 */
export const getCampaignsByStatus = async (
  businessId: string,
  status: string
): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'campaigns'),
      where('status', '==', status)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => normalizeCampaignFromFirestore(doc.data()));
  } catch (error) {
    console.error('Error fetching campaigns by status:', error);
    return [];
  }
};

/**
 * Update a campaign
 */
export const updateCampaign = async (
  businessId: string,
  campaignId: string,
  updates: Partial<Campaign>
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    const sanitizedBudget = updates.budget
      ? (Object.fromEntries(
          Object.entries(updates.budget).filter(([, value]) => value !== undefined),
        ) as NonNullable<Campaign['budget']>)
      : undefined;
    const sanitizedUpdates = Object.fromEntries(
      Object.entries({
        ...updates,
        ...(sanitizedBudget ? { budget: sanitizedBudget } : {}),
      }).filter(([key, value]) => value !== undefined && !(key === 'budget' && (!value || Object.keys(value as object).length === 0))),
    ) as Partial<Campaign>;

    await updateDoc(docRef, {
      ...sanitizedUpdates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating campaign:', error);
    throw error;
  }
};

/**
 * Delete a campaign
 */
export const deleteCampaign = async (
  businessId: string,
  campaignId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    // Mark as archived instead of deleting
    await updateDoc(docRef, {
      status: 'archived',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    throw error;
  }
};

/**
 * Submit campaign for approval
 */
export const submitCampaignForApproval = async (
  businessId: string,
  campaignId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'pending_approval',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error submitting campaign:', error);
    throw error;
  }
};

/**
 * Activate a campaign
 */
export const activateCampaign = async (
  businessId: string,
  campaignId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'active',
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error activating campaign:', error);
    throw error;
  }
};

/**
 * Pause a campaign
 */
export const pauseCampaign = async (
  businessId: string,
  campaignId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'paused',
      pausedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    throw error;
  }
};

/**
 * End a campaign
 */
export const endCampaign = async (
  businessId: string,
  campaignId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'ended',
      endedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error ending campaign:', error);
    throw error;
  }
};
