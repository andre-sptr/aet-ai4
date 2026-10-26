import manifest from '../../../../../data/routes.json';
import PublicDetail from '../../../components/PublicDetail';

export const dynamicParams = false;
export function generateStaticParams() { return manifest.events.map(item => ({ id: item.id })); }
export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicDetail kind="events" routeKey={id} />;
}
