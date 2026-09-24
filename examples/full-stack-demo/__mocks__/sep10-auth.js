'use strict';
// Stub matching the real sep10-auth API surface used by server.js.
// generateChallenge returns { transactionXDR, networkPassphrase, expiresAt }
// (the old shape { transaction, networkPassphrase } was removed).
module.exports = {
  createSep10Middleware: () => (_req, _res, next) => next(),
  generateChallenge: () => ({
    transactionXDR: 'stub-xdr',
    networkPassphrase: 'Test SDF Network ; September 2015',
    expiresAt: new Date(Date.now() + 300_000),
  }),
  verifyChallenge: () => ({ valid: false, error: 'stub — not a real challenge' }),
};
