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
  orderBy,
  limit,
  startAfter,
  QueryConstraint,
  DocumentReference,
} from 'firebase/firestore';
import { Campaign, CampaignStatus, CampaignMetrics, CampaignApproval } from '../types/business';
import { db as sharedDb, firebaseEnabled } from './firebase';

const db = sharedDb as any;

/**
 * Create a new campaign
 */
export const createCampaign = async (
  businessId: string,
  campaign: Partial<Campaign>
): Promise<Campaign> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  const campaignData: Campaign = {
    id: campaignId,
    businessId,
    title: campaign.title || '',
    hook: campaign.hook || '',
    description: campaign.description || '',
    cta: campaign.cta || { text: 'Learn More', action: 'url', value: '' },
    category: campaign.category || 'other',
    media: campaign.media || [],
    targeting: campaign.targeting || {
      interests: [],
      moods: [],
      locations: [],
      weatherConditions: [],
      timeWindows: [],
    },
    dateRange: campaign.dateRange || {
      startDate: now,
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    budget: campaign.budget,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  const docRef = doc(db, 'campaigns', campaignId);
  await setDoc(docRef, campaignData);
  return campaignData;
};

/**
 * Get a campaign by ID
 */
export const getCampaign = async (campaignId: string): Promise<Campaign | null> => {
  if (!firebaseEnabled) {
    return null;
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as Campaign) : null;
  } catch (error) {
    console.error('Error fetching campaign:', error);
    return null;
  }
};

/**
 * Get all campaigns for a business
 */
export const getCampaigns = async (businessId: string): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(
      collection(db, 'campaigns'),
      where('businessId', '==', businessId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Campaign);
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
  status: CampaignStatus
): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(
      collection(db, 'campaigns'),
      where('businessId', '==', businessId),
      where('status', '==', status)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Campaign);
  } catch (error) {
    console.error('Error fetching campaigns by status:', error);
    return [];
  }
};

/**
 * Update a campaign
 */
export const updateCampaign = async (
  campaignId: string,
  updates: Partial<Campaign>
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    await updateDoc(docRef, {
      ...updates,
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
export const deleteCampaign = async (campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('Error deleting campaign:', error);
    throw error;
  }
};

/**
 * Submit campaign for approval
 */
export const submitCampaignForApproval = async (campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    // Update campaign status to pending_approval
    const docRef = doc(db, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'pending_approval',
      updatedAt: new Date().toISOString(),
    });

    // Create approval record
    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const approvalRef = doc(db, 'campaign_approvals', approvalId);
    await setDoc(approvalRef, {
      id: approvalId,
      campaignId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error submitting campaign for approval:', error);
    throw error;
  }
};

/**
 * Pause a campaign
 */
export const pauseCampaign = async (campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'paused',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    throw error;
  }
};

/**
 * Resume a paused campaign
 */
export const resumeCampaign = async (campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'active',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error resuming campaign:', error);
    throw error;
  }
};

/**
 * End a campaign
 */
export const endCampaign = async (campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'ended',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error ending campaign:', error);
    throw error;
  }
};

/**
 * Update campaign metrics
 */
export const updateCampaignMetrics = async (
  campaignId: string,
  metrics: Partial<CampaignMetrics>
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase not enabled');
  }

  try {
    const docRef = doc(db, 'campaigns', campaignId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('Campaign not found');
    }

    const campaign = snap.data() as Campaign;
    const currentMetrics = campaign.metrics || {
      impressions: 0,
      clicks: 0,
      engagements: 0,
      activityStarts: 0,
      calendarAdds: 0,
      conversions: 0,
      uniqueUsers: 0,
      ctr: 0,
      conversionRate: 0,
      lastUpdated: new Date().toISOString(),
    };

    await updateDoc(docRef, {
      metrics: {
        ...currentMetrics,
        ...metrics,
        lastUpdated: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating campaign metrics:', error);
    throw error;
  }
};

/**
 * Get campaigns pending approval (admin function)
 */
export const getPendingApprovals = async (limit: number = 50): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const q = query(
      collection(db, 'campaigns'),
      where('status', '==', 'pending_approval')
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((doc) => doc.data() as Campaign)
      .slice(0, limit);
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    return [];
  }
};

/**
 * Get active campaigns (for targeting to consumers)
 */
export const getActiveCampaigns = async (): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    return [];
  }

  try {
    const now = new Date().toISOString();
    const q = query(
      collection(db, 'campaigns'),
      where('status', '==', 'active'),
      where('dateRange.endDate', '>=', now)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Campaign);
  } catch (error) {
    console.error('Error fetching active campaigns:', error);
    return [];
  }
};

/**
 * Record campaign impression
 */
export const recordCampaignImpression = async (
  campaignId: string,
  userId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    return;
  }

  try {
    const impressionRef = doc(db, 'campaign_impressions', `${campaignId}_${userId}_${Date.now()}`);
    await setDoc(impressionRef, {
      campaignId,
      userId,
      timestamp: new Date().toISOString(),
    });

    // Update campaign metrics
    const campaign = await getCampaign(campaignId);
    if (campaign) {
      const metrics = campaign.metrics || {
        impressions: 0,
        clicks: 0,
        engagements: 0,
        activityStarts: 0,
        calendarAdds: 0,
        conversions: 0,
        uniqueUsers: new Set().size,
        ctr: 0,
        conversionRate: 0,
        lastUpdated: new Date().toISOString(),
      };

      await updateCampaignMetrics(campaignId, {
        impressions: (metrics.impressions || 0) + 1,
        lastUpdated: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Error recording impression:', error);
  }
};

/**
 * Record campaign click
 */
export const recordCampaignClick = async (
  campaignId: string,
  userId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    return;
  }

  try {
    const clickRef = doc(db, 'campaign_clicks', `${campaignId}_${userId}_${Date.now()}`);
    await setDoc(clickRef, {
      campaignId,
      userId,
      timestamp: new Date().toISOString(),
    });

    // Update campaign metrics
    const campaign = await getCampaign(campaignId);
    if (campaign) {
      const metrics = campaign.metrics || {
        impressions: 0,
        clicks: 0,
        engagements: 0,
        activityStarts: 0,
        calendarAdds: 0,
        conversions: 0,
        uniqueUsers: 0,
        ctr: 0,
        conversionRate: 0,
        lastUpdated: new Date().toISOString(),
      };

      const updatedMetrics = {
        clicks: (metrics.clicks || 0) + 1,
        ctr: metrics.impressions ? ((metrics.clicks || 0) + 1) / metrics.impressions : 0,
        lastUpdated: new Date().toISOString(),
      };

      await updateCampaignMetrics(campaignId, updatedMetrics);
    }
  } catch (error) {
    console.error('Error recording click:', error);
  }
};

/**
 * Record campaign conversion
 */
export const recordCampaignConversion = async (
  campaignId: string,
  userId: string,
  type: 'activity_start' | 'calendar_add' | 'qr_scan'
): Promise<void> => {
  if (!firebaseEnabled) {
    return;
  }

  try {
    const conversionRef = doc(db, 'campaign_conversions', `${campaignId}_${userId}_${Date.now()}`);
    await setDoc(conversionRef, {
      campaignId,
      userId,
      type,
      timestamp: new Date().toISOString(),
    });

    // Update campaign metrics
    const campaign = await getCampaign(campaignId);
    if (campaign) {
      const metrics = campaign.metrics || {
        impressions: 0,
        clicks: 0,
        engagements: 0,
        activityStarts: 0,
        calendarAdds: 0,
        conversions: 0,
        uniqueUsers: 0,
        ctr: 0,
        conversionRate: 0,
        lastUpdated: new Date().toISOString(),
      };

      const updatedMetrics: Partial<CampaignMetrics> = {
        conversions: (metrics.conversions || 0) + 1,
        lastUpdated: new Date().toISOString(),
      };

      if (metrics.impressions) {
        updatedMetrics.conversionRate = ((metrics.conversions || 0) + 1) / metrics.impressions;
      }

      if (type === 'activity_start') {
        updatedMetrics.activityStarts = (metrics.activityStarts || 0) + 1;
      } else if (type === 'calendar_add') {
        updatedMetrics.calendarAdds = (metrics.calendarAdds || 0) + 1;
      }

      await updateCampaignMetrics(campaignId, updatedMetrics);
    }
  } catch (error) {
    console.error('Error recording conversion:', error);
  }
};
