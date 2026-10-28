export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-bold">SeatPop</h1>
      <p className="mt-4 text-neutral-600">
        The right activity for each person in your household, booked in time.
        Pilot city: Ottawa.
      </p>
      <p className="mt-4 text-sm text-neutral-500">
        Skeleton? Yes, on purpose. Service status lives at{" "}
        <a className="underline" href="/health">
          /health
        </a>
        .
      </p>
    </main>
  );
}
