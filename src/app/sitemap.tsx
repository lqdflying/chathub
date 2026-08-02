import { MetadataRoute } from 'next';

import { LAST_MODIFIED, Sitemap, SitemapType } from '@/server/sitemap';

// Sitemap缓存配置 - 24小时重新验证
export const revalidate = 86_400; // 24小时 - 内容页面缓存
export const dynamic = 'force-static';

export const generateSitemapLink = (url: string) =>
  ['<sitemap>', `<loc>${url}</loc>`, `<lastmod>${LAST_MODIFIED}</lastmod>`, '</sitemap>'].join(
    '\n',
  );

export function generateSitemaps() {
  return new Sitemap().sitemapIndexs;
}

export default async function sitemap({ id }: { id: string }): Promise<MetadataRoute.Sitemap> {
  const sitemapModule = new Sitemap();

  if (id === SitemapType.Pages) return sitemapModule.getPage();

  return [];
}
