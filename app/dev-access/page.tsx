// Developer sign-up and sign-in. Deliberately unlinked from every screen and
// kept out of search engines; only emails in DEVELOPER_EMAIL can sign up.
import type { Metadata } from "next";
import { DevAccess } from "./DevAccess";

export const metadata: Metadata = {
  title: "Developer access",
  robots: { index: false, follow: false },
};

export default function DevAccessPage() {
  return <DevAccess />;
}
