import type { NextFunction, Request, Response } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { createSep10Middleware } from '../src/middleware';
import { Sep10MiddlewareOptions } from '../src/middleware';
import * as verifyModule from '../src/verify';
import { RevocationStore } from '../src/revocation';

const serverKeypair = Keypair.random();
const serverAccountId = serverKeypair.publicKey();

const options: Sep10MiddlewareOptions = {
  serverAccountId,
  homeDomains: 'example.com',
  webAuthDomain: 'example.com',
};

function makeReq(authHeader: string | undefined): Request {
  return {
    header: (name: string) => (name === 'Authorization' ? authHeader : undefined),
    ip: '127.0.0.1',
    path: '/compliance',
  } as unknown as Request;
}

function makeRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('createSep10Middleware', () => {
  describe('malformed Authorization header', () => {
    it.each([
      ['a non-Bearer scheme', 'Basic abc123'],
      ['an empty header', ''],
      ['Bearer with no token', 'Bearer'],
      ['Bearer with only trailing whitespace', 'Bearer '],
      ['a header with no Authorization at all', undefined],
    ])('returns 401 with "missing bearer token" for %s', async (_description, authHeader) => {
      const middleware = createSep10Middleware(options);
      const req = makeReq(authHeader);
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        reason: 'missing bearer token',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('maxTokenLength option', () => {
    it('rejects bearer tokens exceeding default maxTokenLength (8192)', async () => {
      const middleware = createSep10Middleware(options);
      const oversizedToken = 'a'.repeat(8193);
      const req = makeReq(`Bearer ${oversizedToken}`);
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        reason: 'bearer token too large',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects bearer tokens exceeding custom maxTokenLength', async () => {
      const mockLogger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
      const middleware = createSep10Middleware({
        ...options,
        maxTokenLength: 100,
        logger: mockLogger,
      });
      const req = makeReq(`Bearer ${'a'.repeat(101)}`);
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        reason: 'bearer token too large',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'sep10-auth: bearer token exceeds maximum length',
        expect.objectContaining({ length: 101 }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('challenge verification branches', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('sets req.stellarAddress and calls next() on successful verification', async () => {
      const clientAddress = Keypair.random().publicKey();
      jest.spyOn(verifyModule, 'verifyChallenge').mockReturnValue({
        valid: true,
        address: clientAddress,
      });

      const mockLogger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
      const middleware = createSep10Middleware({
        ...options,
        logger: mockLogger,
      });
      const req = makeReq('Bearer valid-xdr');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(req.stellarAddress).toBe(clientAddress);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'sep10-auth: request authenticated',
        expect.objectContaining({ address: clientAddress }),
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 401 when verifyChallenge returns valid: false', async () => {
      jest.spyOn(verifyModule, 'verifyChallenge').mockReturnValue({
        valid: false,
        address: '',
        error: 'Transaction has expired',
      });

      const mockLogger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
      const middleware = createSep10Middleware({
        ...options,
        logger: mockLogger,
      });
      const req = makeReq('Bearer expired-xdr');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        reason: 'Transaction has expired',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'sep10-auth: challenge verification failed',
        expect.objectContaining({ reason: 'Transaction has expired' }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('revocationStore integration', () => {
    const clientAddress = Keypair.random().publicKey();

    beforeEach(() => {
      jest.spyOn(verifyModule, 'verifyChallenge').mockReturnValue({
        valid: true,
        address: clientAddress,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns 401 "address revoked" when isRevoked returns true', async () => {
      const mockStore: RevocationStore = {
        isRevoked: jest.fn().mockResolvedValue(true),
        revoke: jest.fn(),
        unrevoke: jest.fn(),
      };
      const mockLogger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };

      const middleware = createSep10Middleware({
        ...options,
        revocationStore: mockStore,
        logger: mockLogger,
      });
      const req = makeReq('Bearer some-xdr');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(mockStore.isRevoked).toHaveBeenCalledWith(clientAddress);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        reason: 'address revoked',
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'sep10-auth: address is revoked',
        expect.objectContaining({ address: clientAddress }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('sets req.stellarAddress and calls next() when isRevoked returns false', async () => {
      const mockStore: RevocationStore = {
        isRevoked: jest.fn().mockResolvedValue(false),
        revoke: jest.fn(),
        unrevoke: jest.fn(),
      };

      const middleware = createSep10Middleware({
        ...options,
        revocationStore: mockStore,
      });
      const req = makeReq('Bearer some-xdr');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(mockStore.isRevoked).toHaveBeenCalledWith(clientAddress);
      expect(req.stellarAddress).toBe(clientAddress);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next(error) when isRevoked throws or rejects', async () => {
      const storeError = new Error('Database connection failed');
      const mockStore: RevocationStore = {
        isRevoked: jest.fn().mockRejectedValue(storeError),
        revoke: jest.fn(),
        unrevoke: jest.fn(),
      };
      const mockLogger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };

      const middleware = createSep10Middleware({
        ...options,
        revocationStore: mockStore,
        logger: mockLogger,
      });
      const req = makeReq('Bearer some-xdr');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      await middleware(req, res, next);

      expect(mockStore.isRevoked).toHaveBeenCalledWith(clientAddress);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'sep10-auth: revocation store lookup failed',
        storeError,
      );
      expect(next).toHaveBeenCalledWith(storeError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
