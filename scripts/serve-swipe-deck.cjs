'use strict';

// Isolated component server. Do not boot the app, load .env, or initialize auth.
const path = require('node:path');
const fs = require('node:fs');
const Metro = require('metro');
const { getDefaultConfig } = require('expo/metro-config');

async function main() {
  const root = path.resolve(__dirname, '..');
  const config = getDefaultConfig(root);
  config.maxWorkers = 2;
  // Metro's CLI normally inserts projectRoot here; the programmatic API does not.
  config.watchFolders = [root, ...config.watchFolders];
  config.server.port = Number(process.env.SWIPE_TEST_PORT || 8173);
  config.serializer.getModulesRunBeforeMainModule = () => [];
  config.serializer.getPolyfills = () => [];
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'react-native') moduleName = 'react-native-web';
    if (moduleName.endsWith('/state/AppState')) {
      return { type: 'sourceFile', filePath: path.join(root, 'tests/swipe-deck/AppState.stub.ts') };
    }
    return context.resolveRequest(context, moduleName, platform);
  };
  const { httpServer } = await Metro.runServer(config, {
    host: '127.0.0.1', watch: false,
    unstable_extraMiddleware: [(request, response, next) => {
      if (request.url === '/' || request.url === '/index.html') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(fs.readFileSync(path.join(root, 'tests/swipe-deck/index.html')));
      } else next();
    }],
  });
  console.log(`Swipe fixture ready at http://127.0.0.1:${config.server.port}`);
  const stop = () => httpServer.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
