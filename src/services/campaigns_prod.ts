import {
  getFirestore,
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
  deleteField,
  QueryConstraint,
  orderBy,
  limit,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import {
  Campaign,
  BusinessCategory,
  CampaignStatus,
  CampaignMetrics,
  CampaignApproval,
  CampaignTargeting,
} from '../types/business';
import { firebaseEnabled } from './firebase';

const db = getFirestore();
const auth = getAuth();

/**
 * Types for campaign operations
 */
export interface CreateCampaignInput {
  title: string;
  hook: string;
  cta: Campaign['cta'] | string;
  description: string;
  category: BusinessCategory | string;
  mediaUrl?: string;
  targeting: CampaignTargeting;
  budget?: {
    daily?: number;
    total?: number;
    currency?: string;
  };
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

export interface UpdateCampaignInput extends Partial<CreateCampaignInput> {}

const normalizeBusinessCategory = (value: BusinessCategory | string): BusinessCategory => {
  const normalized = value.trim().toLowerCase();
  const allowed: BusinessCategory[] = [
    'restaurant',
    'cafe',
    'gym',
    'wellness',
    'entertainment',
    'retail',
    'services',
    'events',
    'tourism',
    'other',
  ];

  return allowed.includes(normalized as BusinessCategory)
    ? (normalized as BusinessCategory)
    : 'other';
};

const normalizeCta = (value: Campaign['cta'] | string): Campaign['cta'] => {
  if (typeof value === 'string') {
    return {
      text: value.trim(),
      action: 'url',
      value: '',
    };
  }

  return {
    text: value.text.trim(),
    action: value.action,
    value: value.value,
  };
};

/**
 * Create a new campaign in a business
 * - Campaigns are stored in subcollection: businesses/{businessId}/campaigns/{campaignId}
 * - Initial status is always 'draft'
 * - Records creator for audit trail
 *
 * @param businessId - Business ID
 * @param input - Campaign creation data
 * @returns The created Campaign
 */
export const createCampaign = async (
  businessId: string,
  input: CreateCampaignInput
): Promise<Campaign> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated to create a campaign');
  }

  // Validate required fields
  if (!input.title?.trim()) {
    throw new Error('Campaign title is required');
  }
  if (!input.hook?.trim()) {
    throw new Error('Campaign hook/headline is required');
  }
  if (typeof input.cta === 'string' ? !input.cta.trim() : !input.cta.text?.trim()) {
    throw new Error('Campaign CTA text is required');
  }
  if (!input.category?.toString().trim()) {
    throw new Error('Category is required');
  }
  if (!input.targeting) {
    throw new Error('Targeting information is required');
  }

  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = Timestamp.now();
  const defaultEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const campaignData: Campaign = {
    id: campaignId,
    businessId,
    title: input.title.trim(),
    hook: input.hook.trim(),
    cta: normalizeCta(input.cta),
    description: input.description?.trim() || '',
    category: normalizeBusinessCategory(input.category),
    mediaUrl: input.mediaUrl || '',
    media: [],
    targeting: input.targeting,
    budget: input.budget || {
      total: 0,
      currency: 'EUR',
    },
    dateRange: {
      startDate: input.dateRange?.startDate || now.toDate().toISOString(),
      endDate: input.dateRange?.endDate || defaultEndDate.toISOString(),
    },
    status: 'draft' as const,
    createdAt: now.toDate().toISOString(),
    updatedAt: now.toDate().toISOString(),
    createdBy: user.uid,
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
      lastUpdated: now.toDate().toISOString(),
    },
  };

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await setDoc(docRef, campaignData);
    return campaignData;
  } catch (error) {
    console.error('Error creating campaign:', error);
    throw new Error(
      `Failed to create campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get a campaign by ID
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 * @returns Campaign or null if not found
 */
export const getCampaign = async (businessId: string, campaignId: string): Promise<Campaign | null> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      return null;
    }

    return snap.data() as Campaign;
  } catch (error) {
    console.error(`Error fetching campaign ${campaignId}:`, error);
    throw new Error(
      `Failed to fetch campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get all campaigns for a business
 *
 * @param businessId - Business ID
 * @returns Array of campaigns
 */
export const getCampaignsByBusiness = async (businessId: string): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'campaigns'),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Campaign);
  } catch (error) {
    console.error(`Error fetching campaigns for business ${businessId}:`, error);
    throw new Error(
      `Failed to fetch campaigns: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get campaigns by status for a business
 *
 * @param businessId - Business ID
 * @param status - Campaign status to filter
 * @returns Array of campaigns with matching status
 */
export const getCampaignsByStatus = async (
  businessId: string,
  status: CampaignStatus
): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'campaigns'),
      where('status', '==', status),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Campaign);
  } catch (error) {
    console.error(`Error fetching ${status} campaigns:`, error);
    throw new Error(
      `Failed to fetch campaigns: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get active (approved + running) campaigns for a business
 *
 * @param businessId - Business ID
 * @returns Array of active campaigns
 */
export const getActiveCampaigns = async (businessId: string): Promise<Campaign[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'campaigns'),
      where('status', 'in', ['approved', 'active']),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Campaign);
  } catch (error) {
    console.error('Error fetching active campaigns:', error);
    throw new Error(
      `Failed to fetch active campaigns: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Update a campaign
 * - Does not allow direct status changes to 'active' (must go through approval)
 * - Preserves immutable fields
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 * @param updates - Partial campaign updates
 */
export const updateCampaign = async (
  businessId: string,
  campaignId: string,
  updates: UpdateCampaignInput
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);

    // Build sanitized update payload
    const updatePayload: Record<string, any> = {
      updatedAt: Timestamp.now(),
    };

    if (updates.title) {
      updatePayload.title = updates.title.trim();
    }
    if (updates.hook) {
      updatePayload.hook = updates.hook.trim();
    }
    if (updates.cta) {
      updatePayload.cta = normalizeCta(updates.cta);
    }
    if (updates.description !== undefined) {
      updatePayload.description = updates.description.trim();
    }
    if (updates.category) {
      updatePayload.category = normalizeBusinessCategory(updates.category);
    }
    if (updates.mediaUrl !== undefined) {
      updatePayload.mediaUrl = updates.mediaUrl;
    }
    if (updates.targeting) {
      updatePayload.targeting = updates.targeting;
    }
    if (updates.budget) {
      updatePayload.budget = updates.budget;
    }
    if (updates.dateRange) {
      updatePayload.dateRange = updates.dateRange;
    }

    // Non-admin users cannot change status directly
    // Status changes only through specific action functions

    await updateDoc(docRef, updatePayload);
  } catch (error) {
    console.error(`Error updating campaign ${campaignId}:`, error);
    throw new Error(
      `Failed to update campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Submit campaign for approval
 * - Changes status from 'draft' to 'pending_approval'
 * - Creates approval record for admin review
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 */
export const submitCampaignForApproval = async (
  businessId: string,
  campaignId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const campaignRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    const approvalRef = doc(
      db,
      'businesses',
      businessId,
      'campaigns',
      campaignId,
      'approvals',
      `approval_${Date.now()}`
    );

    const batch = writeBatch(db);

    // Update campaign status
    batch.update(campaignRef, {
      status: 'pending_approval',
      updatedAt: Timestamp.now(),
    });

    // Create approval record
    batch.set(approvalRef, {
      campaignId,
      businessId,
      status: 'pending' as const,
      submittedAt: Timestamp.now(),
      submittedBy: user.uid,
    });

    // Also add to global approval queue for admins
    const globalApprovalRef = doc(db, 'approval_queue', `approve_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    batch.set(globalApprovalRef, {
      campaignId,
      businessId,
      status: 'pending' as const,
      submittedAt: Timestamp.now(),
      submittedBy: user.uid,
    });

    await batch.commit();
  } catch (error) {
    console.error('Error submitting campaign for approval:', error);
    throw new Error(
      `Failed to submit campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Pause a campaign
 * - Only for active/approved campaigns
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 */
export const pauseCampaign = async (businessId: string, campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'paused',
      updatedAt: Timestamp.now(),
      pausedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Error pausing campaign:', error);
    throw new Error(
      `Failed to pause campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Resume a paused campaign
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 */
export const resumeCampaign = async (businessId: string, campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'active',
      updatedAt: Timestamp.now(),
      resumedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Error resuming campaign:', error);
    throw new Error(
      `Failed to resume campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Archive a campaign
 * - Campaign no longer shows in deck
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 */
export const archiveCampaign = async (businessId: string, campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'archived',
      updatedAt: Timestamp.now(),
      archivedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Error archiving campaign:', error);
    throw new Error(
      `Failed to archive campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Delete a campaign (soft delete)
 * - Keeps data for audit but hides from UI
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 */
export const deleteCampaign = async (businessId: string, campaignId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    await updateDoc(docRef, {
      status: 'archived',
      updatedAt: Timestamp.now(),
      deletedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    throw new Error(
      `Failed to delete campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Approve a campaign (admin only via Firestore rules)
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 * @param approvedBy - Admin user ID
 */
export const approveCampaign = async (
  businessId: string,
  campaignId: string,
  approvedBy: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const campaignRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    const approvalRef = collection(db, 'businesses', businessId, 'campaigns', campaignId, 'approvals');

    // Find the pending approval and update it
    const q = query(approvalRef, where('status', '==', 'pending'));
    const approvalSnap = await getDocs(q);

    if (approvalSnap.empty) {
      throw new Error('No pending approval found for this campaign');
    }

    const batch = writeBatch(db);

    // Update campaign to approved
    batch.update(campaignRef, {
      status: 'approved',
      updatedAt: Timestamp.now(),
      approvedAt: Timestamp.now(),
      approvedBy,
    });

    // Update approval record
    approvalSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'approved',
        approvedAt: Timestamp.now(),
        approvedBy,
      });
    });

    await batch.commit();
  } catch (error) {
    console.error('Error approving campaign:', error);
    throw new Error(
      `Failed to approve campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Reject a campaign (admin only)
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 * @param reason - Rejection reason
 * @param rejectedBy - Admin user ID
 */
export const rejectCampaign = async (
  businessId: string,
  campaignId: string,
  reason: string,
  rejectedBy: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const campaignRef = doc(db, 'businesses', businessId, 'campaigns', campaignId);
    const approvalRef = collection(db, 'businesses', businessId, 'campaigns', campaignId, 'approvals');

    // Find the pending approval
    const q = query(approvalRef, where('status', '==', 'pending'));
    const approvalSnap = await getDocs(q);

    if (approvalSnap.empty) {
      throw new Error('No pending approval found');
    }

    const batch = writeBatch(db);

    // Update campaign back to draft
    batch.update(campaignRef, {
      status: 'draft',
      updatedAt: Timestamp.now(),
    });

    // Update approval record
    approvalSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'rejected',
        rejectionReason: reason,
        rejectedAt: Timestamp.now(),
        rejectedBy,
      });
    });

    await batch.commit();
  } catch (error) {
    console.error('Error rejecting campaign:', error);
    throw new Error(
      `Failed to reject campaign: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Record campaign metrics (impression, click, conversion)
 * - Called when users interact with campaigns in the deck
 * - Stores in metrics subcollection for aggregation
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 * @param type - Metric type
 * @param data - Additional metric data
 */
export const recordCampaignMetric = async (
  businessId: string,
  campaignId: string,
  type: 'impression' | 'click' | 'conversion',
  data?: Record<string, any>
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const metricRef = doc(
      db,
      'businesses',
      businessId,
      'campaigns',
      campaignId,
      'metrics',
      `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    );

    const metricData = {
      type,
      timestamp: Timestamp.now(),
      ...data,
    };

    await setDoc(metricRef, metricData);
  } catch (error) {
    console.error('Error recording campaign metric:', error);
    throw new Error(
      `Failed to record metric: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get campaign metrics for dashboard
 * - Aggregated from the metrics subcollection
 *
 * @param businessId - Business ID
 * @param campaignId - Campaign ID
 * @returns Aggregated metrics
 */
export const getCampaignMetrics = async (
  businessId: string,
  campaignId: string
): Promise<CampaignMetrics> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const metricsRef = collection(db, 'businesses', businessId, 'campaigns', campaignId, 'metrics');
    const snap = await getDocs(metricsRef);

    const metrics: CampaignMetrics = {
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

    snap.docs.forEach((doc) => {
      const data = doc.data();
      if (data.type === 'impression') metrics.impressions++;
      else if (data.type === 'click') metrics.clicks++;
      else if (data.type === 'conversion') metrics.conversions++;
      if (data.type === 'click') metrics.engagements++;
    });

    // Calculate derived metrics
    metrics.ctr = metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0;
    metrics.conversionRate = metrics.clicks > 0 ? (metrics.conversions / metrics.clicks) * 100 : 0;

    return metrics;
  } catch (error) {
    console.error('Error fetching campaign metrics:', error);
    throw new Error(
      `Failed to fetch metrics: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Duplicate a campaign
 * - Creates new draft campaign with similar settings
 *
 * @param businessId - Business ID
 * @param sourceId - Campaign ID to duplicate
 * @returns New campaign
 */
export const duplicateCampaign = async (businessId: string, sourceId: string): Promise<Campaign> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const sourceCompaign = await getCampaign(businessId, sourceId);
  if (!sourceCompaign) {
    throw new Error('Source campaign not found');
  }

  const newCampaign = await createCampaign(businessId, {
    title: `${sourceCompaign.title} (Copy)`,
    hook: sourceCompaign.hook,
    cta: sourceCompaign.cta,
    description: sourceCompaign.description,
    category: sourceCompaign.category,
    mediaUrl: sourceCompaign.mediaUrl,
    targeting: sourceCompaign.targeting,
    budget: sourceCompaign.budget,
    dateRange: {
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });

  return newCampaign;
};
