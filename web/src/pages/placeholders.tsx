import { useParams } from 'react-router-dom';
import { EmptyState } from '../components/states';

/** Заглушки для маршрутов Phase 2 (реально реализованы только /login и /dashboard). */
function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <EmptyState title="Раздел в разработке" hint="Будет реализован в следующем этапе фронтенда (Phase 2)." />
    </section>
  );
}

export const InvoicesPage = (): JSX.Element => <Placeholder title="Накладные" />;
export const SuppliersPage = (): JSX.Element => <Placeholder title="Поставщики" />;
export const NomenclaturePage = (): JSX.Element => <Placeholder title="Номенклатура" />;
export const VehiclesPage = (): JSX.Element => <Placeholder title="Автопарк" />;

export function InvoiceDetailPage(): JSX.Element {
  const { id } = useParams();
  return <Placeholder title={`Накладная ${id ?? ''}`} />;
}
