// The one-time developer sign-up, reached from "Are you a developer?" on the
// sign-in page while no developer account exists. Kept out of search engines.
import type { Metadata } from "next";
import { DevAccess } from "./DevAccess";

export const metadata: Metadata = {
  title: "Developer access",
  robots: { index: false, follow: false },
};

export default function DevAccessPage() {
  return <DevAccess />;
}
