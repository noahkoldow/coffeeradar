"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAdminRole = void 0;
/** The same custom claim enforced by Firestore rules. Email and request data are irrelevant. */
const hasAdminRole = (auth) => auth?.token?.admin === true;
exports.hasAdminRole = hasAdminRole;
