import type { NextConfig } from 'next';

const config: NextConfig = {
  // Pakiety domenowe są w TypeScript (importy z rozszerzeniem .ts) — Next kompiluje je razem z aplikacją.
  transpilePackages: ['@mp-power/core', '@mp-power/ai'],
};

export default config;
