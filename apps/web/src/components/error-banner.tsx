import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

/** API failure mode: a visible banner, never a blank page. */
export default function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-card border-2 border-blush-solid bg-blush-tint p-4"
    >
      <Icon name="warning" className="h-5 w-5 shrink-0 text-blush-ink" />
      <div>
        <p className="font-bold text-blush-ink">Something went wrong</p>
        <p className="mt-1 text-sm text-blush-ink">{message}</p>
        {onRetry && (
          <Button onClick={onRetry} className="mt-2">
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
