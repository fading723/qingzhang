const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const previous = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
  ...['.tools', 'artifacts', 'dist'].map((directory) => {
    const absolute = path.join(__dirname, directory).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${absolute}(?:[/\\\\]|$)`);
  }),
];

module.exports = config;
