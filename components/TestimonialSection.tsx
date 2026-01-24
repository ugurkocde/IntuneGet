"use client";

import { Users, TrendingUp, Shield } from "lucide-react";

const stats = [
  {
    icon: Users,
    value: "500+",
    label: "Early Adopters",
    description: "IT professionals already signed up",
  },
  {
    icon: TrendingUp,
    value: "1000+",
    label: "Apps Available",
    description: "Through Winget integration",
  },
  {
    icon: Shield,
    value: "100%",
    label: "Secure",
    description: "Enterprise-grade security",
  },
];

export function TestimonialSection() {
  return (
    <section className="relative w-full py-16 md:py-24 lg:py-32 bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/30 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-grid-gray-100/25 [mask-image:radial-gradient(white,transparent_85%)]" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-100 rounded-full mix-blend-multiply blur-3xl opacity-30 animate-blob" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-100 rounded-full mix-blend-multiply blur-3xl opacity-30 animate-blob animation-delay-2000" />

      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        {/* Stats Section */}
        <div className="text-center animate-fade-up">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl gradient-text-blue mb-4">
            Trusted by IT Professionals
          </h2>
          <p className="mx-auto max-w-[700px] text-lg text-gray-600 mb-12">
            Join hundreds of IT professionals who are already excited about
            IntuneGet
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {stats.map((stat, index) => (
              <div
                key={index}
                className="group p-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-soft hover:shadow-xl transition-all duration-300 hover-lift animate-fade-up"
                style={
                  {
                    "--animation-delay": `${(index + 1) * 200}ms`,
                  } as React.CSSProperties
                }
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-4 p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl text-white group-hover:scale-110 transition-transform duration-300">
                    <stat.icon className="h-6 w-6" />
                  </div>
                  <div className="text-3xl font-bold gradient-text-blue mb-2">
                    {stat.value}
                  </div>
                  <div className="text-lg font-semibold text-gray-900 mb-1">
                    {stat.label}
                  </div>
                  <div className="text-sm text-gray-600">
                    {stat.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
