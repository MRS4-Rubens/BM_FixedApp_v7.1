import type { JSX } from 'react';
import {
  GenericPageSkeleton,
  DashboardSkeleton,
  ListPageSkeleton,
  ReportsSkeleton,
  FormPageSkeleton,
  DetailPageSkeleton,
} from '@/components/app/skeletons/page-skeletons';

export function SkeletonGallery(): JSX.Element {
  return (
    <div className="space-y-8 pb-12">
      <div className="border-b pb-4">
        <h2 className="text-xl font-bold text-foreground">Skeleton Component Gallery</h2>
        <p className="text-sm text-muted-foreground">
          Visual preview of all deterministic loading skeletons used across the application.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          1. Generic Page Skeleton
        </h3>
        <GenericPageSkeleton label="Preview Generic Page Skeleton" />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          2. Dashboard Skeleton
        </h3>
        <DashboardSkeleton label="Preview Dashboard Skeleton" />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          3. List Page Skeleton (Invoices / Customers / Products)
        </h3>
        <ListPageSkeleton label="Preview List Page Skeleton" />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          4. Reports Skeleton
        </h3>
        <ReportsSkeleton label="Preview Reports Skeleton" />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          5. Form Page Skeleton (New / Edit Form)
        </h3>
        <FormPageSkeleton label="Preview Form Page Skeleton" />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          6. Detail Page Skeleton (Invoice View)
        </h3>
        <DetailPageSkeleton label="Preview Detail Page Skeleton" />
      </section>
    </div>
  );
}

