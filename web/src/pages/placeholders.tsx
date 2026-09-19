import { EmptyState } from '../components/states';

/** Заглушки для разделов Phase 2B (suppliers/nomenclature/vehicles). */
function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <section>
      <h1 className="page-title">{title}</h1>
      <EmptyState title="Раздел в разработке" hint="Будет реализован на следующем этапе (Phase 2B)." />
    </section>
  );
}

export const SuppliersPage = (): JSX.Element => <Placeholder title="Поставщики" />;
export const NomenclaturePage = (): JSX.Element => <Placeholder title="Номенклатура" />;
export const VehiclesPage = (): JSX.Element => <Placeholder title="Автопарк" />;
