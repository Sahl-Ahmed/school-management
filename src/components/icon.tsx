/**
 * The icon set.
 *
 * Inline SVG rather than an icon package: there are nineteen of them, they are
 * all 24×24 on a 1.75 stroke, and shipping a dependency to draw nineteen paths
 * would cost more than it saves. Being inline also means they inherit
 * `currentColor`, which is what lets one sidebar item change colour on hover
 * without a second icon asset.
 *
 * They are deliberately plain line icons. The identity of this product comes
 * from its colour and its spacing, not from decorative glyphs, and a school
 * office reads these at a glance all day.
 *
 * Every icon is `aria-hidden`: each one sits beside a text label that already
 * names the thing, so announcing it twice would only slow a screen reader down.
 */

export type IconName =
  | "dashboard"
  | "students"
  | "teachers"
  | "calendar"
  | "money"
  | "exam"
  | "grade"
  | "feedback"
  | "card"
  | "bell"
  | "book"
  | "check"
  | "clipboard"
  | "profile"
  | "chart"
  | "menu"
  | "close"
  | "signout"
  | "chevron";

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  students: (
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M16.5 8.5a2.75 2.75 0 1 0 0-.5" />
      <path d="M17 14.6c2 .5 3.5 2.4 3.5 4.9" />
    </>
  ),
  teachers: (
    <>
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="M7 10v5c0 1.7 2.2 3 5 3s5-1.3 5-3v-5" />
      <path d="M21 7.5V14" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  money: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  exam: (
    <>
      <path d="M5 3.5h14a1 1 0 0 1 1 1V21l-4-2.2-4 2.2-4-2.2L4 21V4.5a1 1 0 0 1 1-1Z" />
      <path d="M8.5 8.5h7M8.5 12.5h4" />
    </>
  ),
  grade: (
    <>
      <path d="m12 3 2.6 5.5 6 .9-4.3 4.3 1 6-5.3-2.9-5.3 2.9 1-6L3.4 9.4l6-.9L12 3Z" />
    </>
  ),
  feedback: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.7A8.5 8.5 0 1 1 20.5 12Z" />
      <path d="M9 11h6M9 14.5h3.5" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5.5 16.5c0-1.7 1.3-3 3-3s3 1.3 3 3M14.5 9.5h4M14.5 13h4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z" />
      <path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3" />
      <path d="M8 7.5h7" />
    </>
  ),
  check: (
    <>
      <path d="M20 6 9.5 17 4 11.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5v1.5H9V4.5Z" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  signout: (
    <>
      <path d="M15 4.5h3A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-3" />
      <path d="M11 8.5 14.5 12 11 15.5M14 12H4.5" />
    </>
  ),
  chevron: (
    <>
      <path d="m9 6 6 6-6 6" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}
