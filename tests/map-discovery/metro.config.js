const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(root, 'src'), path.join(root, 'node_modules')];
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('/theme/ThemeProvider') || moduleName.endsWith('/i18n/I18nProvider')) return { filePath: path.join(__dirname, 'contexts.tsx'), type: 'sourceFile' };
  if (moduleName.endsWith('/ads/NativeAdSlide')) return { filePath: path.join(__dirname, 'ad.tsx'), type: 'sourceFile' };
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
