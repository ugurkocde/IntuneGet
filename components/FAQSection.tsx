"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "What is IntuneGet and how does it work?",
    answer:
      "IntuneGet is a powerful tool that bridges the gap between Winget and Microsoft Intune. It automatically packages applications from the Winget repository and uploads them to your Intune environment, streamlining your app deployment process with just a few clicks.",
  },
  {
    question: "Is IntuneGet really free and open source?",
    answer:
      "Yes! IntuneGet is completely free and open source. You can use it without any cost, modify it to fit your needs, and contribute to its development. We believe in making IT management tools accessible to everyone.",
  },
  {
    question: "Which applications are supported?",
    answer:
      "IntuneGet supports over 1000+ applications available in the Winget repository. This includes popular software like browsers, productivity tools, development environments, and enterprise applications. The list is constantly growing as new apps are added to Winget.",
  },
  {
    question: "Do I need special permissions to use IntuneGet?",
    answer:
      "You'll need appropriate permissions in your Entra ID and Intune environment to upload and manage applications. Typically, this requires Intune Administrator or Application Administrator roles. We provide detailed documentation on the required permissions.",
  },
  {
    question: "How secure is the deployment process?",
    answer:
      "Security is our top priority. IntuneGet uses Microsoft's official APIs and follows enterprise security best practices. All communications are encrypted, and we never store your credentials. The tool integrates seamlessly with Entra ID authentication.",
  },
  {
    question: "Can I self-host IntuneGet?",
    answer:
      "Yes! IntuneGet is fully open source and can be self-hosted on your own infrastructure. Check out our documentation for detailed setup instructions, or use our hosted service for a hassle-free experience.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="relative w-full py-16 md:py-24 lg:py-32 bg-white overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-grid-gray-100/25 [mask-image:radial-gradient(white,transparent_85%)]" />
      <div className="absolute top-1/2 left-0 w-96 h-96 bg-blue-50 rounded-full mix-blend-multiply blur-3xl opacity-50 animate-blob" />
      <div className="absolute top-1/2 right-0 w-96 h-96 bg-purple-50 rounded-full mix-blend-multiply blur-3xl opacity-50 animate-blob animation-delay-2000" />

      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        <div className="text-center mb-12 animate-fade-up">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-4 py-2 mb-6">
            <HelpCircle className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-600">
              Frequently Asked Questions
            </span>
          </div>
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl gradient-text-blue mb-4">
            Everything You Need to Know
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Get answers to the most common questions about IntuneGet and how it
            can transform your app deployment workflow.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="group bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl shadow-soft hover:shadow-lg transition-all duration-300 animate-fade-up"
              style={
                {
                  "--animation-delay": `${(index + 1) * 100}ms`,
                } as React.CSSProperties
              }
            >
              <button
                onClick={() => toggleFAQ(index)}
                aria-expanded={openIndex === index}
                aria-controls={`faq-answer-${index}`}
                className="w-full px-6 py-6 text-left flex items-center justify-between hover:bg-gray-50/50 rounded-2xl transition-colors duration-200"
              >
                <h3 id={`faq-question-${index}`} className="text-lg font-semibold text-gray-900 pr-4">
                  {faq.question}
                </h3>
                <div
                  className={`flex-shrink-0 transition-transform duration-300 ${
                    openIndex === index ? "rotate-180" : ""
                  }`}
                >
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                </div>
              </button>

              <div
                id={`faq-answer-${index}`}
                role="region"
                aria-labelledby={`faq-question-${index}`}
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  openIndex === index
                    ? "max-h-96 opacity-100"
                    : "max-h-0 opacity-0"
                }`}
              >
                <div className="px-6 pb-6">
                  <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent mb-4" />
                  <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
