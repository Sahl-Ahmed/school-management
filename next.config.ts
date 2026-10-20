import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /*
   * Every PDF route reads Noto Sans Bengali from disk at request time. Next's
   * file tracer cannot see a path built with `import.meta.url` + join, so the
   * fonts must be listed explicitly — otherwise the build succeeds and the
   * first PDF request fails with ENOENT in production only.
   *
   * ONE ENTRY PER PDF ROUTE. A route added without a line here is the failure
   * mode this comment exists to prevent: it passes every local check, because
   * the dev server reads straight from the source tree, and only breaks once
   * deployed.
   */
  outputFileTracingIncludes: {
    "/print/routine/school": ["./src/lib/pdf/fonts/**"],
    "/print/routine/section/[sectionId]": ["./src/lib/pdf/fonts/**"],
    "/print/receipt/[paymentId]": ["./src/lib/pdf/fonts/**"],
    "/print/admit-card/[examId]/[studentId]": ["./src/lib/pdf/fonts/**"],
    "/print/admit-card/[examId]/class": ["./src/lib/pdf/fonts/**"],
    "/print/exam-routine/[examId]": ["./src/lib/pdf/fonts/**"],
    "/print/id-card/[studentId]": ["./src/lib/pdf/fonts/**"],
    "/print/result/[examId]": ["./src/lib/pdf/fonts/**"],
  },
  // Supabase Storage serves student photos / branding assets.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
