// Konfiguracja Metro: domyślna z Expo (monorepo wykrywane automatycznie).
// EXPO_PUBLIC_DEMO=1 buduje wersję demo: Supabase i API zastępuje serwer działający w przeglądarce (src/demo).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_PUBLIC_DEMO === '1') {
  const redirects = new Map([
    [path.join(__dirname, 'src/lib/supabase.ts'), path.join(__dirname, 'src/demo/supabase.ts')],
    [path.join(__dirname, 'src/lib/api.ts'), path.join(__dirname, 'src/demo/api.ts')],
  ]);
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = context.resolveRequest(context, moduleName, platform);
    const target = resolved.type === 'sourceFile' ? redirects.get(resolved.filePath) : undefined;
    return target ? { type: 'sourceFile', filePath: target } : resolved;
  };
}

module.exports = config;
