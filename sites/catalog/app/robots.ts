import type { MetadataRoute } from 'next';
import { isDemonstration, siteConfig } from '../lib/catalog';
export const dynamic = 'force-static';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', ...(isDemonstration ? { disallow: '/' } : { allow: '/' }) },
    ...(!isDemonstration ? { sitemap: `${siteConfig.baseUrl}/sitemap.xml` } : {}),
  };
}
