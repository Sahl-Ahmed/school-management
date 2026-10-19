import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /*
   * The routine PDF routes read Noto Sans Bengali from disk at request time.
   * Next's file tracer cannot see a path built with `import.meta.url` + join,
   * so the fonts must be listed explicitly — otherwise the build succeeds and
   * the first PDF request fails with ENOENT in production only.
   */
  outputFileTracingIncludes: {
    "/print/routine/school": ["./src/lib/pdf/fonts/**"],
    "/print/routine/section/[sectionId]": ["./src/lib/pdf/fonts/**"],
    "/print/receipt/[paymentId]": ["./src/lib/pdf/fonts/**"],
  },
  // Supabase Storage serves student photos / branding assets.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
};

export default nextConfig;
