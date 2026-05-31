import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

// next-intl v4 plugin — wires up i18n/request.ts for server-side message loading.
// Source: https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // No other config options needed for Phase 1 foundations.
}

export default withNextIntl(nextConfig)
