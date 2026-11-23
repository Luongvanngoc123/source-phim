import Link from "next/link";
import { SITE_NAME } from "@/config-global";

export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label={SITE_NAME}
      className={`font-bold tracking-tight text-primary ${className}`}
    >
      {SITE_NAME}
    </Link>
  );
}
