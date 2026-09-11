import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { T } from "gt-next";

const bone = "rounded-md bg-overlay/[0.08] motion-safe:animate-pulse";
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <main
        id="main-content"
        aria-busy="true"
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-28 lg:px-8 lg:pt-36"
      >
        <p role="status" className="sr-only">
          <T>Loading catalog release history</T>
        </p>
        <div aria-hidden="true">
          <div className="mb-10">
            <div>
              <div className={`${bone} h-5 w-24`} />
              <div className={`${bone} mb-3 mt-6 h-4 w-44`} />
              <div className={`${bone} h-12 w-full max-w-lg`} />
              <div className={`${bone} mt-5 h-6 w-full`} />
              <div className={`${bone} mt-2 h-6 w-3/4`} />
            </div>
            <div className={`${bone} mt-5 h-5 w-72 max-w-full`} />
          </div>
          <div className="mb-8 grid grid-cols-1 divide-y min-[360px]:grid-cols-3 min-[360px]:divide-y-0 min-[360px]:divide-x divide-overlay/10 rounded-xl border border-overlay/10 bg-bg-elevated">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-3 py-5 sm:px-6">
                <div className={`${bone} h-5 w-4/5`} />
                <div className={`${bone} mt-2 h-9 w-2/3`} />
              </div>
            ))}
          </div>
          <div className="mb-5 grid gap-4 rounded-xl border border-overlay/10 bg-bg-elevated p-5 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            {[0, 1, 2].map((i) => (
              <div key={i} className={i === 0 ? "lg:col-span-2" : ""}>
                <div className={`${bone} mb-2 h-5 w-24`} />
                <div className={`${bone} h-11 w-full`} />
              </div>
            ))}
            <div className={`${bone} h-11 w-52 sm:col-span-2 lg:col-span-3`} />
            <div className={`${bone} h-11 w-full lg:w-32`} />
          </div>
          <div className={`${bone} mb-10 h-5 w-3/4`} />
          <div className="grid gap-3 lg:grid-cols-[130px_1fr]">
            <div className={`${bone} mt-4 h-5 w-28`} />
            <div className="min-w-0 divide-y divide-overlay/10 rounded-xl border border-overlay/10 bg-bg-elevated">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[32px_minmax(0,1fr)_auto]">
                  <div className={`${bone} col-start-1 row-start-1 row-span-3 h-8 w-8`} />
                  <div className={`${bone} col-start-2 row-start-1 h-7 w-3/4`} />
                  <div className={`${bone} col-start-2 h-7 w-36 sm:col-start-3 sm:row-start-1`} />
                  <div className={`${bone} col-start-2 h-5 w-3/5 sm:row-start-2`} />
                  <div className={`${bone} col-start-2 h-6 w-3/4 max-w-full sm:col-[2/-1] sm:row-start-3`} />
                  <div className={`${bone} col-start-2 h-5 w-24`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
