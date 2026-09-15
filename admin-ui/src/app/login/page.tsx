"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, User, Lock } from "lucide-react";
import { adminLogin, setAdminToken } from "@/lib/auth";

export default function AdminLoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const token = await adminLogin({ username, password });
      setAdminToken(token);
      router.replace("/");
    } catch (err: any) {
      setError(err?.message || "Invalid username or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-chalk flex flex-col items-center justify-center p-6 font-body">
      <div className="max-w-md w-full bg-surface border border-border p-10 rounded-2xl shadow-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-ink rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-accent" />
          </div>
          <h1 className="font-display text-3xl font-bold text-ink">Admin Console</h1>
          <p className="text-dim text-sm mt-2">
            Sign in to manage subscriptions, packages, and applications.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-ink mb-1.5 ml-1">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
              <input
                type="text"
                required
                autoFocus
                className="w-full pl-10 pr-4 py-3 bg-chalk border border-border rounded-xl
                           focus:bg-surface focus:ring-2 focus:ring-accent focus:border-accent
                           outline-none transition-all text-ink font-medium placeholder:text-dim"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-ink mb-1.5 ml-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
              <input
                type="password"
                required
                className="w-full pl-10 pr-4 py-3 bg-chalk border border-border rounded-xl
                           focus:bg-surface focus:ring-2 focus:ring-accent focus:border-accent
                           outline-none transition-all text-ink font-medium placeholder:text-dim"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-danger/10 text-danger border border-danger/20 rounded-xl text-sm font-medium text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-chalk font-semibold text-base
                       transition-all bg-ink hover:bg-ink/80
                       disabled:opacity-40 hover:-translate-y-0.5"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
