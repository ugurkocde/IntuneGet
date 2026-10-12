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
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-24 lg:px-8 lg:pt-28"
      >
        <p role="status" className="sr-only">
          <T>Loading catalog release history</T>
        </p>
        <div aria-hidden="true">
          <div className="mb-6">
            <div className={`${bone} mb-4 h-5 w-48`} />
            <div className={`${bone} h-10 w-full max-w-md`} />
            <div className={`${bone} mt-3 h-6 w-full max-w-3xl`} />
            <div className={`${bone} mt-4 h-5 w-96 max-w-full`} />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-overlay/10 bg-overlay/10 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-bg-elevated px-4 py-3 sm:px-5">
                <div className={`${bone} h-4 w-4/5`} />
                <div className={`${bone} mt-2 h-7 w-2/3`} />
              </div>
            ))}
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-overlay/10 bg-bg-elevated p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            {[0, 1, 2].map((i) => (
              <div key={i} className={i === 0 ? "col-span-2 lg:col-span-1" : ""}>
                <div className={`${bone} mb-1.5 h-5 w-24`} />
                <div className={`${bone} h-11 w-full`} />
              </div>
            ))}
            <div className={`${bone} col-span-2 h-11 w-full lg:col-span-1 lg:w-32`} />
            <div className={`${bone} col-span-2 h-6 w-52 lg:col-span-4`} />
          </div>
          <div className="grid gap-2 lg:grid-cols-[130px_1fr] lg:gap-3">
            <div className={`${bone} my-2 h-5 w-28 lg:mt-3`} />
            <div className="min-w-0 divide-y divide-overlay/10 rounded-xl border border-overlay/10 bg-bg-elevated">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-3 px-4 py-3">
                  <div className={`${bone} h-8 w-8 shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className={`${bone} h-6 w-48 max-w-full`} />
                      <div className={`${bone} h-6 w-36`} />
                    </div>
                    <div className={`${bone} mt-1.5 h-6 w-4/5`} />
                  </div>
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
