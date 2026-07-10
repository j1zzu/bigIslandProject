'use strict';

const path = require('node:path');

const localTilesDir = process.env.LOCAL_TILES_DIR || 'C:\\island_imgs\\tile';

const baseTileSources = {
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    type: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ext: 'png',
    minZoom: 0,
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
    cache: true
  },
  googleRoads: {
    id: 'googleRoads',
    name: 'Google Roads',
    type: 'xyz',
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    ext: 'png',
    minZoom: 0,
    maxZoom: 20,
    attribution: 'Google',
    cache: true
  },
  googleSatellite: {
    id: 'googleSatellite',
    name: 'Google Satellite',
    type: 'xyz',
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    ext: 'jpg',
    minZoom: 0,
    maxZoom: 20,
    attribution: 'Google',
    cache: true
  },
  localIslandTiles: {
    id: 'localIslandTiles',
    name: 'Тайлы острова',
    type: 'xyz',
    localDir: path.resolve(localTilesDir),
    ext: 'png',
    minZoom: 12,
    maxZoom: 22,
    attribution: 'Локальные тайлы',
    cache: true
  }
};

module.exports = { baseTileSources };
