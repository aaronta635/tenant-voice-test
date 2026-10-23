import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Production only: browsers ignore HSTS over plain HTTP anyway, and one
    // seen on https://localhost would force HTTPS on every local app for a year.
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }],
      },
    ];
  },
};

export default nextConfig;
