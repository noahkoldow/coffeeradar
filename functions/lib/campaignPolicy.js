"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mayManageBusiness = void 0;
exports.campaignWindow = campaignWindow;
exports.redemptionLimits = redemptionLimits;
exports.canRedeemCampaign = canRedeemCampaign;
const mayManageBusiness = (business, uid) => business?.ownerId === uid || ['owner', 'admin', 'editor'].includes(business?.teamMembers?.[uid]);
exports.mayManageBusiness = mayManageBusiness;
function campaignWindow(campaign, now = Date.now()) {
    const start = Date.parse(campaign?.dateRange?.startDate || '');
    const end = Date.parse(campaign?.dateRange?.endDate || '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        throw new Error('Campaign dates are invalid.');
    if (campaign.status !== 'active' || start > now || end <= now)
        throw new Error('This campaign is not currently available.');
    return { start, end };
}
function redemptionLimits(campaign) {
    const perUser = campaign?.redemptionRules?.maxPerUser ?? 1;
    const total = campaign?.redemptionRules?.maxTotal ?? 1000;
    if (!Number.isInteger(perUser) || perUser < 1 || perUser > 20 || !Number.isInteger(total) || total < 1 || total > 1_000_000) {
        throw new Error('Redemption limits are invalid.');
    }
    return { perUser, total };
}
function canRedeemCampaign(campaign, business, now = Date.now()) {
    if (business?.verificationStatus !== 'verified')
        throw new Error('This business is not verified.');
    const window = campaignWindow(campaign, now);
    if (!campaign.retrieveOffer || !['qr', 'code'].includes(campaign.retrieveOffer.type) || !campaign.retrieveOffer.value?.trim())
        throw new Error('This campaign has no redeemable offer.');
    return { ...window, ...redemptionLimits(campaign) };
}
