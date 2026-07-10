'use strict';

const express = require('express');
const {
  getTile,
  getStats,
  clearCache,
  prefetchTiles,
  saveCustomSource,
  getTileSources
} = require('./tileProxy.service');

function createTileProxyRouter({ isAdminRequest }) {
  const router = express.Router();

  function requireAdmin(req, res, next) {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Admin login is required' });
    return next();
  }

  router.get('/sources', async (_req, res) => {
    const sources = await getTileSources();
    res.json({ sources: Object.values(sources).map(({ localDir, ...source }) => source) });
  });

  router.get('/stats', requireAdmin, getStats);
  router.post('/prefetch', requireAdmin, prefetchTiles);
  router.post('/sources', requireAdmin, async (req, res, next) => {
    try {
      const source = await saveCustomSource(req.body || {});
      res.status(201).json({ source });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to save tile source' });
    }
  });
  router.delete('/cache/:sourceId', requireAdmin, clearCache);
  router.delete('/cache', requireAdmin, clearCache);
  router.get('/:sourceId/:z/:x/:y.:ext', getTile);

  return router;
}

module.exports = { createTileProxyRouter };
