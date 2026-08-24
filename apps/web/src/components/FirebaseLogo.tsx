import { Flame } from 'lucide-react';

export function FirebaseLogo() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-slate-900">
      <Flame size={20} aria-hidden />
    </span>
  );
}
