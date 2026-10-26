import manifest from '../../../../../data/routes.json';
import PublicDetail from '../../../components/PublicDetail';

export const dynamicParams = false;
export function generateStaticParams() { return manifest.news.map(item => ({ slug: item.slug })); }
export default async function NewsDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicDetail kind="news" routeKey={slug} />;
}
