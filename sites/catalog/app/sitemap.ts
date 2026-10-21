import type { MetadataRoute } from 'next';
import { entries, isDemonstration, siteConfig } from '../lib/catalog';
export const dynamic='force-static';
export default function sitemap():MetadataRoute.Sitemap {return isDemonstration?[]:[{url:siteConfig.baseUrl},...entries().map(({record,dataset})=>({url:`${siteConfig.baseUrl}/records/${record.id}/`,lastModified:dataset.publication.createdAt}))];}
