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
  writeBatch,
  Timestamp,
  orderBy,
  limit,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { firebaseEnabled } from './firebase';

const db = getFirestore();
const auth = getAuth();

/**
 * Billing types
 */
export interface BillingAccount {
  id: string;
  businessId: string;
  status: 'active' | 'paused' | 'suspended';
  balance: number; // in smallest currency unit (cents for EUR)
  currency: string;
  pricingTier: 'standard' | 'premium' | 'enterprise';
  paymentMethodId?: string;
  totalSpent: number;
  monthlyBudget?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PaymentMethod {
  id: string;
  businessId: string;
  type: 'card' | 'bank_transfer' | 'paypal';
  last4: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  status: 'active' | 'expired' | 'declined';
  createdAt: Timestamp;
}

export interface Invoice {
  id: string;
  businessId: string;
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed';
  dueDate: Timestamp;
  paidAt?: Timestamp;
  items: {
    description: string;
    amount: number;
    campaignId?: string;
  }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Transaction {
  id: string;
  businessId: string;
  type: 'debit' | 'credit' | 'refund';
  amount: number;
  currency: string;
  description: string;
  campaignId?: string;
  invoiceId?: string;
  reference?: string;
  status: 'completed' | 'pending' | 'failed';
  createdAt: Timestamp;
}

/**
 * Create a billing account for a business
 * - Initialized with zero balance
 * - Default payment tier is 'standard'
 *
 * @param businessId - Business ID
 * @param initialBudget - Optional monthly budget limit
 * @returns The created BillingAccount
 */
export const createBillingAccount = async (
  businessId: string,
  initialBudget?: number
): Promise<BillingAccount> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const billingId = `bill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = Timestamp.now();

  const billingData: BillingAccount = {
    id: billingId,
    businessId,
    status: 'active',
    balance: 0,
    currency: 'EUR',
    pricingTier: 'standard',
    totalSpent: 0,
    monthlyBudget: initialBudget,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const docRef = doc(db, 'businesses', businessId, 'billing', billingId);
    await setDoc(docRef, billingData);
    return billingData;
  } catch (error) {
    console.error('Error creating billing account:', error);
    throw new Error(
      `Failed to create billing account: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get billing account for a business
 *
 * @param businessId - Business ID
 * @returns BillingAccount or null if not found
 */
export const getBillingAccount = async (businessId: string): Promise<BillingAccount | null> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'billing'),
      where('businessId', '==', businessId),
      limit(1)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      return null;
    }

    return snap.docs[0].data() as BillingAccount;
  } catch (error) {
    console.error('Error fetching billing account:', error);
    throw new Error(
      `Failed to fetch billing account: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Update billing account settings
 *
 * @param businessId - Business ID
 * @param billingId - Billing account ID
 * @param updates - Partial updates
 */
export const updateBillingAccount = async (
  businessId: string,
  billingId: string,
  updates: Partial<BillingAccount>
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'billing', billingId);

    const updatePayload: Record<string, any> = {
      updatedAt: Timestamp.now(),
    };

    if (updates.status) updatePayload.status = updates.status;
    if (updates.monthlyBudget !== undefined) updatePayload.monthlyBudget = updates.monthlyBudget;
    if (updates.pricingTier) updatePayload.pricingTier = updates.pricingTier;

    await updateDoc(docRef, updatePayload);
  } catch (error) {
    console.error('Error updating billing account:', error);
    throw new Error(
      `Failed to update billing account: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Add a payment method to a business
 *
 * @param businessId - Business ID
 * @param paymentMethod - Payment method details
 * @returns Payment method ID
 */
export const addPaymentMethod = async (
  businessId: string,
  paymentMethod: Omit<PaymentMethod, 'id' | 'businessId' | 'createdAt'>
): Promise<string> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const methodId = `pm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const methodData: PaymentMethod = {
    id: methodId,
    businessId,
    ...paymentMethod,
    createdAt: Timestamp.now(),
  };

  try {
    const docRef = doc(db, 'businesses', businessId, 'payment_methods', methodId);
    await setDoc(docRef, methodData);
    return methodId;
  } catch (error) {
    console.error('Error adding payment method:', error);
    throw new Error(
      `Failed to add payment method: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get payment methods for a business
 *
 * @param businessId - Business ID
 * @returns Array of payment methods
 */
export const getPaymentMethods = async (businessId: string): Promise<PaymentMethod[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'payment_methods'),
      where('status', '==', 'active')
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as PaymentMethod);
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    throw new Error(
      `Failed to fetch payment methods: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Remove a payment method (soft delete)
 *
 * @param businessId - Business ID
 * @param methodId - Payment method ID
 */
export const removePaymentMethod = async (businessId: string, methodId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'payment_methods', methodId);
    await updateDoc(docRef, {
      status: 'expired',
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Error removing payment method:', error);
    throw new Error(
      `Failed to remove payment method: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Set a payment method as default
 *
 * @param businessId - Business ID
 * @param methodId - Payment method ID to set as default
 */
export const setDefaultPaymentMethod = async (
  businessId: string,
  methodId: string
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const batch = writeBatch(db);

    // Get all current payment methods and unset their default
    const allMethods = await getPaymentMethods(businessId);
    allMethods.forEach((method) => {
      const docRef = doc(db, 'businesses', businessId, 'payment_methods', method.id);
      batch.update(docRef, { isDefault: false });
    });

    // Set new default
    const newDefaultRef = doc(db, 'businesses', businessId, 'payment_methods', methodId);
    batch.update(newDefaultRef, { isDefault: true });

    await batch.commit();
  } catch (error) {
    console.error('Error setting default payment method:', error);
    throw new Error(
      `Failed to set default payment method: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Create an invoice for campaign charges
 * - Usually created via Cloud Functions after campaign runs
 * - Can be created manually for adjustments
 *
 * @param businessId - Business ID
 * @param data - Invoice data
 * @returns Invoice ID
 */
export const createInvoice = async (
  businessId: string,
  data: Omit<Invoice, 'id' | 'businessId' | 'createdAt' | 'updatedAt'>
): Promise<string> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const now = Timestamp.now();

  const invoiceData: Invoice = {
    id: invoiceId,
    businessId,
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const docRef = doc(db, 'businesses', businessId, 'billing', 'invoices', invoiceId);
    await setDoc(docRef, invoiceData);
    return invoiceId;
  } catch (error) {
    console.error('Error creating invoice:', error);
    throw new Error(
      `Failed to create invoice: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get invoices for a business
 *
 * @param businessId - Business ID
 * @param limit - Max results
 * @returns Array of invoices (most recent first)
 */
export const getInvoices = async (businessId: string, limit_n: number = 50): Promise<Invoice[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'billing', 'invoices'),
      orderBy('createdAt', 'desc'),
      limit(limit_n)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Invoice);
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw new Error(
      `Failed to fetch invoices: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Mark invoice as paid
 *
 * @param businessId - Business ID
 * @param invoiceId - Invoice ID
 */
export const markInvoiceAsPaid = async (businessId: string, invoiceId: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const docRef = doc(db, 'businesses', businessId, 'billing', 'invoices', invoiceId);
    await updateDoc(docRef, {
      status: 'paid',
      paidAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    console.error('Error marking invoice as paid:', error);
    throw new Error(
      `Failed to mark invoice as paid: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Record a transaction (debit, credit, refund)
 * - Used for campaign charges and refunds
 *
 * @param businessId - Business ID
 * @param data - Transaction details
 * @returns Transaction ID
 */
export const recordTransaction = async (
  businessId: string,
  data: Omit<Transaction, 'id' | 'businessId' | 'createdAt'>
): Promise<string> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const transactionData: Transaction = {
    id: transactionId,
    businessId,
    ...data,
    createdAt: Timestamp.now(),
  };

  try {
    const docRef = doc(db, 'businesses', businessId, 'billing', 'transactions', transactionId);
    await setDoc(docRef, transactionData);

    // Update billing account balance
    const billingAccount = await getBillingAccount(businessId);
    if (billingAccount) {
      let newBalance = billingAccount.balance;

      if (data.type === 'debit') {
        newBalance -= data.amount;
      } else if (data.type === 'credit' || data.type === 'refund') {
        newBalance += data.amount;
      }

      await updateBillingAccount(businessId, billingAccount.id, {
        balance: newBalance,
        totalSpent: billingAccount.totalSpent + (data.type === 'debit' ? data.amount : 0),
      });
    }

    return transactionId;
  } catch (error) {
    console.error('Error recording transaction:', error);
    throw new Error(
      `Failed to record transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get transaction history for a business
 *
 * @param businessId - Business ID
 * @param limit - Max results
 * @returns Array of transactions (most recent first)
 */
export const getTransactionHistory = async (
  businessId: string,
  limit_n: number = 100
): Promise<Transaction[]> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const q = query(
      collection(db, 'businesses', businessId, 'billing', 'transactions'),
      orderBy('createdAt', 'desc'),
      limit(limit_n)
    );
    const snap = await getDocs(q);
    return snap.docs.map((doc) => doc.data() as Transaction);
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    throw new Error(
      `Failed to fetch transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Get account balance
 *
 * @param businessId - Business ID
 * @returns Current balance in EUR cents
 */
export const getAccountBalance = async (businessId: string): Promise<number> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  const billingAccount = await getBillingAccount(businessId);
  return billingAccount?.balance || 0;
};

/**
 * Calculate estimated cost for a campaign
 * - Based on bid type, bid amount, and expected reach
 *
 * @param bidAmount - Bid amount in EUR
 * @param bidType - 'CPM', 'CPC', or 'conversion'
 * @param estimatedReach - Number of impressions/clicks/conversions
 * @returns Estimated cost in EUR
 */
export const calculateEstimatedCost = (
  bidAmount: number,
  bidType: 'CPM' | 'CPC' | 'conversion',
  estimatedReach: number
): number => {
  if (bidType === 'CPM') {
    // Cost per 1000 impressions
    return (estimatedReach / 1000) * bidAmount;
  } else if (bidType === 'CPC') {
    // Cost per click
    return estimatedReach * bidAmount;
  } else {
    // Cost per conversion
    return estimatedReach * bidAmount;
  }
};

/**
 * Apply a promotional code (credit)
 *
 * @param businessId - Business ID
 * @param promoCode - Promotional code
 * @param amount - Credit amount in EUR cents
 */
export const applyPromoCode = async (
  businessId: string,
  promoCode: string,
  amount: number
): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    await recordTransaction(businessId, {
      type: 'credit',
      amount,
      currency: 'EUR',
      description: `Promo code applied: ${promoCode}`,
      status: 'completed',
      reference: promoCode,
    });
  } catch (error) {
    console.error('Error applying promo code:', error);
    throw new Error(
      `Failed to apply promo code: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Suspend a billing account (e.g., for fraud or non-payment)
 *
 * @param businessId - Business ID
 * @param reason - Suspension reason
 */
export const suspendBillingAccount = async (businessId: string, reason: string): Promise<void> => {
  if (!firebaseEnabled) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const billingAccount = await getBillingAccount(businessId);
    if (!billingAccount) {
      throw new Error('Billing account not found');
    }

    const batch = writeBatch(db);

    // Update billing account status
    const billingRef = doc(db, 'businesses', businessId, 'billing', billingAccount.id);
    batch.update(billingRef, {
      status: 'suspended',
      updatedAt: Timestamp.now(),
    });

    // Pause all active campaigns
    const campaignsRef = collection(db, 'businesses', businessId, 'campaigns');
    const activeCampaignsQ = query(
      campaignsRef,
      where('status', 'in', ['active', 'approved'])
    );
    const campaignsSnap = await getDocs(activeCampaignsQ);

    campaignsSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'paused',
        pausedReason: `Account suspended: ${reason}`,
      });
    });

    // Record transaction
    const transactionRef = doc(
      db,
      'businesses',
      businessId,
      'billing',
      'transactions',
      `txn_suspend_${Date.now()}`
    );
    batch.set(transactionRef, {
      type: 'debit',
      amount: 0,
      currency: 'EUR',
      description: `Account suspended: ${reason}`,
      status: 'completed',
      createdAt: Timestamp.now(),
    });

    await batch.commit();
  } catch (error) {
    console.error('Error suspending billing account:', error);
    throw new Error(
      `Failed to suspend account: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};
