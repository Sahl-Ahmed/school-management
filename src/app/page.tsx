import { redirect } from "next/navigation";

/**
 * The root is never rendered in practice: middleware redirects a signed-in
 * user to their portal and an anonymous visitor to /login. This exists so a
 * direct hit with middleware disabled still lands somewhere sensible.
 */
export default function Home() {
  redirect("/login");
}
