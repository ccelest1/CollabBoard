import { MagicLinkForm } from "@/components/MagicLinkForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
      <p className="mt-2 text-slate-600">
        Enter your email and we&apos;ll send you a magic link to sign in.
      </p>
      <MagicLinkForm />
    </div>
  );
}
