"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Mail, CheckCircle, Loader2, Sparkles } from "lucide-react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error("Subscription failed");
      }

      setEmail("");
      setIsSuccess(true);
      toast({
        title: "🎉 You're on the list!",
        description:
          "We'll notify you when IntuneGet is ready. Check your email for confirmation!",
      });

      // Reset success state after 3 seconds
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form
        onSubmit={handleSubmit}
        className="flex w-full items-center space-x-0 sm:space-x-3 flex-col sm:flex-row space-y-3 sm:space-y-0"
      >
        <div className="relative flex-1 w-full group">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg blur opacity-25 group-hover:opacity-40 transition duration-300"></div>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 z-10" />
            <Input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading || isSuccess}
              className="bg-white/95 backdrop-blur-sm border-gray-200 hover:border-blue-300 focus:border-blue-500 h-14 pl-11 pr-4 text-base w-full transition-all duration-300 shadow-soft hover:shadow-lg focus:shadow-glow"
            />
          </div>
        </div>

        <div className="relative w-full sm:w-auto">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-300"></div>
          <Button
            type="submit"
            disabled={isLoading || isSuccess}
            className={`relative h-14 px-8 text-base font-semibold w-full sm:w-auto transition-all duration-300 transform hover:scale-105 ${
              isSuccess
                ? "bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-glow"
                : "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 shadow-glow"
            } text-white border-0`}
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Joining...</span>
              </div>
            ) : isSuccess ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                <span>Successfully Joined!</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                <span>Join Waitlist</span>
              </div>
            )}
          </Button>
        </div>
      </form>

      {/* Additional info */}
      <div className="mt-4 text-center">
        <p className="text-sm text-gray-500 animate-fade-in animation-delay-500">
          <span className="inline-flex items-center gap-1">
            <span>🔒</span>
            <span>No spam, unsubscribe at any time</span>
          </span>
          <span className="mx-2 text-gray-300">•</span>
          <span className="inline-flex items-center gap-1">
            <span>⚡</span>
            <span>Get early access</span>
          </span>
        </p>
      </div>
    </div>
  );
}
