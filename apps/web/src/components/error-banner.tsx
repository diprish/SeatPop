interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

/** API failure mode: a visible banner, never a blank page. */
export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded bg-red-900 px-3 py-1 text-sm text-white dark:bg-red-100 dark:text-red-950"
        >
          Try again
        </button>
      )}
    </div>
  );
}
