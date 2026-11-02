import Link from "next/link";

/** Footer on every page: data credit, hackathon line, Trust + repo links. */

export function SiteFooter() {
  return (
    <footer className="mt-8 border-t border-line pb-28 lg:pb-8">
      <div className="mx-auto max-w-6xl space-y-1 px-4 py-6 text-sm text-muted">
        <p>
          Postal areas ©{" "}
          <a className="underline" href="https://www.geonames.org">
            GeoNames
          </a>{" "}
          contributors,{" "}
          <a className="underline" href="https://creativecommons.org/licenses/by/4.0/">
            CC BY 4.0
          </a>
          .
        </p>
        <p>Built for the Meta Global AI Developer Hackathon.</p>
        <p>
          <Link className="underline" href="/trust">
            Trust
          </Link>{" "}
          ·{" "}
          <a
            className="underline"
            href="https://github.com/diprish/SeatPop"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
