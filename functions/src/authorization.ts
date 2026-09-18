/** The same custom claim enforced by Firestore rules. Email and request data are irrelevant. */
export const hasAdminRole = (auth: { token?: Record<string, unknown> } | null | undefined): boolean =>
  auth?.token?.admin === true;
