import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-5xl flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Welcome to CollabBoard
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-200">
          Real-time collaboration at the speed of thought.
        </p>
      </div>

      <div className="mt-7 w-full max-w-md rounded-xl border border-slate-300 bg-white p-6 shadow-sm">
        <AuthForm />
      </div>
    </div>
  );
}
