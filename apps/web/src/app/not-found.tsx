import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Card className="text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-lavender-tint"
        >
          <Icon name="ticket" className="h-8 w-8 text-lavender-ink" />
        </span>
        <h1 className="mt-3 text-2xl font-extrabold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          This stub tore off — the page doesn&apos;t exist.{" "}
          <Link className="underline" href="/">
            Back to For you
          </Link>
        </p>
      </Card>
    </main>
  );
}
