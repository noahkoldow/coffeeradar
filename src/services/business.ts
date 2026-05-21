import {
  getFirestore,
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
import { BusinessProfile, BusinessCategory } from '../types/business';
import { firebaseEnabled } from './firebase';

const db = getFirestore();

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
