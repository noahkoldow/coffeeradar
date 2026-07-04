/**
 * Business Types and Interfaces
 * Complete type definitions for the Bits for Business platform
 */

/* ── Business Account ──────────────────────────────────────── */

export type BusinessCategory =
  | 'restaurant'
  | 'cafe'
  | 'gym'
  | 'wellness'
  | 'entertainment'
  | 'retail'
  | 'services'
  | 'events'
  | 'tourism'
  | 'other';

export type AccountType = 'consumer' | 'business';

export interface BusinessProfile {
  id: string;
  userId: string;
  businessName: string;
  category: BusinessCategory;
  description?: string;
  website?: string;
  phone?: string;
  email: string;
  location: {
    address: string;
    lat: number;
    lng: number;
    city: string;
    country: string;
  };
  logo?: {
    url: string;
    uploadedAt: string;
  };
  ownerId: string;
  teamMembers?: Record<string, 'owner' | 'admin' | 'editor' | 'viewer'>;
  socialLinks?: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    linkedin?: string;
  };
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verificationBadge?: boolean;
  createdAt: string;
  updatedAt: string;
  onboardingComplete: boolean;
}

/* ── Campaigns ────────────────────────────────────────────── */

export type CampaignStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'active'
  | 'paused'
  | 'ended'
  | 'rejected'
  | 'archived';

export type TargetingType = 'mood' | 'weather' | 'location' | 'interest' | 'time';

export interface CampaignTargeting {
  moods?: string[]; // e.g., ['relaxed', 'energetic', 'social']
  weatherConditions?: string[]; // e.g., ['sunny', 'rainy', 'cloudy']
  locationRadius?: number;
  locationName?: string;
  locations?: {
    lat: number;
    lng: number;
    radiusKm: number;
  }[];
  interests?: string[]; // mapped to user interest tags
  timeWindows?: Array<{
    day: string;
    startTime: string; // HH:mm
    endTime: string;
  }>;
}

export interface CampaignMedia {
  id: string;
  url: string;
  type: 'image' | 'video';
  aspectRatio: '9:16' | '16:9' | '1:1';
  uploadedAt: string;
  validated: boolean;
  // optional focal point for adjustable image positioning (0..1, normalized)
  focalX?: number;
  focalY?: number;
}

export interface Campaign {
  id: string;
  businessId: string;
  createdBy?: string;
  title: string;
  hook: string;
  description: string;
  mediaUrl?: string;
  // optional campaign-specific logo (overrides business logo in previews)
  logoUrl?: string;
  cta: {
    text: string; // e.g., "Book Now", "Download", "Visit"
    action: 'url' | 'phone' | 'qr' | 'calendar';
    value: string; // URL, phone number, QR code data, etc.
  };
  category: BusinessCategory;
  media: CampaignMedia[];
  targeting: CampaignTargeting;
  dateRange: {
    startDate: string; // ISO date
    endDate: string;
  };
  budget?: {
    daily?: number;
    total?: number;
    currency?: string;
  };
  status: CampaignStatus;
  approvalNotes?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  pausedAt?: string;
  endedAt?: string;
  metrics?: CampaignMetrics;
}

/* ── Campaign Analytics & Performance ────────────────────── */

export interface CampaignMetrics {
  impressions: number;
  clicks: number;
  engagements: number; // swipes, saves, interactions
  activityStarts: number;
  calendarAdds: number;
  conversions: number;
  qrScans?: number;
  uniqueUsers: number;
  ctr: number; // click-through rate
  conversionRate: number;
  lastUpdated: string;
}

export interface CampaignPerformanceData {
  campaignId: string;
  date: string;
  impressions: number;
  clicks: number;
  engagements: number;
  conversions: number;
  revenue?: number;
}

export interface AudienceInsight {
  campaignId: string;
  ageRanges: Record<string, number>; // { '18-25': 150, '26-35': 200 }
  topInterests: Array<{ interest: string; count: number }>;
  topActivityTypes: Array<{ activity: string; count: number }>;
  topLocations: Array<{ location: string; count: number }>;
  engagementByTime: Record<string, number>; // hour-based distribution
  weatherCorrelation: Record<string, number>; // { 'sunny': 0.8, 'rainy': 0.3 }
  moodCorrelation: Record<string, number>;
}

/* ── Approval Workflow ────────────────────────────────────── */

export type ApprovalStatus = 'pending' | 'approved' | 'changes_requested' | 'rejected';

export interface CampaignApproval {
  id: string;
  campaignId: string;
  businessId: string;
  status: ApprovalStatus;
  reviewedBy?: string; // admin user ID
  reviewedAt?: string;
  feedback?: string;
  changesRequested?: {
    field: string;
    reason: string;
  }[];
  estimatedReviewTime?: number; // hours
  createdAt: string;
  updatedAt: string;
}

/* ── Business Dashboard State ──────────────────────────────– */

export interface BusinessDashboardState {
  activeCampaigns: Campaign[];
  queuedCampaigns: Campaign[];
  draftCampaigns: Campaign[];
  archivedCampaigns: Campaign[];
  totalMetrics: {
    totalImpressions: number;
    totalClicks: number;
    totalConversions: number;
    totalRevenue?: number;
  };
  recentActivity: Array<{
    type: 'campaign_created' | 'campaign_approved' | 'campaign_rejected' | 'metrics_updated';
    campaignId?: string;
    timestamp: string;
    details: string;
  }>;
}

/* ── Monetization Models ────────────────────────────────────– */

export type PricingModel = 'cpm' | 'cpc' | 'conversion' | 'subscription' | 'hybrid';

export interface BillingAccount {
  businessId: string;
  pricingModel: PricingModel;
  monthlyBudget?: number;
  totalSpent: number;
  balance: number;
  paymentMethod?: string;
  invoices: Array<{
    id: string;
    date: string;
    amount: number;
    status: 'paid' | 'pending' | 'overdue';
  }>;
}

export interface PerformancePricing {
  costPerMille?: number; // CPM (cost per 1000 impressions)
  costPerClick?: number; // CPC
  costPerConversion?: number;
  conversionThreshold?: number; // min conversions to qualify
}
