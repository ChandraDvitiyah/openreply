export function SkeletonBone({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`dashboard-skeleton ${className}`} />;
}

export function DashboardLoadingSkeleton({ metricCount = 4 }: { metricCount?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <SkeletonBone className="block h-7 w-36 rounded-lg" />
          <SkeletonBone className="block h-3 w-64 max-w-full rounded" />
        </div>
        <div className="flex gap-2">
          <SkeletonBone className="block h-9 w-28 rounded-full" />
          <SkeletonBone className="block h-9 w-24 rounded-full" />
        </div>
      </header>

      <section className={`grid grid-cols-2 gap-3 ${metricCount > 4 ? "lg:grid-cols-3 xl:grid-cols-6" : "xl:grid-cols-4"}`}>
        {Array.from({ length: metricCount }, (_, index) => (
          <article key={index} className="panel rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <SkeletonBone className="block h-3 w-20 rounded" />
              <SkeletonBone className="block h-8 w-8 rounded-lg" />
            </div>
            <SkeletonBone className="mt-4 block h-7 w-24 rounded-md" />
            <SkeletonBone className="mt-3 block h-3 w-32 max-w-full rounded" />
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <article key={index} className="panel rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <SkeletonBone className="block h-4 w-28 rounded" />
              <SkeletonBone className="block h-9 w-9 rounded-lg" />
            </div>
            <SkeletonBone className="mt-5 block h-7 w-20 rounded-md" />
            <SkeletonBone className="mt-5 block h-2 w-full rounded-full" />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <SkeletonBone className="block h-16 rounded-lg" />
              <SkeletonBone className="block h-16 rounded-lg" />
            </div>
          </article>
        ))}
      </section>

      <section className="panel overflow-hidden rounded-2xl">
        <div className="border-b border-[#e6e6e3] px-5 py-4">
          <SkeletonBone className="block h-4 w-40 rounded" />
          <SkeletonBone className="mt-2 block h-3 w-56 max-w-full rounded" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-4">
              <SkeletonBone className="block h-10 w-10 shrink-0 rounded-lg" />
              <SkeletonBone className="block h-4 flex-1 rounded" />
              <SkeletonBone className="block h-4 w-20 rounded" />
              <SkeletonBone className="hidden h-4 w-20 rounded sm:block" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function FormLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading page" className="mx-auto max-w-3xl space-y-5">
      {[0, 1, 2].map((section) => (
        <section key={section} className="panel rounded-2xl p-6">
          <SkeletonBone className="block h-5 w-36 rounded" />
          <SkeletonBone className="mt-2 block h-3 w-64 max-w-full rounded" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <SkeletonBone className="block h-11 rounded-lg" />
            <SkeletonBone className="block h-11 rounded-lg" />
            <SkeletonBone className="block h-20 rounded-lg sm:col-span-2" />
          </div>
          <SkeletonBone className="mt-5 block h-9 w-28 rounded-full" />
        </section>
      ))}
    </div>
  );
}

export function CampaignListLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading campaigns" className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <SkeletonBone className="block h-4 w-28 rounded" />
        <SkeletonBone className="block h-9 w-36 rounded-full" />
      </div>
      {[0, 1, 2].map((item) => (
        <article key={item} className="panel rounded-2xl p-5">
          <div className="flex gap-4">
            <SkeletonBone className="block h-20 w-28 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <SkeletonBone className="block h-5 w-48 max-w-full rounded" />
              <SkeletonBone className="mt-3 block h-3 w-72 max-w-full rounded" />
              <SkeletonBone className="mt-5 block h-3 w-full rounded" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function DetailLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading details" className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <SkeletonBone className="block h-7 w-52 max-w-full rounded" />
          <SkeletonBone className="block h-3 w-36 rounded" />
        </div>
        <SkeletonBone className="block h-9 w-28 rounded-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <section key={item} className="panel rounded-2xl p-6">
            <SkeletonBone className="block h-5 w-32 rounded" />
            <SkeletonBone className="mt-5 block h-12 w-full rounded-lg" />
            <SkeletonBone className="mt-3 block h-12 w-full rounded-lg" />
            <SkeletonBone className="mt-3 block h-32 w-full rounded-xl" />
          </section>
        ))}
      </div>
    </div>
  );
}

export function TableLoadingRows({ columns = 6, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-5 py-4">
              <SkeletonBone className={`block h-4 rounded ${column === 0 ? "w-32" : "ml-auto w-16"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function ConversationListLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading conversations" className="divide-y divide-[#e6e6e3]">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <SkeletonBone className="block h-4 w-28 rounded" />
            <SkeletonBone className="block h-3 w-10 rounded" />
          </div>
          <SkeletonBone className="mt-2 block h-3 w-4/5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function MessageLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading messages" className="space-y-3">
      {["w-2/3", "ml-auto w-1/2", "w-3/4", "ml-auto w-3/5"].map((width, index) => (
        <SkeletonBone key={index} className={`block h-14 rounded-xl ${width}`} />
      ))}
    </div>
  );
}

export function PostGridLoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading posts" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <SkeletonBone key={index} className="block aspect-square rounded-lg" />
      ))}
    </div>
  );
}

export function DashboardShellLoadingSkeleton() {
  return (
    <div className="dashboard-ui flex h-screen overflow-hidden bg-[#f7f7f5]" aria-busy="true" aria-label="Loading workspace">
      <aside className="hidden h-full w-64 shrink-0 border-r border-[#e6e6e3] bg-white lg:flex lg:flex-col">
        <div className="border-b border-[#e6e6e3] px-5 py-[18px]">
          <div className="flex items-center gap-3">
            <SkeletonBone className="block h-8 w-8 rounded-lg" />
            <SkeletonBone className="block h-4 w-16 rounded" />
          </div>
        </div>
        <div className="flex-1 space-y-2 px-3 py-4">
          {Array.from({ length: 9 }, (_, index) => (
            <SkeletonBone key={index} className={`block h-9 rounded-lg ${index === 0 ? "bg-[#dcebd2]" : ""}`} />
          ))}
        </div>
        <div className="border-t border-[#e6e6e3] px-5 py-4">
          <SkeletonBone className="block h-4 w-32 rounded" />
          <SkeletonBone className="mt-2 block h-3 w-24 rounded" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-between border-b border-[#e6e6e3] bg-white px-4 lg:px-8">
          <SkeletonBone className="block h-7 w-32 rounded-lg" />
          <SkeletonBone className="block h-8 w-8 rounded-full" />
        </header>
        <main className="flex-1 overflow-hidden">
          <div className="mx-auto max-w-[1440px] px-4 py-6 lg:px-8 lg:py-8">
            <DashboardLoadingSkeleton />
          </div>
        </main>
      </div>
    </div>
  );
}
