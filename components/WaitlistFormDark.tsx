"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Mail, CheckCircle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function WaitlistFormDark() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const shouldReduceMotion = useReducedMotion();

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
        title: "You're on the list!",
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
        className="flex w-full items-center gap-3 flex-col sm:flex-row"
      >
        {/* Input wrapper with glow effect */}
        <div className="relative flex-1 w-full group">
          <motion.div
            className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-accent-cyan/50 to-accent-violet/50 opacity-0 blur-sm transition-opacity duration-300 group-focus-within:opacity-100"
            animate={
              shouldReduceMotion
                ? {}
                : {
                    opacity: [0, 0.3, 0],
                  }
            }
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-zinc-500 z-10" />
            <Input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading || isSuccess}
              className={cn(
                "relative h-14 pl-12 pr-4 text-base w-full",
                "bg-bg-surface/80 border-white/10 text-white placeholder:text-zinc-500",
                "focus:border-accent-cyan/50 focus:ring-accent-cyan/20",
                "transition-all duration-300",
                "hover:border-white/20"
              )}
            />
          </div>
        </div>

        {/* Submit button */}
        <motion.div
          className="w-full sm:w-auto"
          whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
          whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
        >
          <Button
            type="submit"
            disabled={isLoading || isSuccess}
            className={cn(
              "relative h-14 px-8 text-base font-semibold w-full sm:w-auto",
              "transition-all duration-300",
              isSuccess
                ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                : "bg-accent-cyan hover:bg-accent-cyan-bright text-bg-deepest",
              "shadow-lg hover:shadow-glow-cyan"
            )}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Joining...</span>
              </span>
            ) : isSuccess ? (
              <span className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                <span>Joined!</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                <span>Join Waitlist</span>
              </span>
            )}
          </Button>
        </motion.div>
      </form>

      {/* Info text */}
      <div className="mt-4 text-center">
        <p className="text-sm text-zinc-500">
          <span className="inline-flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            No spam, unsubscribe anytime
          </span>
          <span className="mx-3 text-zinc-700">|</span>
          <span className="inline-flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan" />
            Get early access
          </span>
        </p>
      </div>
    </div>
  );
}
