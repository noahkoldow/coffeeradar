const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(root, 'src'), path.join(root, 'assets'), path.join(root, 'node_modules')];
const releaseRoot = process.env.SESSION_MAP_RELEASE_ROOT;
if (releaseRoot) config.watchFolders.push(path.join(releaseRoot, 'src'), path.join(releaseRoot, 'assets'), path.join(releaseRoot, 'node_modules'));
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('/theme/ThemeProvider') || moduleName.endsWith('/i18n/I18nProvider')) return { filePath: path.join(__dirname, 'contexts.tsx'), type: 'sourceFile' };
  if (moduleName.endsWith('/ads/NativeAdSlide')) return { filePath: path.join(__dirname, 'ad.tsx'), type: 'sourceFile' };
  if (releaseRoot && moduleName.endsWith('/components/SwipeDeck')) return { filePath: path.join(releaseRoot, 'src/components/SwipeDeck.tsx'), type: 'sourceFile' };
  if (releaseRoot && /^(react|react-dom|react-native|react-native-web)(\/|$)/.test(moduleName)) return context.resolveRequest({ ...context, originModulePath: path.join(root, 'index.ts') }, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
